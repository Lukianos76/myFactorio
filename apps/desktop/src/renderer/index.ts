import {
  CTRL,
  STATUS_READY,
  boundaryMessage,
  worldByteLength,
} from '@myfactorio/sim';

/**
 * There is no rendering in this session. What the renderer does is show the load status and start
 * the (empty) simulation worker, so that the worker boundary exists as running code rather than as
 * a description of one.
 */

interface Status {
  readonly ok: boolean;
  readonly headline: string;
  readonly detail: string;
}

declare global {
  interface Window {
    readonly myfactorio: { status: () => Promise<Status> };
  }
}

const statusEl = document.getElementById('status');
const workerEl = document.getElementById('worker');

function write(element: HTMLElement | null, text: string, ok: boolean): void {
  if (element === null) return;
  element.textContent = text;
  element.className = ok ? 'ok' : 'bad';
}

const status = await window.myfactorio.status();
write(statusEl, `${status.headline}
${status.detail}`, status.ok);

if (!crossOriginIsolated) {
  // Worth stating plainly: without COOP/COEP there is no SharedArrayBuffer and therefore no
  // simulation at all. Silently degrading here would hide a broken protocol handler for months.
  write(workerEl, 'worker: not started - the renderer is not cross-origin isolated (COOP/COEP missing)', false);
} else {
  const spec = { width: 256, height: 256 };
  const shared = new SharedArrayBuffer(worldByteLength(spec));
  const control = new Int32Array(shared, 0, 4);

  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

  // The one and only structured payload that crosses. Everything after this is an integer.
  worker.postMessage(boundaryMessage(shared));

  await Atomics.waitAsync(control, CTRL.STATUS, 0).value;
  const ready = Atomics.load(control, CTRL.STATUS) === STATUS_READY;

  worker.postMessage(boundaryMessage(1));
  write(
    workerEl,
    ready
      ? `worker: ready, sharing ${shared.byteLength} bytes, heartbeat ${Atomics.load(control, CTRL.HEARTBEAT)}`
      : 'worker: did not reach ready',
    ready,
  );
}
