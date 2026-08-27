import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, ipcMain, protocol } from 'electron';
import { loadPacks } from '@myfactorio/runtime';

/**
 * The Electron shell.
 *
 * Two things here are load-bearing rather than boilerplate.
 *
 * The window opens BEFORE the outcome of loading content is known, and a load failure is rendered
 * as text rather than thrown. Deleting the content directory has to leave a running application
 * that explains itself, not a process that dies before it draws anything.
 *
 * The renderer is served over a custom app:// protocol carrying COOP/COEP. That is not decoration
 * either: SharedArrayBuffer requires cross-origin isolation, Chromium has enforced that since 92,
 * and Electron follows Chromium. Over file:// there is no SAB, and therefore no simulation worker.
 */

const RENDERER_ORIGIN = 'app://local';
const isE2E = process.env['MYFACTORIO_E2E'] === '1';

const distDir = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(distDir, '../renderer');

function packsDir(): string {
  return process.env['MYFACTORIO_PACKS_DIR'] ?? path.join(app.getAppPath(), '../../packs');
}

interface Status {
  readonly ok: boolean;
  readonly headline: string;
  readonly detail: string;
  readonly packs: readonly string[];
}

async function resolveStatus(): Promise<Status> {
  const result = await loadPacks({
    packsDir: packsDir(),
    // The shell names the directory permitted to own the reserved namespace. The loader has no
    // opinion about which pack is "the base one" — that is invariant 6.
    reservedNamespaceOwner: 'core-empty',
  });

  if (!result.ok) {
    return {
      ok: false,
      headline: 'No content loaded',
      detail: result.error.message,
      packs: [],
    };
  }

  return {
    ok: true,
    headline: `${result.value.packs.length} content pack(s) loaded`,
    detail: `Load order: ${result.value.order.join(' -> ')}. ${result.value.registry.size} content id(s) registered.`,
    packs: result.value.order,
  };
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const target = path.join(rendererDir, requested);

    // Nothing outside the built renderer directory is ever served. Compared as a path relation, not
    // as a string prefix: `startsWith(rendererDir)` also accepts a sibling called `renderer-other`,
    // and this is the only check standing between the protocol handler and the filesystem.
    const contained = path.relative(rendererDir, target);
    if (contained.startsWith('..') || path.isAbsolute(contained)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await readFile(target);
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
          // Cross-origin isolation. Without both of these, SharedArrayBuffer is unavailable.
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function main(): Promise<void> {
  await app.whenReady();
  registerAppProtocol();

  const status = await resolveStatus();
  ipcMain.handle('myfactorio:status', () => status);

  // Machine-readable, so tools/e2e-no-core.mjs can assert on the real thing rather than a mock.
  process.stdout.write(`[myfactorio] status ${JSON.stringify(status)}\n`);

  const window = new BrowserWindow({
    width: 900,
    height: 600,
    show: !isE2E,
    webPreferences: {
      preload: path.join(distDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The renderer reports once it has finished starting, rather than main reading state as soon as
  // loadURL resolves. loadURL settles on the load event, while the renderer's own startup - asking
  // for status, allocating the shared buffer, waiting for the worker to reach ready - is still in
  // flight. Reading at that moment would race, and would race differently on a slower machine.
  ipcMain.handle('myfactorio:rendered', (_event, payload: unknown) => {
    process.stdout.write(`[myfactorio] renderer ${JSON.stringify(payload)}\n`);
    if (isE2E) app.quit();
  });

  if (isE2E) {
    // Never hang a CI run because the renderer failed to report. Quitting without the line is a
    // legible failure; hanging is not.
    setTimeout(() => {
      process.stdout.write('[myfactorio] renderer-timeout\n');
      app.quit();
    }, 20_000).unref();
  }

  await window.loadURL(`${RENDERER_ORIGIN}/index.html`);

  if (isE2E) process.stdout.write('[myfactorio] renderer-ready\n');
}

app.on('window-all-closed', () => {
  app.quit();
});

// Even a catastrophic startup failure reports itself instead of vanishing.
main().catch((cause: unknown) => {
  process.stderr.write(`[myfactorio] fatal ${String(cause)}\n`);
  process.exitCode = 1;
  app.quit();
});
