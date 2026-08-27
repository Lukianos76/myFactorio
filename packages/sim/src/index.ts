/**
 * The public surface of the simulation.
 *
 * Two invariants shape everything exported here. Nothing accepts a function (invariant 4): a mod
 * supplies data, never behaviour, and tests/guardrails.invariant.test.ts walks these signatures
 * with the compiler API to keep that true. Nothing crosses the worker boundary but indices and
 * the shared buffer (invariant 3), which is what boundary.ts encodes in the type system.
 */
export {
  type BoundaryPayload,
  type TransferSafe,
  boundaryMessage,
  CTRL,
  CTRL_SLOTS,
  CTRL_BYTES,
  STATUS_BOOTING,
  STATUS_READY,
  STATUS_STOPPING,
} from './boundary.js';

export { type SimPort, attachSimPort } from './port.js';
export { NonDeterminismError, sealAmbientSources } from './determinism.js';

export {
  type DataOnly,
  type World,
  type WorldSpec,
  WORLD_STRIDE,
  worldByteLength,
  viewWorld,
} from './world.js';

export {
  NOT_FOUND,
  fillRegion,
  copyRegion,
  countValue,
  findFirst,
} from './hot/buffer-ops.js';
