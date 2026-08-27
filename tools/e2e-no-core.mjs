/**
 * Invariant 6, and invariant 3, verified against the real thing.
 *
 * The unit tests assert that the loader reports a clear failure for an empty content directory and
 * that the worker boundary only accepts indices and a shared buffer. Both are claims about code
 * that has never run inside Electron. This launches the actual shell twice: once with no content
 * pack, once with the shipped one, and checks what the application actually did.
 *
 * It lives outside `pnpm check` on purpose: spawning Electron costs seconds and needs a display,
 * and the 30-second budget is for the loop developers run constantly.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(repoRoot, 'apps/desktop');
const require = createRequire(path.join(desktopDir, 'noop.cjs'));

const NEWLINE = '\n';

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function report(label, passed, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
  if (!passed && detail) console.log(`      ${detail}`);
  return passed;
}

function launch(packsDir) {
  return run(require('electron'), ['.'], {
    cwd: desktopDir,
    env: { ...process.env, MYFACTORIO_E2E: '1', MYFACTORIO_PACKS_DIR: packsDir },
  });
}

function readLine(stdout, prefix) {
  const line = stdout.split(NEWLINE).find((entry) => entry.startsWith(prefix));
  return line ? JSON.parse(line.slice(prefix.length)) : null;
}

console.log('building the desktop shell...');
const build = await run('pnpm', ['--filter', '@myfactorio/desktop', 'build'], { cwd: repoRoot });
if (build.code !== 0) {
  console.error(build.stdout + build.stderr);
  process.exit(1);
}

const emptyPacks = await mkdtemp(path.join(tmpdir(), 'myfactorio-e2e-'));
let ok = true;

try {
  console.log(`${NEWLINE}--- no content pack at all: ${emptyPacks}${NEWLINE}`);
  const missing = await launch(emptyPacks);
  const missingStatus = readLine(missing.stdout, '[myfactorio] status ');

  ok = report('the app exits cleanly rather than crashing', missing.code === 0, `exit code ${missing.code}${NEWLINE}${missing.stderr}`) && ok;
  ok = report('the renderer actually loaded', missing.stdout.includes('[myfactorio] renderer-ready'), missing.stdout) && ok;
  ok = report('a status was reported', missingStatus !== null, missing.stdout) && ok;
  ok = report('it reports failure rather than pretending', missingStatus?.ok === false, JSON.stringify(missingStatus)) && ok;
  ok = report('the message names the directory it looked in', missingStatus?.detail?.includes(emptyPacks) ?? false, missingStatus?.detail) && ok;
  ok = report('the message names the file it wanted', missingStatus?.detail?.includes('pack.json') ?? false, missingStatus?.detail) && ok;

  console.log(`${NEWLINE}message shown to the player:${NEWLINE}  ${missingStatus?.detail ?? '(none)'}`);

  /*
   * The happy path.
   *
   * Invariant 3 is enforced at compile time, but until the worker actually boots and answers
   * through Atomics on the shared control block, that is a claim rather than an observation.
   * SharedArrayBuffer needs cross-origin isolation, so this doubles as proof that the app://
   * protocol handler really emits COOP/COEP — over file:// there would be no SAB and no worker.
   */
  console.log(`${NEWLINE}--- with the shipped content pack${NEWLINE}`);
  const happy = await launch(path.join(repoRoot, 'packs'));
  const happyStatus = readLine(happy.stdout, '[myfactorio] status ');
  const rendered = readLine(happy.stdout, '[myfactorio] renderer ');

  ok = report('the app exits cleanly', happy.code === 0, `exit code ${happy.code}${NEWLINE}${happy.stderr}`) && ok;
  ok = report('the base pack loads through the ordinary mod path', happyStatus?.ok === true, JSON.stringify(happyStatus)) && ok;
  ok = report('the renderer is cross-origin isolated (COOP/COEP arrived)', rendered?.isolated === true, JSON.stringify(rendered)) && ok;
  ok = report('the worker booted and answered over the shared buffer', /worker: ready/.test(rendered?.worker ?? ''), rendered?.worker) && ok;
  ok = report('an integer-only message round-tripped after the handover', /heartbeat [1-9]/.test(rendered?.worker ?? ''), rendered?.worker) && ok;

  console.log(`${NEWLINE}loader:  ${happyStatus?.detail ?? '(none)'}`);
  console.log(`worker:  ${rendered?.worker ?? '(none)'}`);
} finally {
  await rm(emptyPacks, { recursive: true, force: true });
}

process.exit(ok ? 0 : 1);
