import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const PROJECT = "Mossfall Table Tilt";
export const RUNTIME_MARKER = "mossfall-table-tilt-20260805";
export const MANIFEST_SCHEMA_VERSION = 3;
export const HALO_OPACITY_EPSILON = 1e-6;

export const SCREENSHOT_CONTRACT = [
  {
    name: "01-title-beginner",
    file: "screenshots/01-title-beginner.png",
    state: "MODE_SELECT",
    viewport: { width: 640, height: 360 },
    description: "Beginner title and mode selection"
  },
  {
    name: "02-teaching",
    file: "screenshots/02-teaching.png",
    state: "TEACH_IN",
    viewport: { width: 640, height: 360 },
    description: "Single pre-run teaching surface"
  },
  {
    name: "03-howto",
    file: "screenshots/03-howto.png",
    state: "HOW_TO_PLAY",
    viewport: { width: 640, height: 360 },
    description: "Manual in-game How to Play"
  },
  {
    name: "04-countdown",
    file: "screenshots/04-countdown.png",
    state: "LEVEL_INTRO",
    viewport: { width: 640, height: 360 },
    description: "First-level countdown"
  },
  {
    name: "05-gameplay-b01",
    file: "screenshots/05-gameplay-b01.png",
    state: "GAMEPLAY",
    viewport: { width: 640, height: 360 },
    description: "Beginner board B01 gameplay"
  },
  {
    name: "06-gameplay-a05",
    file: "screenshots/06-gameplay-a05.png",
    state: "GAMEPLAY",
    viewport: { width: 640, height: 360 },
    description: "Advanced board A05 gameplay"
  },
  {
    name: "07-level-clear-bonus",
    file: "screenshots/07-level-clear-bonus.png",
    state: "LEVEL_CLEAR",
    viewport: { width: 640, height: 360 },
    description: "Timer bonus during the level-clear handoff"
  },
  {
    name: "08-ball-fall",
    file: "screenshots/08-ball-fall.png",
    state: "BALL_FALL_DROP",
    viewport: { width: 640, height: 360 },
    description: "Ball fall drop and feedback"
  },
  {
    name: "09-pause",
    file: "screenshots/09-pause.png",
    state: "PAUSE_MENU",
    viewport: { width: 640, height: 360 },
    description: "Pause menu over Advanced gameplay"
  },
  {
    name: "10-connection-required",
    file: "screenshots/10-connection-required.png",
    state: "CONNECTION_REQUIRED",
    viewport: { width: 640, height: 360 },
    description: "Balance Board connection-required state"
  },
  {
    name: "11-result-beginner-143",
    file: "screenshots/11-result-beginner-143.png",
    state: "RESULT_CALC",
    viewport: { width: 640, height: 360 },
    description: "Beginner score vector 143"
  },
  {
    name: "12-result-advanced-102",
    file: "screenshots/12-result-advanced-102.png",
    state: "RESULT_CALC",
    viewport: { width: 640, height: 360 },
    description: "Advanced score vector 102"
  },
  {
    name: "13-mobile-title-390x844",
    file: "screenshots/13-mobile-title-390x844.png",
    state: "MODE_SELECT",
    viewport: { width: 390, height: 844 },
    description: "Mobile portrait title layout"
  },
  {
    name: "14-mobile-gameplay-touch-390x844",
    file: "screenshots/14-mobile-gameplay-touch-390x844.png",
    state: "GAMEPLAY",
    viewport: { width: 390, height: 844 },
    description: "Mobile portrait gameplay with QA touch fallback"
  },
  {
    name: "15-full-run-result",
    file: "screenshots/15-full-run-result.png",
    state: "RESULT_CALC",
    viewport: { width: 640, height: 360 },
    description: "Eight-clear full-run result"
  },
  {
    name: "16-context-lost",
    file: "screenshots/16-context-lost.png",
    state: "CONTEXT_LOST",
    viewport: { width: 640, height: 360 },
    description: "WebGL context-lost recovery state"
  }
];

export const REPORT_CONTRACT = [
  "browser-runtime-report.json",
  "network-report.json",
  "audio-runtime-report.json",
  "performance-layout-report.json",
  "page-assets.json"
];

export const SUPPLEMENTAL_IMAGE_CONTRACT = [
  {
    file: "baseline/original-mossfall-leaf-1-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: false
  },
  {
    file: "baseline/original-mossfall-leaf-5-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: false
  },
  {
    file: "baseline/target-before-advanced-a05-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: false
  },
  {
    file: "baseline/target-before-beginner-b01-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: false
  },
  {
    file: "after/dynamic-capture-pulse-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: true
  },
  {
    file: "after/dynamic-rolling-frame-01-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: true
  },
  {
    file: "after/dynamic-rolling-frame-02-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: true
  },
  {
    file: "after/mobile-landscape-active-844x390.png",
    viewport: { width: 844, height: 390 },
    buildBound: true
  },
  {
    file: "after/mobile-landscape-motion-frame-01-844x390.png",
    viewport: { width: 844, height: 390 },
    buildBound: true
  },
  {
    file: "after/mobile-landscape-motion-frame-02-844x390.png",
    viewport: { width: 844, height: 390 },
    buildBound: true
  },
  {
    file: "after/target-after-advanced-a05-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: true
  },
  {
    file: "after/target-after-beginner-b01-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: true
  },
  {
    file: "comparison/advanced-before-after-diff-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: true,
    imageKind: "diff"
  },
  {
    file: "comparison/advanced-original-before-after-1280x720.png",
    viewport: { width: 3840, height: 720 },
    buildBound: true
  },
  {
    file: "comparison/beginner-before-after-diff-1280x720.png",
    viewport: { width: 1280, height: 720 },
    buildBound: true,
    imageKind: "diff"
  },
  {
    file: "comparison/beginner-original-before-after-1280x720.png",
    viewport: { width: 3840, height: 720 },
    buildBound: true
  },
  {
    file: "comparison/mobile-landscape-motion-frame-diff-844x390.png",
    viewport: { width: 844, height: 390 },
    buildBound: true,
    imageKind: "diff"
  }
];

export const SUPPLEMENTAL_REPORT_CONTRACT = [
  "comparison/comparison-report.json",
  "reports/dynamic-runtime-report.json",
  "reports/touch-rolling-runtime-report.json",
  "reports/local-visual-review.json"
];

export const BUILD_ROOTS = ["dist"];

export const SOURCE_ROOTS = [
  "src",
  "scripts/build.mjs",
  "scripts/collect-browser-evidence.mjs",
  "scripts/generate-supplemental-evidence.mjs",
  "scripts/verification-contract.mjs",
  "scripts/verify-artifacts.mjs",
  "scripts/write-final-verification.mjs",
  "scripts/write-verification-manifest.mjs",
  "tests",
  "tools/serve.mjs",
  "package.json",
  "package-lock.json"
];

export function normalizePath(file) {
  return file.replaceAll("\\", "/");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function fileRecord(root, file) {
  const absolute = resolve(root, file);
  const bytes = await readFile(absolute);
  const metadata = await stat(absolute);
  return {
    file: normalizePath(file),
    bytes: bytes.length,
    sha256: sha256(bytes),
    modifiedAt: metadata.mtime.toISOString()
  };
}

async function collectFiles(root, entry, output) {
  const absolute = resolve(root, entry);
  const metadata = await stat(absolute);
  if (metadata.isFile()) {
    output.push(normalizePath(relative(root, absolute)));
    return;
  }

  const children = await readdir(absolute, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    await collectFiles(root, resolve(absolute, child.name), output);
  }
}

export async function collectSourceRecords(root) {
  return collectRecords(root, SOURCE_ROOTS);
}

export async function collectBuildRecords(root) {
  return collectRecords(root, BUILD_ROOTS);
}

async function collectRecords(root, roots) {
  const files = [];
  for (const entry of roots) {
    await collectFiles(root, entry, files);
  }

  const records = [];
  for (const file of files.sort()) {
    records.push(await fileRecord(root, file));
  }
  return records;
}

export function treeHash(records) {
  const payload = records
    .map((record) => `${record.file}\0${record.bytes}\0${record.sha256}\n`)
    .join("");
  return sha256(Buffer.from(payload));
}

export function parseIso(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`${label} must be an ISO timestamp, got ${String(value)}`);
  }
  return time;
}

export function assertExactKeys(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} mismatch.\nExpected: ${expectedSorted.join(", ")}\nActual: ${actualSorted.join(", ")}`
    );
  }
}

export function assertViewport(actual, expected, label) {
  if (
    Number(actual?.width) !== expected.width ||
    Number(actual?.height) !== expected.height
  ) {
    throw new Error(
      `${label} must be ${expected.width}x${expected.height}, got ` +
        `${String(actual?.width)}x${String(actual?.height)}`
    );
  }
}

export function collectHaloOpacityEvidence(value, path = "$", output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectHaloOpacityEvidence(item, `${path}[${index}]`, output)
    );
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (Object.hasOwn(value, "haloOpacity")) {
    output.push({ path: `${path}.haloOpacity`, value: value.haloOpacity });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "haloOpacity") continue;
    collectHaloOpacityEvidence(child, `${path}.${key}`, output);
  }
  return output;
}

export function assertZeroHaloEvidence(value, label = "Runtime evidence") {
  const evidence = collectHaloOpacityEvidence(value);
  if (evidence.length === 0) {
    throw new Error(`${label} contains no haloOpacity measurements`);
  }
  for (const entry of evidence) {
    const opacity = Number(entry.value);
    if (
      !Number.isFinite(opacity) ||
      Math.abs(opacity) > HALO_OPACITY_EPSILON
    ) {
      throw new Error(
        `${label} ${entry.path} must be zero; measured ${String(entry.value)}`
      );
    }
  }
  return evidence;
}
