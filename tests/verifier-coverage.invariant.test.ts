import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Attack cases are only worth anything replayed, and a case that disappears is silent.
 *
 * `pnpm verify:guardrails` reports 43/43 and CI runs it on every push, so a case that goes RED is
 * loud. A case that is deleted, or quietly weakened until it cannot fail, changes the denominator
 * and nothing else — the same shape as the `expect: /...|error/` that sat in the score for two
 * sessions passing on the bare word "error".
 *
 * This freezes what has been demonstrated. Every entry below was a real bypass someone found and
 * closed; removing its case is now a failing test rather than a smaller number. Adding cases is
 * free, which is the direction we want to be cheap.
 *
 * ADR-0051 says plainly that no mechanism here derives the verifier's case list — somebody decides
 * what to try. This does not change that. It makes the list ratchet in one direction.
 */
const DEMONSTRATED: readonly string[] = [
  // Layering, and the upward edges the ranks permit
  'kernel (rank 0) imports save (rank 5)',
  'sim imports rules-compiler - ALLOWED by the ranks, so it needs its own rule',
  'save imports sim, coupling the file format to the in-memory layout',
  'modding-api re-exports the instruction set to mod authors',
  'save imports isa, the first step to caching bytecode in a .fsav',
  'a content pack reaches past modding-api into the kernel',
  'the same forbidden import, but hidden in a .test.ts file',
  'persisting bytecode through the DATA path, which every import rule leaves open',

  // The doctrine itself
  'disabling save-no-sim while save/CLAUDE.md still forbids the import',
  'writing a new prohibition into a CLAUDE.md with no rule behind it',

  // Invariant 1
  'forging a ContentId with a cast instead of parseContentId',
  'forging a ContentId with an angle-bracket assertion instead of `as`',
  'adding unsafeContentId beside parseContentId, where the lint is off',

  // Invariant 4, one entry per shape that once walked past the walker
  'adding a callback parameter to a public sim API',
  'a callback on a METHOD of an exported class, not on a bare function',
  "an unconstrained generic, which the walker's own comment predicted",
  'a callback on an exported OBJECT LITERAL, which has neither call nor construct signatures',
  'a callback inside an ARRAY of records, reached only through type arguments',

  // Invariant 5, and the two ways coverage was lost
  'an object literal inside a hot-path function body',
  'the SAME object literal, but at module level in hot/',
  'an allocating array method in a hot-path function body',
  'delegating the allocation to a helper one directory above hot/',
  'adding a hot function nobody measures',
  'moving a hot function OUT of hot/, where the directory-derived coverage lost it',

  // Invariant 7
  'Math.random inside sim',
  'reaching randomness through crypto, where Math.random is shut',
  'reaching the clock through an alias and a constructor, where Date.now is sealed',
  'reading performance.timeOrigin, which is a property and not a call',
  'sorting pack directories with bare localeCompare',
  'an Intl.Collator with no locale - the fix the old lint message recommended',
  'dropping the topological tie-break, so ties fall back to insertion order',
  'dropping the loader pre-sort, which decides which duplicate is reported first',
  'reversing the loader pre-sort, which removing it did not reveal',
  'a service locator on globalThis, a dependency the graph cannot see',

  // Invariants 2, 3, 6 and the meta guardrails
  'raising CURRENT_VERSION without adding the migration',
  'renaming a v2 header key in the writer, the reader AND the migration at once',
  'reaching past SimPort to the raw worker channel',
  'sending a command object through SimPort instead of an index',
  'a type error inside a content pack, where a mod author would write one',
  'an unguarded JSON.parse on a sidecar file, the way the doc comment invites',
  'adding a schema field without regenerating the published JSON Schema',
  'letting the root CLAUDE.md grow past 50 lines',
  'padding the root CLAUDE.md without adding a line',
];

function declaredCases(): string[] {
  const source = readFileSync(path.join(repoRoot, 'tools/verify-guardrails.mjs'), 'utf8');
  return [...source.matchAll(/^\s*breaks: (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm)].map(
    (match) => (match[1] ?? match[2] ?? '').replace(/\\'/g, "'"),
  );
}

describe('invariant: a demonstrated bypass keeps its case', () => {
  it('the parser finds the cases at all', () => {
    // Otherwise every assertion below passes by finding nothing, which is the failure mode this
    // file exists to make loud.
    expect(declaredCases().length).toBeGreaterThanOrEqual(DEMONSTRATED.length);
  });

  it.each(DEMONSTRATED)('still covers: %s', (breaks) => {
    expect(declaredCases()).toContain(breaks);
  });

  it('every case names an invariant or an ADR', () => {
    const source = readFileSync(path.join(repoRoot, 'tools/verify-guardrails.mjs'), 'utf8');
    const invariants = [...source.matchAll(/^\s*invariant: '([^']+)'/gm)].map((m) => m[1]!);
    expect(invariants.length).toBe(declaredCases().length);
    for (const label of invariants) expect(label).toMatch(/^(\d|ADR-|Layering|Meta)/);
  });
});
