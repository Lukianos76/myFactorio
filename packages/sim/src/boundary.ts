/**
 * The worker boundary (invariant 3).
 *
 * Exactly two things may cross: indices, and the shared buffer itself. No structured-clone
 * payloads, no command objects, no strings. State lives in the SharedArrayBuffer, and messages
 * are integers naming slots in it.
 *
 * This is a type-level guarantee rather than a runtime check, which is what makes it useful:
 * `worker.postMessage(boundaryMessage({ cmd: 'tick' }))` does not compile.
 */
export type BoundaryPayload = number | SharedArrayBuffer;

/** Resolves to T when T may legally cross the boundary, and to never otherwise. */
export type TransferSafe<T> = [T] extends [BoundaryPayload] ? T : never;

/**
 * Identity at runtime, a gate at compile time. Wrap every payload handed to postMessage.
 * Deliberately takes no port: no sim API accepts a function, and a port carries methods.
 */
export function boundaryMessage<const T>(payload: TransferSafe<T>): BoundaryPayload {
  return payload as BoundaryPayload;
}

/**
 * Int32 slot indices into the control block at the head of the shared buffer. Everything the two
 * sides say to each other is an Atomics operation on one of these.
 */
export const CTRL = {
  /** Monotonic tick counter written by the worker. */
  TICK: 0,
  /** Worker lifecycle: 0 booting, 1 ready, 2 stopping. */
  STATUS: 1,
  /** Bumped by the worker on every heartbeat so the host can tell it is alive. */
  HEARTBEAT: 2,
} as const;

export const CTRL_SLOTS = 4;
export const CTRL_BYTES = CTRL_SLOTS * Int32Array.BYTES_PER_ELEMENT;

export const STATUS_BOOTING = 0;
export const STATUS_READY = 1;
export const STATUS_STOPPING = 2;
