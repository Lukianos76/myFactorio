import { CTRL, STATUS_READY, attachSimPort, worldByteLength } from '@myfactorio/sim';

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
    readonly myfactorio: {
      status: () => Promise<Status>;
      report: (payload: { isolated: boolean; worker: string }) => Promise<void>;
    };
  }
}

const statusEl = document.getElementById('status');
const workerEl = document.getElementById('worker');

let workerLine = '';

function write(element: HTMLElement | null, text: string, ok: boolean): void {
  if (element === null) return;
  element.textContent = text;
  element.className = ok ? 'ok' : 'bad';
}

function writeWorker(text: string, ok: boolean): void {
  workerLine = text;
  write(workerEl, text, ok);
}

const status = await window.myfactorio.status();
write(statusEl, `${status.headline}
${status.detail}`, status.ok);

if (!crossOriginIsolated) {
  // Worth stating plainly: without COOP/COEP there is no SharedArrayBuffer and therefore no
  // simulation at all. Silently degrading here would hide a broken protocol handler for months.
  writeWorker('worker: not started - the renderer is not cross-origin isolated (COOP/COEP missing)', false);
} else {
  const spec = { width: 256, height: 256 };
  const shared = new SharedArrayBuffer(worldByteLength(spec));

  // `new Worker` stays here because Vite only bundles a worker when it can see this exact shape.
  // The handle does not survive the next line: attachSimPort takes it, sends the buffer once, and
  // hands back a SimPort whose only channel is send(BoundaryPayload). From here on there is no raw
  // postMessage in reach - the lint rule makes sure of it.
  const port = attachSimPort(
    new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }),
    shared,
  );
  const control = port.control;

  await Atomics.waitAsync(control, CTRL.STATUS, 0).value;
  const ready = Atomics.load(control, CTRL.STATUS) === STATUS_READY;

  // The second half of invariant 3: after the one buffer handover, traffic is integers only.
  // Waiting for the worker to bump the heartbeat slot is what turns that from a compile-time
  // constraint into something observed at runtime.
  const beforeBeat = Atomics.load(control, CTRL.HEARTBEAT);
  port.send(1);
  await Atomics.waitAsync(control, CTRL.HEARTBEAT, beforeBeat, 5000).value;
  const beat = Atomics.load(control, CTRL.HEARTBEAT);

  writeWorker(
    ready
      ? `worker: ready, sharing ${shared.byteLength} bytes, heartbeat ${beat}`
      : 'worker: did not reach ready',
    ready && beat > beforeBeat,
  );
}

// Startup is finished. Main is listening for this rather than reading our DOM at an arbitrary
// moment, so what the harness observes is what actually happened, not what had happened yet.
await window.myfactorio.report({ isolated: crossOriginIsolated, worker: workerLine });
