/**
 * Invariant 6, verified against the real thing.
 *
 * The unit test in packages/runtime asserts that the loader reports a clear failure for an empty
 * content directory. This launches the actual Electron shell against an actual empty directory and
 * checks that it starts, renders, says something useful, and exits cleanly.
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

console.log('building the desktop shell...');
const build = await run('pnpm', ['--filter', '@myfactorio/desktop', 'build'], { cwd: repoRoot });
if (build.code !== 0) {
  console.error(build.stdout + build.stderr);
  process.exit(1);
}

const electron = require('electron');
const emptyPacks = await mkdtemp(path.join(tmpdir(), 'myfactorio-e2e-'));
let ok = true;

try {
  console.log(`launching with an empty content directory: ${emptyPacks}\n`);
  const result = await run(electron, ['.'], {
    cwd: desktopDir,
    env: { ...process.env, MYFACTORIO_E2E: '1', MYFACTORIO_PACKS_DIR: emptyPacks },
  });

  const statusLine = result.stdout.split('\n').find((line) => line.startsWith('[myfactorio] status '));
  const status = statusLine ? JSON.parse(statusLine.slice('[myfactorio] status '.length)) : null;

  ok = report('the app exits cleanly rather than crashing', result.code === 0, `exit code ${result.code}\n${result.stderr}`) && ok;
  ok = report('the renderer actually loaded', result.stdout.includes('[myfactorio] renderer-ready'), result.stdout) && ok;
  ok = report('a status was reported', status !== null, result.stdout) && ok;
  ok = report('it reports failure rather than pretending', status?.ok === false, JSON.stringify(status)) && ok;
  ok = report('the message names the directory it looked in', status?.detail?.includes(emptyPacks) ?? false, status?.detail) && ok;
  ok = report('the message names the file it wanted', status?.detail?.includes('pack.json') ?? false, status?.detail) && ok;

  console.log(`\nmessage shown to the player:\n  ${status?.detail ?? '(none)'}`);
} finally {
  await rm(emptyPacks, { recursive: true, force: true });
}

process.exit(ok ? 0 : 1);
