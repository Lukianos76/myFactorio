import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NonDeterminismError, sealAmbientSources } from '@myfactorio/sim';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = path.join(repoRoot, 'packages/sim/src/determinism.ts');
const moduleUrl = pathToFileURL(sourceFile).href;

/**
 * Every alias the lint could not see.
 *
 * None of these are hypothetical: each was demonstrated to pass `pnpm check` while the ban on
 * `Math.random` was in force. They stay here as a permanent record that a name-based rule has a
 * ceiling, and of exactly where that ceiling was.
 *
 * Sealing is irreversible by design, so this runs in a child process rather than in the test realm
 * - a sealed Math.random would follow every later test file in the run.
 */
const ALIASES: readonly (readonly [label: string, code: string])[] = [
  ['direct call', 'Math.random()'],
  ['aliased object', 'const M = Math; M.random()'],
  ['destructured', 'const { random } = Math; random()'],
  ['through globalThis', 'globalThis.Math.random()'],
  ['computed key', "Math['random']()"],
  ['reflected', 'Reflect.get(Math, "random")()'],
  ['Date.now', 'Date.now()'],
  ['crypto.getRandomValues', 'crypto.getRandomValues(new Uint32Array(1))'],
  ['putting the original back', 'Math.random = () => 0.5; Math.random()'],
];

interface AliasResult {
  readonly label: string;
  readonly threw: boolean;
  readonly message: string;
}

function runSealed(): readonly AliasResult[] {
  const script = `
    import { sealAmbientSources } from ${JSON.stringify(moduleUrl)};
    const sealed = sealAmbientSources();
    if (sealed.length === 0) throw new Error('sealAmbientSources sealed nothing');
    const cases = ${JSON.stringify(ALIASES)};
    const results = cases.map(([label, code]) => {
      try {
        new Function(code)();
        return { label, threw: false, message: '' };
      } catch (error) {
        return { label, threw: true, message: String(error && error.message) };
      }
    });
    process.stdout.write(JSON.stringify(results));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  return JSON.parse(out) as readonly AliasResult[];
}

describe('invariant: sealing beats aliasing', () => {
  const results = runSealed();

  it('reaches every case', () => {
    // Otherwise a child process that silently produced fewer results would leave the aliases the
    // lint cannot see untested, which is the whole point of the file.
    expect(results.map((r) => r.label)).toEqual(ALIASES.map(([label]) => label));
  });

  it.each(ALIASES.map(([label]) => label))('%s is refused once sealed', (label) => {
    const result = results.find((r) => r.label === label);
    expect(result?.threw, `${label} did not throw`).toBe(true);
    expect(result?.message).toMatch(/not available inside the simulation|Cannot assign|read only/i);
  });
});

describe('invariant: the denial explains itself', () => {
  it('carries a typed error naming the source and the way out', () => {
    const error = new NonDeterminismError('Math.random');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NonDeterminismError');
    expect(error.message).toContain('Math.random');
    expect(error.message).toContain('seeded PRNG');
    expect(typeof sealAmbientSources).toBe('function');
  });
});

describe('invariant: determinism.ts stays the only file reaching globals by string key', () => {
  /**
   * The file-level exemption problem: the one file allowed to do something is also the one file
   * where anyone can add more of it. Freezing the export list is what stops it becoming a laundering
   * service - the way an `unsafeContentId` could have been added next to `parseContentId`.
   */
  it('exports exactly what it is meant to', () => {
    const source = readFileSync(sourceFile, 'utf8');
    const exported = [...source.matchAll(/^export (?:function|class|const) (\w+)/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(['NonDeterminismError', 'sealAmbientSources']);
  });
});
