import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import {
  MANIFEST_SCHEMA_VERSION,
  PROJECT,
  REPORT_CONTRACT,
  RUNTIME_MARKER,
  SCREENSHOT_CONTRACT,
  SUPPLEMENTAL_IMAGE_CONTRACT,
  SUPPLEMENTAL_REPORT_CONTRACT,
  assertZeroHaloEvidence,
  assertExactKeys,
  assertViewport,
  collectBuildRecords,
  collectSourceRecords,
  fileRecord,
  parseIso,
  treeHash
} from "./verification-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const verificationId = process.argv
  .slice(2)
  .find((argument) => !argument.startsWith("--"));
if (!verificationId) {
  throw new Error(
    "Full artifact verification requires an explicit evidence set ID"
  );
}
const verificationRoot = resolve(root, "verification", verificationId);
const screenshotRoot = resolve(verificationRoot, "screenshots");
const sourceAudio = resolve(root, "src", "audio", "sfx");
const distAudio = resolve(dist, "audio", "sfx");
const sourceBgm = resolve(root, "src", "audio", "bgm");
const distBgm = resolve(dist, "audio", "bgm");
const sourceImages = resolve(root, "src", "images");
const distImages = resolve(dist, "images");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSameRecord(actual, expected, label) {
  assert(actual.file === expected.file, `${label} path changed`);
  assert(actual.bytes === expected.bytes, `${label} byte size changed`);
  assert(actual.sha256 === expected.sha256, `${label} hash changed`);
}

function assertCleanText(value, label) {
  const text = JSON.stringify(value);
  for (const token of ["\uFFFD", "鈥", "脳", "锛", "鐨"]) {
    assert(!text.includes(token), `${label} contains mojibake token ${token}`);
  }
}

function assertNoErrors(errors, label) {
  assert(Array.isArray(errors), `${label} must be an array`);
  assert(errors.length === 0, `${label} contains ${errors.length} error(s)`);
}

function assertRecentEvidence(evidenceTime, manifestTime, label) {
  assert(evidenceTime <= manifestTime + 5_000, `${label} is later than the manifest`);
  assert(
    manifestTime - evidenceTime <= 6 * 60 * 60 * 1000,
    `${label} is more than six hours older than the manifest`
  );
}

function inspectPng(bytes, contract) {
  assert(
    Buffer.from(bytes)
      .subarray(0, 8)
      .equals(Buffer.from("89504e470d0a1a0a", "hex")),
    `${contract.file} is not a real PNG`
  );
  const image = PNG.sync.read(bytes, { checkCRC: true });
  assertViewport(image, contract.viewport, contract.file);

  let minLuminance = 255;
  let maxLuminance = 0;
  let visiblePixels = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let nonzeroPixels = 0;
  const colors = new Set();

  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3];
    if (alpha < 8) continue;
    const red = image.data[index];
    const green = image.data[index + 1];
    const blue = image.data[index + 2];
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    minLuminance = Math.min(minLuminance, luminance);
    maxLuminance = Math.max(maxLuminance, luminance);
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
    visiblePixels += 1;
    if (red !== 0 || green !== 0 || blue !== 0) nonzeroPixels += 1;
    colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
  }

  assert(
    visiblePixels >= image.width * image.height * 0.9,
    `${contract.file} has too few visible pixels`
  );
  const mean = luminanceSum / visiblePixels;
  const variance = luminanceSquaredSum / visiblePixels - mean * mean;
  if (contract.imageKind === "diff") {
    assert(
      nonzeroPixels >= image.width * image.height * 0.005,
      `${contract.file} contains too little visual difference`
    );
    assert(
      maxLuminance - minLuminance >= 12,
      `${contract.file} has insufficient difference range`
    );
    assert(colors.size >= 8, `${contract.file} has too few difference colors`);
    return;
  }
  assert(
    maxLuminance - minLuminance >= 28,
    `${contract.file} has insufficient luminance range and may be blank`
  );
  assert(variance >= 80, `${contract.file} has insufficient pixel variance`);
  assert(colors.size >= 24, `${contract.file} has too few distinct colors`);
}

async function readJson(file) {
  return JSON.parse(await readFile(resolve(verificationRoot, file), "utf8"));
}

const manifest = await readJson("manifest.json");
assert(
  manifest.schemaVersion === MANIFEST_SCHEMA_VERSION,
  `Expected manifest schema ${MANIFEST_SCHEMA_VERSION}`
);
assert(manifest.project === PROJECT, `Unexpected manifest project: ${manifest.project}`);
assert(
  manifest.runtimeMarker === RUNTIME_MARKER,
  `Unexpected runtime marker: ${manifest.runtimeMarker}`
);
const manifestTime = parseIso(manifest.generatedAt, "manifest.generatedAt");
const evidenceStart = parseIso(
  manifest.evidenceWindow?.startedAt,
  "manifest.evidenceWindow.startedAt"
);
const evidenceEnd = parseIso(
  manifest.evidenceWindow?.completedAt,
  "manifest.evidenceWindow.completedAt"
);
const actualEvidenceTimes = [];
assert(evidenceStart <= evidenceEnd, "Manifest evidence window is reversed");
assertRecentEvidence(evidenceStart, manifestTime, "Evidence window start");
assertRecentEvidence(evidenceEnd, manifestTime, "Evidence window end");

const sourceFiles = await collectSourceRecords(root);
const sourceTreeSha256 = treeHash(sourceFiles);
assert(
  manifest.source?.treeSha256 === sourceTreeSha256,
  "Active source tree no longer matches the manifest"
);
assertExactKeys(
  manifest.source.files.map((record) => record.file),
  sourceFiles.map((record) => record.file),
  "Manifest source file list"
);
for (let index = 0; index < sourceFiles.length; index += 1) {
  assertSameRecord(sourceFiles[index], manifest.source.files[index], sourceFiles[index].file);
}

const buildFiles = await collectBuildRecords(root);
const buildFingerprint = treeHash(buildFiles);
const lockedBuildCompletedAt = Math.max(
  ...manifest.build.files.map((record) =>
    parseIso(record.modifiedAt, `${record.file}.modifiedAt`)
  )
);
const evidenceClockToleranceMs = 2_000;
assert(
  manifest.build?.fingerprint === buildFingerprint,
  "Current full dist fingerprint no longer matches the manifest"
);
assert(
  parseIso(manifest.build.completedAt, "manifest.build.completedAt") ===
    lockedBuildCompletedAt,
  "Manifest build completion time does not match its locked dist records"
);
assertExactKeys(
  manifest.build.files.map((record) => record.file),
  buildFiles.map((record) => record.file),
  "Manifest build file list"
);
for (let index = 0; index < buildFiles.length; index += 1) {
  assertSameRecord(buildFiles[index], manifest.build.files[index], buildFiles[index].file);
}

const screenshotFiles = (await readdir(screenshotRoot))
  .filter((file) => file.toLowerCase().endsWith(".png"))
  .map((file) => `screenshots/${file}`);
assertExactKeys(
  screenshotFiles,
  SCREENSHOT_CONTRACT.map((contract) => contract.file),
  "Current screenshot directory"
);
assert(
  manifest.screenshots.length === SCREENSHOT_CONTRACT.length,
  `Expected ${SCREENSHOT_CONTRACT.length} manifest screenshots`
);

for (const contract of SCREENSHOT_CONTRACT) {
  const record = manifest.screenshots.find((item) => item.name === contract.name);
  assert(record, `Manifest is missing screenshot ${contract.name}`);
  assert(record.file === contract.file, `${contract.name} file does not match the contract`);
  assert(record.state === contract.state, `${contract.name} state does not match the contract`);
  assert(
    record.buildFingerprint === buildFingerprint,
    `${contract.name} manifest build fingerprint mismatch`
  );
  assertViewport(record.viewport, contract.viewport, `${contract.name} viewport`);
  const capturedAt = parseIso(record.capturedAt, `${contract.name}.capturedAt`);
  assert(
    capturedAt >= lockedBuildCompletedAt - evidenceClockToleranceMs,
    `${contract.name} predates the final locked build`
  );
  assert(capturedAt >= evidenceStart, `${contract.name} predates the evidence window`);
  assert(capturedAt <= evidenceEnd, `${contract.name} is after the evidence window`);
  actualEvidenceTimes.push(capturedAt);
  const actual = await fileRecord(verificationRoot, record.file);
  assertSameRecord(actual, record, contract.file);
  inspectPng(await readFile(resolve(verificationRoot, record.file)), contract);
}

assertExactKeys(
  manifest.reports.map((report) => report.file),
  REPORT_CONTRACT,
  "Manifest report list"
);
const manifestReports = new Map(
  manifest.reports.map((report) => [report.file, report])
);
for (const reportRecord of manifest.reports) {
  const reportTime = parseIso(reportRecord.generatedAt, `${reportRecord.file}.generatedAt`);
  assert(
    reportTime >= lockedBuildCompletedAt - evidenceClockToleranceMs,
    `${reportRecord.file} predates the final locked build`
  );
  assert(reportTime >= evidenceStart, `${reportRecord.file} predates the evidence window`);
  assert(reportTime <= evidenceEnd, `${reportRecord.file} is after the evidence window`);
  const actual = await fileRecord(verificationRoot, reportRecord.file);
  assertSameRecord(actual, reportRecord, reportRecord.file);
}

assertExactKeys(
  manifest.supplementalImages.map((record) => record.file),
  SUPPLEMENTAL_IMAGE_CONTRACT.map((contract) => contract.file),
  "Manifest supplemental image list"
);
for (const contract of SUPPLEMENTAL_IMAGE_CONTRACT) {
  const record = manifest.supplementalImages.find(
    (item) => item.file === contract.file
  );
  assert(record, `Manifest is missing supplemental image ${contract.file}`);
  assert(
    record.buildBound === contract.buildBound,
    `${contract.file} build-bound contract changed`
  );
  assertViewport(record.viewport, contract.viewport, contract.file);
  if (contract.buildBound) {
    assert(
      record.buildFingerprint === buildFingerprint,
      `${contract.file} build fingerprint mismatch`
    );
    const modifiedAt = parseIso(record.modifiedAt, `${contract.file}.modifiedAt`);
    assert(
      modifiedAt >= lockedBuildCompletedAt - evidenceClockToleranceMs,
      `${contract.file} predates the final locked build`
    );
    actualEvidenceTimes.push(modifiedAt);
  } else {
    assert(
      record.buildFingerprint === null,
      `${contract.file} reference image must not claim the target build`
    );
  }
  const actual = await fileRecord(verificationRoot, contract.file);
  assertSameRecord(actual, record, contract.file);
  inspectPng(await readFile(resolve(verificationRoot, contract.file)), contract);
}

assertExactKeys(
  manifest.supplementalReports.map((record) => record.file),
  SUPPLEMENTAL_REPORT_CONTRACT,
  "Manifest supplemental report list"
);
const supplementalReports = new Map(
  manifest.supplementalReports.map((record) => [record.file, record])
);
const coveredSupplementalImages = new Set();
for (const file of SUPPLEMENTAL_REPORT_CONTRACT) {
  const record = supplementalReports.get(file);
  assert(record, `Manifest is missing supplemental report ${file}`);
  const actual = await fileRecord(verificationRoot, file);
  assertSameRecord(actual, record, file);
  const report = await readJson(file);
  assert(report.runtimeMarker === RUNTIME_MARKER, `${file} runtime marker mismatch`);
  assert(report.buildFingerprint === buildFingerprint, `${file} build mismatch`);
  assert(
    report.sourceTreeSha256 === sourceTreeSha256,
    `${file} source tree mismatch`
  );
  assert(
    report.generatedAt === record.generatedAt,
    `${file} generatedAt does not match the manifest`
  );
  const generatedAt = parseIso(report.generatedAt, `${file}.generatedAt`);
  assert(
    generatedAt >= lockedBuildCompletedAt - evidenceClockToleranceMs,
    `${file} predates the final locked build`
  );
  assert(Array.isArray(report.artifacts), `${file} has no artifact hash list`);
  for (const artifact of report.artifacts) {
    const contract = SUPPLEMENTAL_IMAGE_CONTRACT.find(
      (item) => item.file === artifact.file
    );
    assert(contract, `${file} references unexpected artifact ${artifact.file}`);
    const actualArtifact = await fileRecord(verificationRoot, artifact.file);
    assertSameRecord(actualArtifact, artifact, `${file}:${artifact.file}`);
    coveredSupplementalImages.add(artifact.file);
  }
  if (file === "comparison/comparison-report.json") {
    assert(report.labelsEmbedded === true, "Comparison labels are not embedded");
    assertExactKeys(
      report.panelOrder,
      ["Original Mossfall", "Target Before", "Target After"],
      "Comparison panel labels"
    );
    assert(
      report.sets?.every(
        (set) =>
          set.labelsEmbedded === true &&
          JSON.stringify(set.panelOrder) ===
            JSON.stringify(["Original Mossfall", "Target Before", "Target After"])
      ),
      "Comparison set labels or order are missing"
    );
  }
  if (file === "reports/local-visual-review.json") {
    assert(
      report.reviewKind === "local-multimodel-visual-acceptance",
      "Local visual review kind mismatch"
    );
    assert(
      report.execution?.localOnly === true &&
        report.execution?.filesUploaded === false,
      "Local visual review must remain local-only"
    );
    assertExactKeys(
      report.reviewers.map((reviewer) => reviewer.model),
      ["qwen3-vl:8b", "gemma3:4b"],
      "Local visual reviewer models"
    );
    assert(
      report.reviewers.every(
        (reviewer) =>
          reviewer.verdict === "PASS" &&
          Number.isFinite(reviewer.confidence) &&
          reviewer.confidence >= 0.9
      ),
      "Local visual review does not contain two high-confidence PASS verdicts"
    );
    assert(
      report.consensus?.verdict === "PASS" &&
        report.consensus?.passCount === 2 &&
        report.consensus?.failCount === 0,
      "Local visual review consensus is not PASS"
    );
    assertExactKeys(
      report.artifacts.map((artifact) => artifact.file),
      [
        "comparison/beginner-original-before-after-1280x720.png",
        "comparison/advanced-original-before-after-1280x720.png"
      ],
      "Local visual review image set"
    );
  }
  actualEvidenceTimes.push(generatedAt);
}
assertExactKeys(
  [...coveredSupplementalImages],
  SUPPLEMENTAL_IMAGE_CONTRACT.map((contract) => contract.file),
  "Supplemental image report coverage"
);

function assertReportTimestamp(report, file) {
  const manifestRecord = manifestReports.get(file);
  assert(manifestRecord, `Manifest is missing report ${file}`);
  assert(
    report.generatedAt === manifestRecord.generatedAt,
    `${file} generatedAt does not match the manifest`
  );
  const actualTime = parseIso(report.generatedAt, `${file}.generatedAt`);
  assert(
    actualTime >= lockedBuildCompletedAt - evidenceClockToleranceMs,
    `${file} actual generatedAt predates the final locked build`
  );
  assert(actualTime >= evidenceStart, `${file} actual generatedAt predates the evidence window`);
  assert(actualTime <= evidenceEnd, `${file} actual generatedAt is after the evidence window`);
  actualEvidenceTimes.push(actualTime);
}

const browser = await readJson("browser-runtime-report.json");
assertZeroHaloEvidence(browser, "Browser report");
assert(browser.project === PROJECT, "Browser report project mismatch");
assert(browser.runtimeMarker === RUNTIME_MARKER, "Browser runtime marker mismatch");
assert(browser.buildFingerprint === buildFingerprint, "Browser report build fingerprint mismatch");
assertReportTimestamp(browser, "browser-runtime-report.json");
assertRecentEvidence(
  parseIso(browser.generatedAt, "browser.generatedAt"),
  manifestTime,
  "Browser report"
);
assertCleanText(browser, "Browser report");
assert(
  browser.screenshots.length === SCREENSHOT_CONTRACT.length,
  "Browser report must describe exactly 16 screenshots"
);
assertExactKeys(
  browser.screenshots.map((screenshot) => screenshot.name),
  SCREENSHOT_CONTRACT.map((contract) => contract.name),
  "Browser screenshot evidence"
);
for (const contract of SCREENSHOT_CONTRACT) {
  const evidence = browser.screenshots.find((screenshot) => screenshot.name === contract.name);
  assert(evidence.file === contract.file, `${contract.name} browser file mismatch`);
  assert(
    evidence.buildFingerprint === buildFingerprint,
    `${contract.name} browser build fingerprint mismatch`
  );
  assertViewport(evidence.viewport, contract.viewport, `${contract.name} browser viewport`);
  assert(evidence.metrics?.state === contract.state, `${contract.name} browser state mismatch`);
  assert(evidence.errorCount === 0, `${contract.name} recorded browser errors`);
  assertNoErrors(evidence.errors, `${contract.name}.errors`);
  assertNoErrors(evidence.warnings, `${contract.name}.warnings`);
  const evidenceCapturedAt = parseIso(
    evidence.capturedAt,
    `${contract.name}.capturedAt`
  );
  const manifestScreenshot = manifest.screenshots.find(
    (screenshot) => screenshot.name === contract.name
  );
  assert(
    evidence.capturedAt === manifestScreenshot.capturedAt,
    `${contract.name} browser capturedAt does not match the manifest`
  );
  assert(
    evidenceCapturedAt >= lockedBuildCompletedAt - evidenceClockToleranceMs,
    `${contract.name} browser evidence predates the final locked build`
  );
}
for (const name of ["05-gameplay-b01", "06-gameplay-a05"]) {
  const gameplay = browser.screenshots.find(
    (screenshot) => screenshot.name === name
  )?.metrics;
  assert(gameplay?.visualTheme === "mossfall", `${name} lost the Mossfall theme`);
  assert(gameplay?.mossWorld === "true", `${name} lost the Mossfall world`);
  assert(gameplay?.mossLighting === "true", `${name} lost Mossfall lighting`);
  assert(gameplay?.mossEffects === "true", `${name} lost Mossfall effects`);
  assert(gameplay?.mossPostfx === "true", `${name} lost Mossfall PostFX`);
  assert(gameplay?.leafAdaptive === false, `${name} revived adaptive-leaf`);
  assert(gameplay?.leafSystem === "LeafPlatform", `${name} lost LeafPlatform`);
  assert(gameplay?.leafBuildFieldMesh === true, `${name} bypassed buildFieldMesh`);
  assert(gameplay?.leafShaderOk === true, `${name} leaf shader degraded`);
  assert(gameplay?.leafBladeCount === 1, `${name} has duplicate leaf blades`);
  assert(
    gameplay?.leafBurrowFurnitureCount === 1,
    `${name} has missing or duplicate burrow furniture`
  );
  assert(
    gameplay?.leafBurrowGlowCount === 1,
    `${name} has missing or duplicate burrow glow`
  );
  assert(
    gameplay?.leafContactShadowLayerCount === 1,
    `${name} has missing or duplicate contact shadows`
  );
  assert(
    gameplay?.leafBoardPropsCount === 1,
    `${name} did not retain the BoardProps owner`
  );
  assert(gameplay?.leafTopVertices >= 2_000, `${name} leaf is under-tessellated`);
  assert(gameplay?.leafTriangles >= 8_000, `${name} leaf has too few triangles`);
  assert(gameplay?.leafEdgeVertices >= 200, `${name} leaf has no readable thin edge`);
  assert(gameplay?.leafVeinVertices >= 150, `${name} leaf veins are not represented`);
  assert(gameplay?.leafHeightRange >= 0.045, `${name} leaf is visually flat`);
  assert(gameplay?.leafHeightRms >= 0.008, `${name} leaf lacks field curvature`);
  assert(
    gameplay?.leafSagWeights?.some((weight) => weight > 0),
    `${name} has no resting-weight sag`
  );
  assert(gameplay?.balls?.length > 0, `${name} has no insect evidence`);
  for (const ball of gameplay.balls) {
    assert(ball.ballForm === "sphere", `${name} ${ball.id} is not a ball`);
    assert(
      ball.insectScale >= 1.05 && ball.insectScale <= 1.12,
      `${name} ${ball.id} visual radius drifted from the spherical ball`
    );
    assert(
      ball.protrudingFeatures === false,
      `${name} ${ball.id} regained protruding beetle features`
    );
    assert(ball.insectLegs === false, `${name} ${ball.id} regained visible legs`);
    assert(
      ball.insectAntennae === false,
      `${name} ${ball.id} regained visible antennae`
    );
    assert(ball.trailStrength === 0, `${name} ${ball.id} regained a motion trail`);
    assert(
      ball.trailVisibleCount === 0,
      `${name} ${ball.id} regained visible afterimages`
    );
    assert(ball.haloOpacity === 0, `${name} ${ball.id} regained a visible halo`);
  }
  assert(
    gameplay?.hudLevelValueColor === "rgb(244, 255, 233)",
    `${name} HUD level value lost its bright readable colour`
  );
}
for (const name of [
  "11-result-beginner-143",
  "12-result-advanced-102",
  "15-full-run-result"
]) {
  const result = browser.screenshots.find(
    (screenshot) => screenshot.name === name
  )?.metrics;
  assert(
    result && !Object.hasOwn(result, "guideVisible"),
    `${name} still reports a generated centre-capture guide`
  );
}
const screenshotText = new Map(
  browser.screenshots.map((screenshot) => [
    screenshot.name,
    screenshot.metrics.bodyText
  ])
);
assert(
  screenshotText.get("11-result-beginner-143")?.includes("FINAL SCORE 143") &&
    screenshotText
      .get("11-result-beginner-143")
      ?.includes("PERSONAL BEST 143 NEW RECORD"),
  "Beginner 143 result screenshot is not a clean score vector"
);
assert(
  screenshotText.get("12-result-advanced-102")?.includes("FINAL SCORE 102") &&
    screenshotText
      .get("12-result-advanced-102")
      ?.includes("PERSONAL BEST 102 NEW RECORD"),
  "Advanced 102 result screenshot is not a clean score vector"
);
assert(
  screenshotText.get("15-full-run-result")?.includes("FINAL SCORE 179") &&
    screenshotText
      .get("15-full-run-result")
      ?.includes("PERSONAL BEST 179 NEW RECORD"),
  "Full-run screenshot is not a clean 179 score vector"
);

const transitions = browser.fullRun?.stateTransitions || [];
assertNoErrors(browser.fullRun?.errors, "Full-run browser errors");
const expectedFullRunTransitions = [
  "[STATE] BOOT -> MODE_SELECT",
  "[STATE] MODE_SELECT -> TEACH_IN",
  "[STATE] TEACH_IN -> START_LINE",
  "[STATE] START_LINE -> LEVEL_INTRO",
  "[STATE] LEVEL_INTRO -> GAMEPLAY",
  ...Array.from({ length: 7 }, () => [
    "[STATE] GAMEPLAY -> LEVEL_CLEAR",
    "[STATE] LEVEL_CLEAR -> GAMEPLAY"
  ]).flat(),
  "[STATE] GAMEPLAY -> LEVEL_CLEAR",
  "[STATE] LEVEL_CLEAR -> RUN_COMPLETE",
  "[STATE] RUN_COMPLETE -> RESULT_CALC"
];
assert(
  JSON.stringify(transitions) === JSON.stringify(expectedFullRunTransitions),
  "Full-run state chain does not match the current eight-board lifecycle"
);
assert(
  !transitions.some((entry) => entry.includes("TEACH_IN")),
  "Full run unexpectedly opened How to Play"
);
assert(
  transitions.filter((entry) => entry === "[STATE] GAMEPLAY -> LEVEL_CLEAR").length === 8,
  "Full run must clear exactly eight boards"
);
assert(
  transitions.filter((entry) => entry === "[STATE] LEVEL_CLEAR -> GAMEPLAY").length === 7,
  "Full run must hand off between seven intermediate boards"
);
assert(
  transitions.at(-1) === "[STATE] RUN_COMPLETE -> RESULT_CALC",
  "Full run does not finish at the result screen"
);
assert(browser.fullRun?.result?.state === "RESULT_CALC", "Full run result state is missing");
assert(
  browser.fullRun?.result?.text?.includes("FINAL SCORE 179"),
  "Full run result vector is missing"
);
assert(browser.retry?.automaticHowToShown === false, "Retry unexpectedly opened How to Play");
assert(
  !(browser.retry?.stateTransitions || []).some((entry) => entry.includes("TEACH_IN")),
  "Retry transition log contains guided teaching"
);

const pause = browser.pauseResume;
assert(pause?.beforePause?.bgmKey === "bgm-precision-puzzle", "Pause test used wrong BGM");
assert(pause.beforePause.bgmPlaying === true, "Advanced BGM was not playing before pause");
assert(pause.pauseOne.bgmPlaying === false, "BGM did not pause in the pause menu");
assert(pause.pauseTwo.bgmPlaying === false, "BGM restarted while still paused");
assert(pause.afterResume.bgmPlaying === true, "BGM did not resume");
assert(
  Math.abs(pause.pauseTwo.bgmTime - pause.pauseOne.bgmTime) <= 0.06,
  "BGM time advanced while paused"
);
assert(
  pause.afterResume.bgmTime >= pause.pauseTwo.bgmTime + 0.2,
  "BGM time did not continue after resume"
);
assert(
  pause.pauseOne.timer === pause.pauseTwo.timer,
  "Gameplay timer advanced while pause menu was open"
);

const visibility = browser.visibilityQa;
assert(visibility?.sameProductionHandler === true, "QA visibility did not use production handler");
assert(visibility?.before?.timer === visibility?.paused?.timer, "Visibility pause did not freeze timer");
assert(
  Math.abs(visibility?.paused?.bgmTime - visibility?.before?.bgmTime) <= 0.06,
  "Visibility pause did not freeze the BGM clock"
);
assert(visibility?.resumed?.bgmPlaying === true, "Visibility resume did not restart BGM");
assert(
  visibility?.resumed?.bgmTime >= visibility?.paused?.bgmTime + 0.2,
  "Visibility resume did not continue the BGM clock"
);
assertExactKeys(
  visibility?.logs || [],
  ["[GAME] Visibility paused (qa)", "[GAME] Visibility resumed (qa)"],
  "Visibility QA logs"
);
assert(
  visibility?.deviceStatus === "pending-device-validation",
  "Real Kiwii WebView visibility check must remain device-pending"
);

assert(browser.bgm?.beginner?.bgmKey === "bgm-balance-beam", "Beginner BGM key mismatch");
assert(browser.bgm?.advanced?.bgmKey === "bgm-precision-puzzle", "Advanced BGM key mismatch");
for (const mode of ["beginner", "advanced"]) {
  assert(browser.bgm[mode].audioUnlocked === true, `${mode} audio was not unlocked`);
  assert(browser.bgm[mode].bgmPlaying === true, `${mode} BGM was not playing`);
  assert(browser.bgm[mode].bgmTime > 0.2, `${mode} BGM time did not advance`);
}

assert(browser.flows?.countdown?.durationMs >= 5400, "First countdown was too short");
assert(browser.flows?.countdown?.durationMs <= 5900, "First countdown was too long");
assert(browser.flows?.levelHandoff?.nextLevel === 2, "Level handoff did not reach level 2");
assert(browser.flows?.levelHandoff?.countdownRepeated === false, "Level 2 repeated countdown");
assert(
  browser.flows?.fallReset?.preservedCapturedProgress === true,
  "Fall reset lost captured progress"
);
assert(
  browser.flows?.timeoutDuringFailure?.resultReached === true,
  "Failure timeout did not reach result"
);
assert(
  browser.flows?.pauseQuit?.confirmedToModeSelect === true,
  "Pause quit confirmation failed"
);
assert(browser.flows?.restart?.automaticHowToShown === false, "Restart opened How to Play");
assertNoErrors(browser.consoleErrors, "Browser console errors");
assertNoErrors(browser.consoleWarnings, "Browser console warnings");

const network = await readJson("network-report.json");
assert(network.project === PROJECT, "Network report project mismatch");
assert(network.runtimeMarker === RUNTIME_MARKER, "Network runtime marker mismatch");
assert(network.buildFingerprint === buildFingerprint, "Network report build fingerprint mismatch");
assertReportTimestamp(network, "network-report.json");
assertNoErrors(network.consoleErrors, "Network report console errors");
assertNoErrors(network.failedRequests, "Network failed requests");
assert(network.audioAssets.length === 14, "Network report must contain 14 audio assets");
const expectedAudio = [
  "ui-move.ogg",
  "ui-confirm.ogg",
  "dune-countdown-tick.wav",
  "dune-countdown-go.wav",
  "ball-impact.ogg",
  "ball-capture.ogg",
  "ball-fall.ogg",
  "result-count.ogg",
  "level-clear.ogg",
  "finish-crowd.mp3",
  "well_done.wav",
  "result-rank.ogg",
  "balance-beam-loop.ogg",
  "precision-puzzle-loop.ogg"
];
assertExactKeys(
  network.audioAssets.map((asset) => asset.file),
  expectedAudio,
  "Network audio assets"
);
const expectedAudioContentType = (file) => {
  if (file.endsWith(".mp3")) return "audio/mpeg";
  if (file.endsWith(".wav")) return "audio/wav";
  return "audio/ogg";
};
for (const asset of network.audioAssets) {
  assert(asset.status === 200 && asset.ok === true, `${asset.file} did not return HTTP 200`);
  assert(asset.decoded === true, `${asset.file} failed decodeAudioData`);
  assert(
    asset.contentType === expectedAudioContentType(asset.file),
    `${asset.file} content type mismatch`
  );
}

const audio = await readJson("audio-runtime-report.json");
assertZeroHaloEvidence(audio, "Audio report");
assert(audio.project === PROJECT, "Audio report project mismatch");
assert(audio.runtimeMarker === RUNTIME_MARKER, "Audio runtime marker mismatch");
assert(audio.buildFingerprint === buildFingerprint, "Audio report build fingerprint mismatch");
assertReportTimestamp(audio, "audio-runtime-report.json");
assertNoErrors(audio.javascriptErrors, "Audio JavaScript errors");
assert(audio.rampMs?.start === 480, "BGM start ramp is not 480 ms");
assert(audio.rampMs?.resume === 220, "BGM resume ramp is not 220 ms");
assert(audio.rampMs?.stop === 240, "BGM stop ramp is not 240 ms");
const expectedEventKeys = [
  "ui-move",
  "ui-confirm",
  "countdown-beat",
  "countdown-go",
  "ball-impact",
  "ball-capture",
  "ball-fall",
  "level-clear",
  "finish-crowd",
  "well-done",
  "result-count",
  "result-rank",
  "bgm-balance-beam",
  "bgm-precision-puzzle"
];
assertExactKeys(
  [...new Set(audio.audioPlayHistory.map((event) => event.key))],
  expectedEventKeys,
  "Audio event history"
);
assert(audio.lifecycle?.pauseResume?.passed === true, "Audio pause/resume evidence failed");
assert(audio.lifecycle?.quitReset?.passed === true, "Audio quit reset evidence failed");
assert(audio.lifecycle?.visibilityQa?.passed === true, "Audio visibility evidence failed");

const performance = await readJson("performance-layout-report.json");
assert(performance.project === PROJECT, "Performance report project mismatch");
assert(performance.runtimeMarker === RUNTIME_MARKER, "Performance runtime marker mismatch");
assert(
  performance.buildFingerprint === buildFingerprint,
  "Performance report build fingerprint mismatch"
);
assertReportTimestamp(performance, "performance-layout-report.json");
assert(performance.desktop1280x720?.nonblank === true, "1280x720 canvas is blank");
assert(performance.desktop640x360?.nonblank === true, "640x360 canvas is blank");
assert(performance.mobile390x844?.nonblank === true, "390x844 canvas is blank");
assert(performance.desktop1280x720?.fps >= 30, "1280x720 FPS is below 30");
assert(performance.desktop640x360?.fps >= 30, "640x360 FPS is below 30");
assert(
  performance.mobile390x844?.layoutInsideStage === true,
  "Mobile layout escapes the stage"
);
assert(
  performance.mobile390x844?.touchStickInsideStage === true,
  "Touch stick escapes the stage"
);
assertNoErrors(performance.layoutErrors, "Performance layout errors");

const pageAssets = await readJson("page-assets.json");
assert(pageAssets.project === PROJECT, "Page-assets project mismatch");
assert(pageAssets.runtimeMarker === RUNTIME_MARKER, "Page-assets runtime marker mismatch");
assert(
  pageAssets.buildFingerprint === buildFingerprint,
  "Page-assets report build fingerprint mismatch"
);
assertReportTimestamp(pageAssets, "page-assets.json");
assert(pageAssets.summary?.byKind?.image === 0, "Runtime still loads title images");
assert(pageAssets.summary?.byKind?.video === 0, "Runtime unexpectedly loads video");
assertExactKeys(
  pageAssets.assets.filter((asset) => asset.name.endsWith(".ogg")).map((asset) => asset.name),
  expectedOgg,
  "Page-assets OGG inventory"
);

assert(
  Math.min(...actualEvidenceTimes) === evidenceStart,
  "Manifest evidenceWindow.startedAt does not match actual evidence timestamps"
);
assert(
  Math.max(...actualEvidenceTimes) === evidenceEnd,
  "Manifest evidenceWindow.completedAt does not match actual evidence timestamps"
);

const finalReportRecord = await fileRecord(
  verificationRoot,
  "FINAL_VERIFICATION.md"
);
assertSameRecord(
  finalReportRecord,
  manifest.finalReport,
  "FINAL_VERIFICATION.md"
);
const finalReportText = await readFile(
  resolve(verificationRoot, "FINAL_VERIFICATION.md"),
  "utf8"
);
const finalReportGeneratedAt = finalReportText.match(
  /^- Generated at: `([^`]+)`$/m
)?.[1];
assert(
  finalReportGeneratedAt === manifest.finalReport.generatedAt,
  "FINAL_VERIFICATION.md generatedAt does not match the manifest"
);
for (const requiredLine of [
  `- Runtime marker: \`${RUNTIME_MARKER}\``,
  `- Build fingerprint: \`${buildFingerprint}\``,
  `- Source tree SHA-256: \`${sourceTreeSha256}\``,
  `- Manifest schema: \`${MANIFEST_SCHEMA_VERSION}\``,
  `- Evidence window: \`${manifest.evidenceWindow.startedAt}\` to \`${manifest.evidenceWindow.completedAt}\``
]) {
  assert(
    finalReportText.includes(requiredLine),
    `FINAL_VERIFICATION.md is missing locked field: ${requiredLine}`
  );
}

const standalone = await readFile(resolve(dist, "table-tilt-standalone.html"), "utf8");
for (const forbidden of [
  "references/keyframes",
  "contact_sheets",
  "source.mp4",
  "title-cover.webp",
  "title-logo.png"
]) {
  assert(!standalone.includes(forbidden), `Forbidden release reference: ${forbidden}`);
}
for (const dropped of ["USER_RANKINGS", "RETRY_QUIT", "ranking-list"]) {
  assert(!standalone.includes(dropped), `Deleted screen remains in release: ${dropped}`);
}
for (const required of [
  "title-howto",
  "teach-screen",
  "capC",
  "START_LINE",
  "countdown-demo-motion",
  "motion02-countdown.webp"
]) {
  assert(standalone.includes(required), `Missing onboarding contract: ${required}`);
}
for (const removedEntry of ["gameplay-howto", "teaching-slot"]) {
  assert(
    !standalone.includes(removedEntry),
    `Removed in-game help surface remains: ${removedEntry}`
  );
}
for (const legacy of ["BALANCE FIGURE", "teach-layer", "teachin_page2"]) {
  assert(!standalone.includes(legacy), `Legacy teaching surface remains: ${legacy}`);
}

const inlinedFonts = standalone.match(/url\(data:font\/ttf;base64,/g) || [];
assert(inlinedFonts.length === 7, `Expected 7 inlined font faces, found ${inlinedFonts.length}`);
assert(!/url\(["']?fonts\//.test(standalone), "Standalone references external fonts");
const inlinedImages = standalone.match(/data:image\/(?:png|webp);base64,/g) || [];
assert(inlinedImages.length === 2, `Expected 2 inlined images, found ${inlinedImages.length}`);
assert(!standalone.includes("./images/"), "Standalone references external images");

const sourceMotion = await fileRecord(sourceImages, "motion02-countdown.webp");
const distMotion = await fileRecord(distImages, "motion02-countdown.webp");
assert(
  sourceMotion.sha256 === distMotion.sha256,
  "Built countdown motion differs from source"
);

const audioManifest = JSON.parse(
  await readFile(resolve(sourceAudio, "audio-sources.json"), "utf8")
);
const bgmManifest = JSON.parse(await readFile(resolve(sourceBgm, "bgm-sources.json"), "utf8"));
const expectedInlinedAudio = audioManifest.assets.length + bgmManifest.assets.length;
const inlinedAudio =
  standalone.match(/data:audio\/(?:ogg|mpeg|wav);base64,/g) || [];
assert(
  inlinedAudio.length === expectedInlinedAudio,
  `Expected ${expectedInlinedAudio} inlined audio files, found ${inlinedAudio.length}`
);
assert(!standalone.includes("./audio/sfx/"), "Standalone references external SFX");
assert(!standalone.includes("./audio/bgm/"), "Standalone references external BGM");

for (const asset of audioManifest.assets) {
  const sourceRecord = await fileRecord(sourceAudio, asset.file);
  const distRecord = await fileRecord(distAudio, asset.file);
  assert(sourceRecord.sha256 === asset.sha256, `Source SFX hash mismatch: ${asset.file}`);
  assert(distRecord.sha256 === asset.sha256, `Built SFX hash mismatch: ${asset.file}`);
}
for (const asset of bgmManifest.assets) {
  const sourceRecord = await fileRecord(sourceBgm, asset.file);
  const distRecord = await fileRecord(distBgm, asset.file);
  assert(sourceRecord.sha256 === asset.sha256, `Source BGM hash mismatch: ${asset.file}`);
  assert(distRecord.sha256 === asset.sha256, `Built BGM hash mismatch: ${asset.file}`);
}

assert(
  manifest.deviceChecks?.realKiwiiWebViewVisibilityEvent === "pending-device-validation",
  "Manifest must keep the real Kiwii WebView visibility event device-pending"
);

console.log(
  `Verified current build ${buildFingerprint.slice(0, 12)}: ` +
    `${SCREENSHOT_CONTRACT.length} PNG screenshots, ${REPORT_CONTRACT.length} reports, ` +
    `${inlinedFonts.length} fonts, and ${inlinedAudio.length} audio assets`
);
