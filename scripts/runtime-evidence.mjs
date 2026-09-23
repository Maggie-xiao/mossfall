import { createRuntimeCore } from "../src/adapters/runtime-core.js";
import { ADVANCED_DATA, BEGINNER_DATA } from "../src/levels.js";

const FIXED_DT = 1 / 120;
const allLevels = [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels];
const levelById = (id) => allLevels.find((level) => level.id === id);

function traceB01() {
  const { field, runtimeLevel, sim } = createRuntimeCore(levelById("B01"));
  const bug = sim.bugs[0];
  let capture = null;
  const samples = [];
  sim.events.on("capture", ({ bug: captured, hole }) => {
    capture = {
      timeSec: sim.time,
      bugId: captured.id,
      holeId: hole.id,
      holdT: captured.captureHoldT
    };
  });
  for (let step = 0; step < 2400 && !capture; step += 1) {
    sim.setTilt(-0.13, 0);
    sim.step(FIXED_DT);
    if (step % 60 === 0 || bug.captureHoldT > 0) {
      samples.push({
        step,
        timeSec: sim.time,
        z: bug.z,
        speed: bug.speed,
        holdT: bug.captureHoldT || 0,
        state: bug.state
      });
    }
  }
  return {
    capture,
    sampleCount: samples.length,
    samples,
    singleField:
      runtimeLevel.field === field &&
      sim.field === field
  };
}

function stress(id) {
  const mode = id.startsWith("A") ? "advanced" : "beginner";
  let finiteStates = 0;
  for (let cycle = 0; cycle < 12; cycle += 1) {
    const { field, sim } = createRuntimeCore(levelById(id), mode);
    const sign = cycle % 2 === 0 ? 1 : -1;
    for (let step = 0; step < 360; step += 1) {
      sim.setTilt(0.08 * sign, -0.07 * sign);
      sim.step(FIXED_DT);
    }
    if (
      sim.field === field &&
      sim.bugs.every(
        (bug) =>
          Number.isFinite(bug.x) &&
          Number.isFinite(bug.y) &&
          Number.isFinite(bug.z)
      )
    ) {
      finiteStates += 1;
    }
    sim.dispose();
  }
  return {
    id,
    cycles: 12,
    finiteStates,
    pass: finiteStates === 12
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  b01: traceB01(),
  stress: ["B03", "A03", "A08"].map(stress)
};

console.log(JSON.stringify(report, null, 2));
