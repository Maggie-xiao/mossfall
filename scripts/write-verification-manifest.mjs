import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MANIFEST_SCHEMA_VERSION,
  PROJECT,
  REPORT_CONTRACT,
  RUNTIME_MARKER,
  SCREENSHOT_CONTRACT,
  SUPPLEMENTAL_IMAGE_CONTRACT,
  SUPPLEMENTAL_REPORT_CONTRACT,
  collectBuildRecords,
  collectSourceRecords,
  fileRecord,
  parseIso,
  treeHash
} from "./verification-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const verificationId = process.argv
  .slice(2)
  .find((argument) => !argument.startsWith("--"));
if (!verificationId) {
  throw new Error(
    "Manifest generation requires an explicit evidence set ID"
  );
}
const verificationRoot = resolve(root, "verification", verificationId);
let previousManifest = null;
try {
  previousManifest = JSON.parse(
    await readFile(resolve(verificationRoot, "manifest.json"), "utf8")
  );
} catch {
  previousManifest = null;
}
const browserReport = JSON.parse(
  await readFile(resolve(verificationRoot, "browser-runtime-report.json"), "utf8")
);

if (browserReport.runtimeMarker !== RUNTIME_MARKER) {
  throw new Error("Browser report runtime marker does not match the current contract");
}

const browserShots = new Map(
  browserReport.screenshots.map((screenshot) => [screenshot.name, screenshot])
);
const currentBuildFiles = await collectBuildRecords(root);
const buildFingerprint = treeHash(currentBuildFiles);
const buildFiles =
  previousManifest?.build?.fingerprint === buildFingerprint &&
  JSON.stringify(
    previousManifest.build.files.map(({ file, bytes, sha256 }) => ({
      file,
      bytes,
      sha256
    }))
  ) ===
    JSON.stringify(
      currentBuildFiles.map(({ file, bytes, sha256 }) => ({
        file,
        bytes,
        sha256
      }))
    )
    ? previousManifest.build.files
    : currentBuildFiles;
const buildCompletedAtMs = Math.max(
  ...buildFiles.map((record) => parseIso(record.modifiedAt, `${record.file}.modifiedAt`))
);
const buildCompletedAt = new Date(buildCompletedAtMs).toISOString();
const clockToleranceMs = 2_000;
const screenshots = [];
for (const contract of SCREENSHOT_CONTRACT) {
  const evidence = browserShots.get(contract.name);
  if (!evidence) {
    throw new Error(`Browser report is missing screenshot evidence: ${contract.name}`);
  }
  const capturedAt = parseIso(evidence.capturedAt, `${contract.name}.capturedAt`);
  if (capturedAt < buildCompletedAtMs - clockToleranceMs) {
    throw new Error(`${contract.name} was captured before the final dist build`);
  }
  if (evidence.buildFingerprint !== buildFingerprint) {
    throw new Error(`${contract.name} was not captured from the current dist build`);
  }
  screenshots.push({
    ...contract,
    capturedAt: evidence.capturedAt,
    buildFingerprint,
    ...(await fileRecord(verificationRoot, contract.file))
  });
}

const reports = [];
for (const file of REPORT_CONTRACT) {
  const report = JSON.parse(await readFile(resolve(verificationRoot, file), "utf8"));
  if (report.runtimeMarker !== RUNTIME_MARKER) {
    throw new Error(`${file} runtime marker does not match the current contract`);
  }
  if (report.buildFingerprint !== buildFingerprint) {
    throw new Error(`${file} was not generated from the current dist build`);
  }
  const generatedAt = parseIso(report.generatedAt, `${file}.generatedAt`);
  if (generatedAt < buildCompletedAtMs - clockToleranceMs) {
    throw new Error(`${file} was generated before the final dist build`);
  }
  reports.push({
    generatedAt: report.generatedAt,
    ...(await fileRecord(verificationRoot, file))
  });
}

const sourceFiles = await collectSourceRecords(root);
const sourceTreeSha256 = treeHash(sourceFiles);
const supplementalImages = [];
for (const contract of SUPPLEMENTAL_IMAGE_CONTRACT) {
  const record = await fileRecord(verificationRoot, contract.file);
  const modifiedAt = parseIso(
    record.modifiedAt,
    `${contract.file}.modifiedAt`
  );
  if (
    contract.buildBound &&
    modifiedAt < buildCompletedAtMs - clockToleranceMs
  ) {
    throw new Error(`${contract.file} predates the final dist build`);
  }
  supplementalImages.push({
    ...contract,
    buildFingerprint: contract.buildBound ? buildFingerprint : null,
    ...record
  });
}

const supplementalReports = [];
for (const file of SUPPLEMENTAL_REPORT_CONTRACT) {
  const report = JSON.parse(
    await readFile(resolve(verificationRoot, file), "utf8")
  );
  if (report.runtimeMarker !== RUNTIME_MARKER) {
    throw new Error(`${file} runtime marker does not match the current contract`);
  }
  if (report.buildFingerprint !== buildFingerprint) {
    throw new Error(`${file} was not generated from the current dist build`);
  }
  if (report.sourceTreeSha256 !== sourceTreeSha256) {
    throw new Error(`${file} was not generated from the current source tree`);
  }
  const generatedAt = parseIso(report.generatedAt, `${file}.generatedAt`);
  if (generatedAt < buildCompletedAtMs - clockToleranceMs) {
    throw new Error(`${file} was generated before the final dist build`);
  }
  supplementalReports.push({
    generatedAt: report.generatedAt,
    buildFingerprint,
    sourceTreeSha256,
    ...(await fileRecord(verificationRoot, file))
  });
}

const finalReportText = await readFile(
  resolve(verificationRoot, "FINAL_VERIFICATION.md"),
  "utf8"
);
const finalReportGeneratedAt = finalReportText.match(
  /^- Generated at: `([^`]+)`$/m
)?.[1];
parseIso(finalReportGeneratedAt, "FINAL_VERIFICATION.md generatedAt");
const finalReport = {
  generatedAt: finalReportGeneratedAt,
  ...(await fileRecord(verificationRoot, "FINAL_VERIFICATION.md"))
};

const evidenceTimes = [
  ...screenshots.map((screenshot) => parseIso(screenshot.capturedAt, screenshot.name)),
  ...reports.map((report) => parseIso(report.generatedAt, report.file)),
  ...supplementalImages
    .filter((record) => record.buildBound)
    .map((record) => parseIso(record.modifiedAt, record.file)),
  ...supplementalReports.map((report) =>
    parseIso(report.generatedAt, report.file)
  )
];
const manifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  project: PROJECT,
  runtimeMarker: RUNTIME_MARKER,
  generatedAt: new Date().toISOString(),
  evidenceWindow: {
    startedAt: new Date(Math.min(...evidenceTimes)).toISOString(),
    completedAt: new Date(Math.max(...evidenceTimes)).toISOString()
  },
  source: {
    algorithm: "sha256",
    treeSha256: sourceTreeSha256,
    files: sourceFiles
  },
  build: {
    algorithm: "sha256",
    fingerprint: buildFingerprint,
    completedAt: buildCompletedAt,
    files: buildFiles
  },
  screenshots,
  reports,
  supplementalImages,
  supplementalReports,
  finalReport,
  deviceChecks: {
    realKiwiiWebViewVisibilityEvent: "pending-device-validation",
    browserQaVisibilityPath:
      "verified-through-qa-hook-calling-the-production-visibility-handler"
  }
};

await writeFile(
  resolve(verificationRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(
  `Wrote verification/${verificationId}/manifest.json for ${screenshots.length} screenshots, ` +
    `${reports.length} reports, ${supplementalImages.length} supplemental images, ` +
    `${supplementalReports.length} supplemental reports, and build ` +
    `${buildFingerprint.slice(0, 12)}`
);
