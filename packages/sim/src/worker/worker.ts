/**
 * The simulation worker. Deliberately empty.
 *
 * There is no game loop in this session. What this file exists to prove is the boundary: it
 * receives the SharedArrayBuffer once at init, and from then on communicates only through Atomics
 * on the control block. Nothing is structured-cloned, ever.
 *
 * It is instantiated for real by the renderer rather than merely described, so that breaking the
 * contract can be observed rather than argued about.
 */
import { type BoundaryPayload, CTRL, STATUS_BOOTING, STATUS_READY } from '../boundary.js';

interface WorkerScope {
  onmessage: ((event: { readonly data: BoundaryPayload }) => void) | null;
  postMessage: (payload: BoundaryPayload) => void;
}

const scope = globalThis as unknown as WorkerScope;

let control: Int32Array | null = null;

scope.onmessage = (event) => {
  const data = event.data;

  if (data instanceof SharedArrayBuffer) {
    // The one and only structured payload that ever crosses: the buffer itself, once.
    control = new Int32Array(data, 0, 4);
    Atomics.store(control, CTRL.STATUS, STATUS_BOOTING);
    Atomics.store(control, CTRL.TICK, 0);
    Atomics.store(control, CTRL.STATUS, STATUS_READY);
    Atomics.notify(control, CTRL.STATUS);
    return;
  }

  // Everything afterwards is an integer. Here: a heartbeat request.
  if (control !== null && typeof data === 'number') {
    Atomics.add(control, CTRL.HEARTBEAT, 1);
    Atomics.notify(control, CTRL.HEARTBEAT);
  }
};
