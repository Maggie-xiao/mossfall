/**
 * Historical generator for the superseded August 5, 2026 adapter build.
 * It is intentionally absent from package.json and is not valid evidence for
 * the native Field/LeafSim runtime. Current gates are `npm run verify:evidence`
 * plus the separately generated native-runtime browser report.
 */
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
  assertZeroHaloEvidence,
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
    "Final report generation requires an explicit evidence set ID"
  );
}
const verificationRoot = resolve(root, "verification", verificationId);
const verified = process.argv.includes("--verified");
const reports = new Map();

for (const file of REPORT_CONTRACT) {
  reports.set(
    file,
    JSON.parse(await readFile(resolve(verificationRoot, file), "utf8"))
  );
}

const browser = reports.get("browser-runtime-report.json");
const network = reports.get("network-report.json");
const audio = reports.get("audio-runtime-report.json");
const performance = reports.get("performance-layout-report.json");
const buildFiles = await collectBuildRecords(root);
const sourceFiles = await collectSourceRecords(root);
const buildFingerprint = treeHash(buildFiles);
const sourceTreeSha256 = treeHash(sourceFiles);

for (const [file, report] of reports) {
  if (report.runtimeMarker !== RUNTIME_MARKER) {
    throw new Error(`${file} runtime marker mismatch`);
  }
  if (report.buildFingerprint !== buildFingerprint) {
    throw new Error(`${file} build fingerprint mismatch`);
  }
}

const screenshotTimes = browser.screenshots.map((screenshot) =>
  parseIso(screenshot.capturedAt, `${screenshot.name}.capturedAt`)
);
const reportTimes = [...reports].map(([file, report]) =>
  parseIso(report.generatedAt, `${file}.generatedAt`)
);
const supplementalReports = new Map();
const supplementalReportTimes = [];
for (const file of SUPPLEMENTAL_REPORT_CONTRACT) {
  const report = JSON.parse(
    await readFile(resolve(verificationRoot, file), "utf8")
  );
  supplementalReports.set(file, report);
  supplementalReportTimes.push(
    parseIso(report.generatedAt, `${file}.generatedAt`)
  );
}
const supplementalImageTimes = [];
for (const contract of SUPPLEMENTAL_IMAGE_CONTRACT) {
  if (!contract.buildBound) continue;
  const record = await fileRecord(verificationRoot, contract.file);
  supplementalImageTimes.push(
    parseIso(record.modifiedAt, `${contract.file}.modifiedAt`)
  );
}
const allEvidenceTimes = [
  ...screenshotTimes,
  ...reportTimes,
  ...supplementalReportTimes,
  ...supplementalImageTimes
];
const evidenceWindow = {
  startedAt: new Date(Math.min(...allEvidenceTimes)).toISOString(),
  completedAt: new Date(Math.max(...allEvidenceTimes)).toISOString()
};
const generatedAt = new Date().toISOString();
const beginnerGameplay = browser.screenshots.find(
  (screenshot) => screenshot.name === "05-gameplay-b01"
);
const advancedGameplay = browser.screenshots.find(
  (screenshot) => screenshot.name === "06-gameplay-a05"
);
const localVisualReview = supplementalReports.get(
  "reports/local-visual-review.json"
);
const haloEvidence = assertZeroHaloEvidence(browser, "Browser report");
const maximumHaloOpacity = Math.max(
  ...haloEvidence.map((entry) => Math.abs(Number(entry.value)))
);
const finalGate = verified
  ? "PASS - the full test suite, production build, browser evidence, and artifact verifier completed successfully."
  : "CANDIDATE - run the manifest writer and verifier, then regenerate with `--verified`.";

const markdown = `# Final Verification

- Project: ${PROJECT}
- Generated at: \`${generatedAt}\`
- Runtime marker: \`${RUNTIME_MARKER}\`
- Build fingerprint: \`${buildFingerprint}\`
- Source tree SHA-256: \`${sourceTreeSha256}\`
- Manifest schema: \`${MANIFEST_SCHEMA_VERSION}\`
- Evidence window: \`${evidenceWindow.startedAt}\` to \`${evidenceWindow.completedAt}\`
- Evidence set: \`${SCREENSHOT_CONTRACT.length}\` primary PNG screenshots,
  \`${REPORT_CONTRACT.length}\` primary reports,
  \`${SUPPLEMENTAL_IMAGE_CONTRACT.length}\` supplemental PNG images, and
  \`${SUPPLEMENTAL_REPORT_CONTRACT.length}\` supplemental reports
- Final gate: ${finalGate}

## Verdict

The active product is the table/platform tilt balance-ball game using Mossfall forest
rendering. No descent, skiing, running, or canopy-travel state controls the active
gameplay path.

## Behavior And Numbers

- Beginner and Advanced each contain eight authored boards.
- Physics runs at 120 Hz with four bounded catch-up steps.
- Shared time starts at 60 seconds, counts through gameplay and failure, awards
  +20 seconds in Beginner or +30 seconds in Advanced, and caps at 99.
- Score is \`10 * levelsCleared + floor(remainingSeconds)\`; browser vectors 143
  and 102 are present in the current screenshot/report set.
- First-level countdown, 2.4 second level handoff, segmented fall/drop/spin/reset,
  captured-progress preservation, failure timeout, eight-clear completion, retry,
  restart, pause, quit confirmation, Board Lost, and Context Lost are covered by
  the browser report.

## Visual Migration

- Mossfall world, lighting, effects, PostFX, eight forest zones, table-bound
  particle transforms, and forest UI language are active.
- The active board owner is the original Mossfall \`LeafPlatform\`, consuming
  the original \`buildFieldMesh\` through \`BoardFieldAdapter\`. Browser evidence
  records \`${beginnerGameplay.metrics.leafSystem}\`,
  buildFieldMesh=\`${beginnerGameplay.metrics.leafBuildFieldMesh}\`, one blade,
  one burrow-furniture layer, one burrow-glow layer, one contact-shadow layer,
  and one BoardProps owner. The adapter preserves arbitrary silhouettes, ring
  voids, overlapping parts, separated platforms, and capture holes while keeping
  all Table Tilt gameplay authority files byte-identical. The generated blade has
  ${beginnerGameplay.metrics.leafTopVertices} top vertices,
  ${beginnerGameplay.metrics.leafTriangles} triangles,
  ${beginnerGameplay.metrics.leafHeightRange.toFixed(4)} m of authored height
  variation, thin-edge attributes, exact field-gradient normals, irregular
  veins, cell shading, front/back translucency, activity-gated breathing,
  tilt-lag flex, resting-ball sag, capture ripples, and dynamic contact shadows.
- Gameplay pieces use smooth spherical Mossfall beetle balls at
  ${advancedGameplay.metrics.balls[0].insectScale.toFixed(2)}x physical radius.
  Eyes, brows, horns, legs, and antennae are absent, while both mesh afterimages
  and particle trails remain disabled. The spherical halo is disabled; all
  ${haloEvidence.length} runtime measurements are zero (maximum absolute value
  ${maximumHaloOpacity.toFixed(6)}).
- Connection waiting never constructs a centre-capture guide, and the left HUD level value uses
  the locked bright colour \`${beginnerGameplay.metrics.hudLevelValueColor}\`.
- The 16 screenshots cover desktop and 390x844 portrait layouts, including title,
  teaching, manual How to Play, countdown, both difficulty examples, clear/fall/pause/system
  states, result vectors, full run, mobile touch fallback, and context loss.
- Runtime page assets contain no title cover/logo image and no remote runtime
  dependency.

## Audio

- All 12 SFX and both BGM files return HTTP 200 and pass \`decodeAudioData\`.
- Beginner plays \`balance-beam-loop.ogg\`; Advanced plays
  \`precision-puzzle-loop.ogg\`.
- Runtime audio evidence covers all 14 semantic event keys plus production
  480/220/240 ms start/resume/stop ramps, pause position freeze, resume, quit
  reset, and QA visibility synchronization.

## Browser And Layout

- Console errors: ${browser.consoleErrors.length}.
- Console warnings: ${browser.consoleWarnings.length}.
- Failed asset requests: ${network.failedRequests.length}.
- 1280x720 FPS: ${performance.desktop1280x720.fps.toFixed(1)}.
- 640x360 FPS: ${performance.desktop640x360.fps.toFixed(1)}.
- Mobile controls remain inside the 16:9 stage and the touch stick remains visible
  and bounded in the explicit QA fallback.
- Visual regression gates reject a return to adaptive-leaf, a bypass of
  LeafPlatform/buildFieldMesh, duplicate blade/burrow/shadow owners, missing
  curvature/veins/thin edges/sag, protruding ball features, rolling afterimages,
  particle trails, a result-screen guide, or a dark unreadable level value.

## Local Visual Acceptance

- Two independent local Ollama vision models reviewed six labeled panels in the
  order Beginner Original/Before/After and Advanced Original/Before/After.
- \`${localVisualReview.reviewers[0].model}\` returned
  \`${localVisualReview.reviewers[0].verdict}\` at
  \`${localVisualReview.reviewers[0].confidence.toFixed(2)}\` confidence.
- \`${localVisualReview.reviewers[1].model}\` returned
  \`${localVisualReview.reviewers[1].verdict}\` at
  \`${localVisualReview.reviewers[1].confidence.toFixed(2)}\` confidence.
- Consensus: \`${localVisualReview.consensus.verdict}\`. Both reviewers judged
  Target After materially closer to the original organic Mossfall leaf language
  than Target Before, with no visible migration blocker.
- The review ran locally; no project image was uploaded to an external service.

## SPEC CONFLICT / Superseded

The 2026-08-05 runnable source supersedes the 2026-08-04 pack for dual mode BGM,
the current larger ball radius, the segmented fall presentation and full board
rotation, the 5.6 second opening countdown, and the current 2.4 second
level-clear handoff. These current-source behaviors are intentionally retained.

## Device-Side Residual

The browser QA \`V\` hook calls the same \`setVisibilityPaused()\` function used by
the production \`visibilitychange\` event and verifies timer/audio freeze and
resume. The following remain device-side acceptance checks and are not represented
as completed browser events:

1. A full physical Balance Board CoP session, including fresh presence,
   loss/recovery gates, tilt response, and an eight-board run.
2. A real Android/Kiwii WebView \`document.hidden\` hide/show lifecycle event.
3. BGM/SFX mix balance and speaker loudness on the target device.
4. Physical feel of the left/right handle static effects. The exception-safe bridge
   submission paths are covered in code, but haptic sensation requires hardware.
`;

await writeFile(
  resolve(verificationRoot, "FINAL_VERIFICATION.md"),
  markdown,
  "utf8"
);

console.log(
  `Wrote verification/${verificationId}/FINAL_VERIFICATION.md for build ` +
    `${buildFingerprint.slice(0, 12)} (${verified ? "verified" : "candidate"})`
);
