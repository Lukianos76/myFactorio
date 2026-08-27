import { type BoundaryPayload, CTRL_SLOTS } from './boundary.js';

/**
 * The host-side handle on the simulation worker (invariant 3).
 *
 * `boundaryMessage` was a typed gate that nothing forced you through: the renderer held a raw
 * Worker, and `worker.postMessage({ cmd: 'tick' })` compiled cleanly. A type constrains only the
 * code that mentions it, so as long as the raw channel stayed reachable the invariant documented an
 * intention rather than imposing it.
 *
 * `SimPort` closes the channel instead of guarding it. `send` accepts a `BoundaryPayload` and there
 * is no other way through; the lint rule on `postMessage` outside this file stops anyone reopening
 * it. That is the difference between a gate and a wall.
 *
 * The parameter is a DOM `Worker`, a host object like `SharedArrayBuffer` — not a callback, and not
 * something a mod supplies. Invariant 4 is about content providing behaviour, and it holds.
 */
export interface SimPort {
  /** Indices only. The buffer crosses once, at attach. */
  send(payload: BoundaryPayload): void;
  /** The control block, for Atomics. Reading state is not messaging. */
  readonly control: Int32Array;
  stop(): void;
}

export function attachSimPort(worker: Worker, shared: SharedArrayBuffer): SimPort {
  const control = new Int32Array(shared, 0, CTRL_SLOTS);

  // The one and only structured payload that ever crosses, sent here so no caller has to remember.
  worker.postMessage(shared);

  return {
    send(payload: BoundaryPayload): void {
      worker.postMessage(payload);
    },
    control,
    stop(): void {
      worker.terminate();
    },
  };
}
