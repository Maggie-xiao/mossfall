import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import {
  PROJECT,
  RUNTIME_MARKER,
  collectBuildRecords,
  collectSourceRecords,
  fileRecord,
  treeHash
} from "./verification-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const verificationId =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ||
  "leafplatform-adapter-20260805";
const verificationRoot = resolve(root, "verification", verificationId);

const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"]
};

function decodeImage(bytes) {
  const input = Buffer.from(bytes);
  if (input.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return PNG.sync.read(input, { checkCRC: true });
  }
  if (input[0] === 0xff && input[1] === 0xd8) {
    const image = jpeg.decode(input, { useTArray: true, formatAsRGBA: true });
    return { width: image.width, height: image.height, data: Buffer.from(image.data) };
  }
  throw new Error("Unsupported image signature");
}

async function loadImage(file) {
  return decodeImage(await readFile(resolve(verificationRoot, file)));
}

async function saveImage(file, image) {
  await writeFile(resolve(verificationRoot, file), PNG.sync.write(image));
}

function blendPixel(image, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const index = (y * image.width + x) * 4;
  const inverse = 1 - alpha;
  image.data[index] = Math.round(image.data[index] * inverse + color[0] * alpha);
  image.data[index + 1] = Math.round(
    image.data[index + 1] * inverse + color[1] * alpha
  );
  image.data[index + 2] = Math.round(
    image.data[index + 2] * inverse + color[2] * alpha
  );
  image.data[index + 3] = 255;
}

function fillRect(image, x, y, width, height, color, alpha = 1) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      blendPixel(image, px, py, color, alpha);
    }
  }
}

function drawText(image, text, x, y, scale = 3) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] || FONT[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        fillRect(
          image,
          cursor + column * scale,
          y + row * scale,
          scale,
          scale,
          [244, 255, 233],
          1
        );
      }
    }
    cursor += 6 * scale;
  }
}

function copyImage(target, source, offsetX) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = (y * target.width + offsetX) * 4;
    source.data.copy(
      target.data,
      targetStart,
      sourceStart,
      sourceStart + source.width * 4
    );
  }
}

function makeStrip(images, labels) {
  const height = images[0].height;
  if (images.some((image) => image.height !== height)) {
    throw new Error("Comparison strip heights differ");
  }
  const width = images.reduce((sum, image) => sum + image.width, 0);
  const output = {
    width,
    height,
    data: Buffer.alloc(width * height * 4)
  };
  let offsetX = 0;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    copyImage(output, image, offsetX);
    const labelWidth = labels[index].length * 18 + 22;
    fillRect(output, offsetX + 10, 10, labelWidth, 31, [4, 14, 10], 0.82);
    drawText(output, labels[index], offsetX + 20, 15, 3);
    offsetX += image.width;
  }
  return output;
}

function makeDiff(before, after) {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Diff image dimensions differ");
  }
  const output = {
    width: before.width,
    height: before.height,
    data: Buffer.alloc(before.data.length)
  };
  let sum = 0;
  let changed = 0;
  let maximum = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(before.data[index + channel] - after.data[index + channel]);
      output.data[index + channel] = delta;
      sum += delta;
      maximum = Math.max(maximum, delta);
      if (delta > 12) pixelChanged = true;
    }
    output.data[index + 3] = 255;
    if (pixelChanged) changed += 1;
  }
  const pixels = before.width * before.height;
  return {
    image: output,
    metrics: {
      meanAbsoluteRgbDifference: Number((sum / (pixels * 3)).toFixed(3)),
      changedPixelRatio: Number((changed / pixels).toFixed(6)),
      maxChannelDifference: maximum
    }
  };
}

async function artifact(file) {
  const record = await fileRecord(verificationRoot, file);
  return { file: record.file, bytes: record.bytes, sha256: record.sha256 };
}

async function updateRuntimeReport(file, artifactFiles, metadata) {
  const report = JSON.parse(await readFile(resolve(verificationRoot, file), "utf8"));
  report.generatedAt = metadata.generatedAt;
  report.project = PROJECT;
  report.runtimeMarker = RUNTIME_MARKER;
  report.buildFingerprint = metadata.buildFingerprint;
  report.sourceTreeSha256 = metadata.sourceTreeSha256;
  report.artifacts = [];
  for (const artifactFile of artifactFiles) {
    report.artifacts.push(await artifact(artifactFile));
  }
  await writeFile(
    resolve(verificationRoot, file),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
}

const buildFingerprint = treeHash(await collectBuildRecords(root));
const sourceTreeSha256 = treeHash(await collectSourceRecords(root));
const generatedAt = new Date().toISOString();

const sets = [
  {
    name: "beginner",
    original: "baseline/original-mossfall-leaf-1-1280x720.png",
    before: "baseline/target-before-beginner-b01-1280x720.png",
    after: "after/target-after-beginner-b01-1280x720.png",
    strip: "comparison/beginner-original-before-after-1280x720.png",
    diff: "comparison/beginner-before-after-diff-1280x720.png"
  },
  {
    name: "advanced",
    original: "baseline/original-mossfall-leaf-5-1280x720.png",
    before: "baseline/target-before-advanced-a05-1280x720.png",
    after: "after/target-after-advanced-a05-1280x720.png",
    strip: "comparison/advanced-original-before-after-1280x720.png",
    diff: "comparison/advanced-before-after-diff-1280x720.png"
  }
];

const comparisonSets = [];
for (const set of sets) {
  const original = await loadImage(set.original);
  const before = await loadImage(set.before);
  const after = await loadImage(set.after);
  await saveImage(
    set.strip,
    makeStrip(
      [original, before, after],
      ["ORIGINAL MOSSFALL", "TARGET BEFORE", "TARGET AFTER"]
    )
  );
  const difference = makeDiff(before, after);
  await saveImage(set.diff, difference.image);
  comparisonSets.push({
    name: set.name,
    labelsEmbedded: true,
    panelOrder: ["Original Mossfall", "Target Before", "Target After"],
    sources: [
      await artifact(set.original),
      await artifact(set.before),
      await artifact(set.after)
    ],
    strip: await artifact(set.strip),
    diff: await artifact(set.diff),
    ...difference.metrics
  });
}

const comparisonArtifacts = [];
for (const set of comparisonSets) {
  comparisonArtifacts.push(...set.sources, set.strip, set.diff);
}
await writeFile(
  resolve(verificationRoot, "comparison/comparison-report.json"),
  `${JSON.stringify(
    {
      generatedAt,
      project: PROJECT,
      runtimeMarker: RUNTIME_MARKER,
      buildFingerprint,
      sourceTreeSha256,
      labelsEmbedded: true,
      panelOrder: ["Original Mossfall", "Target Before", "Target After"],
      sets: comparisonSets,
      artifacts: comparisonArtifacts
    },
    null,
    2
  )}\n`,
  "utf8"
);

await updateRuntimeReport(
  "reports/dynamic-runtime-report.json",
  [
    "after/dynamic-rolling-frame-01-1280x720.png",
    "after/dynamic-rolling-frame-02-1280x720.png",
    "after/dynamic-capture-pulse-1280x720.png"
  ],
  { generatedAt, buildFingerprint, sourceTreeSha256 }
);
await updateRuntimeReport(
  "reports/touch-rolling-runtime-report.json",
  [
    "after/mobile-landscape-active-844x390.png",
    "after/mobile-landscape-motion-frame-01-844x390.png",
    "after/mobile-landscape-motion-frame-02-844x390.png",
    "comparison/mobile-landscape-motion-frame-diff-844x390.png"
  ],
  { generatedAt, buildFingerprint, sourceTreeSha256 }
);

console.log(
  `Generated labeled supplemental evidence for build ${buildFingerprint.slice(0, 12)}`
);
