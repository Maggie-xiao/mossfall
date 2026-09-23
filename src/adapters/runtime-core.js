import { normalizeRuntimeLevel } from "./runtime-level.js";
import { TableTiltLeafSim } from "./table-tilt-leaf-sim.js";
import { Field } from "../mossfall/sim/field.js";

export function createRuntimeCore(level, mode = "beginner") {
  const runtimeLevel = normalizeRuntimeLevel(level, mode);
  const field = new Field(runtimeLevel.board);
  runtimeLevel.field = field;
  const sim = new TableTiltLeafSim(field, runtimeLevel.board, {
    mode: runtimeLevel.mode
  });
  sim.reset(runtimeLevel, field);
  return { runtimeLevel, field, sim };
}
