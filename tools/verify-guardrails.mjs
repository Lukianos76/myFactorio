/**
 * Breaks each invariant on purpose and checks that a tool refuses.
 *
 * A guardrail nobody has ever seen fire is a guardrail nobody knows is wired up.
 *
 * This runs in a THROWAWAY GIT WORKTREE, never in your working tree. The earlier version edited
 * files in place, which meant it demanded a clean tree, could not run alongside anything else, and
 * left the repository broken on Ctrl-C. It also once clobbered a reviewer's files mid-review.
 * Isolation removes all three problems and, as a side effect, removes the clean-tree precondition:
 * uncommitted changes are carried into the worktree, so what gets verified is what you have.
 *
 * Untracked files are NOT carried over - a brand new file is invisible to `git diff HEAD`. Stated
 * here, and reported at startup, rather than silently true.
 */
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'noop.cjs'));
const ruleSet = require(path.join(repoRoot, '.dependency-cruiser.cjs')).forbidden;

/**
 * Each case names what it breaks, which tool must refuse, and what the refusal must say.
 *
 * `rule` is not decoration. Case 2 used to assert /no-import-below:rules-compiler|…|error/ while the
 * rule that actually fires is `sim-no-compiler` - so it passed on the bare word "error", which
 * appears in almost any failure output. A case that cannot fail is worse than a missing case,
 * because it still counts towards the score. When `rule` is set, the script checks the name exists
 * in the real rule set AND appears in the output.
 */
const CASES = [
  {
    invariant: 'Layering',
    breaks: 'kernel (rank 0) imports save (rank 5)',
    edits: [['packages/kernel/src/index.ts', (s) => `import '../../save/src/index.js';\n${s}`]],
    tool: 'pnpm arch',
    rule: 'no-import-below:kernel',
  },
  {
    invariant: 'Layering',
    breaks: 'sim imports rules-compiler - ALLOWED by the ranks, so it needs its own rule',
    edits: [['packages/sim/src/index.ts', (s) => `import '../../rules-compiler/src/index.js';\n${s}`]],
    tool: 'pnpm arch',
    rule: 'sim-no-compiler',
  },
  {
    invariant: 'ADR-0014',
    breaks: 'save imports sim, coupling the file format to the in-memory layout',
    edits: [['packages/save/src/index.ts', (s) => `import '../../sim/src/index.js';\n${s}`]],
    tool: 'pnpm arch',
    rule: 'save-no-sim',
  },
  {
    invariant: 'ADR-0013',
    breaks: 'modding-api re-exports the instruction set to mod authors',
    edits: [
      ['packages/modding-api/src/index.ts', (s) => `export { OP } from '../../isa/src/index.js';\n${s}`],
    ],
    tool: 'pnpm arch',
    rule: 'modding-api-no-isa',
  },
  {
    invariant: '2 / ADR-0006',
    breaks: 'save imports isa, the first step to caching bytecode in a .fsav',
    edits: [['packages/save/src/index.ts', (s) => `import '../../isa/src/index.js';\n${s}`]],
    tool: 'pnpm arch',
    rule: 'save-no-isa',
  },
  {
    invariant: '6',
    breaks: 'a content pack reaches past modding-api into the kernel',
    edits: [
      ['packs/core-empty/src/probe.ts', () => "import '../../../packages/kernel/src/index.js';\n"],
    ],
    tool: 'pnpm arch',
    rule: 'packs-only-modding-api',
  },
  {
    invariant: 'ADR-0027',
    breaks: 'the same forbidden import, but hidden in a .test.ts file',
    edits: [
      [
        'packages/kernel/src/scratch.test.ts',
        () => "import { loadPacks } from '../../runtime/src/index.js';\nexport const leak = loadPacks;\n",
      ],
    ],
    tool: 'pnpm arch',
    rule: 'no-import-below:kernel',
  },
  {
    invariant: 'ADR-0027',
    breaks: 'a type error inside a content pack, where a mod author would write one',
    edits: [['packs/core-empty/src/probe.ts', () => 'export const broken: string = 42;\n']],
    tool: 'pnpm typecheck',
    expect: /not assignable to type 'string'/,
  },
  {
    invariant: 'ADR-0026',
    breaks: 'disabling save-no-sim while save/CLAUDE.md still forbids the import',
    edits: [
      [
        '.dependency-cruiser.cjs',
        (s) => s.replace("name: 'save-no-sim',", "name: 'save-no-sim-DISABLED',"),
      ],
    ],
    tool: 'pnpm vitest run tests/doctrine',
    expect: /no dependency-cruiser rule matches|save -> sim/,
  },
  {
    invariant: 'ADR-0026',
    breaks: 'writing a new prohibition into a CLAUDE.md with no rule behind it',
    edits: [
      [
        'packages/runtime/CLAUDE.md',
        (s) => s.replace('## Must never\n', '## Must never\n\n- Import `save`. Invented for this case.\n'),
      ],
    ],
    tool: 'pnpm vitest run tests/doctrine',
    expect: /no dependency-cruiser rule matches|runtime -> save/,
  },
  {
    invariant: 'ADR-0044',
    breaks: 'an unguarded JSON.parse on a sidecar file, the way the doc comment invites',
    edits: [
      [
        'packages/runtime/src/loader.ts',
        (s) =>
          s.replace(
            '  return ok({ dir, dirName, manifest: validated.data });',
            "  const sidecar = await readFile(path.join(dir, 'pack.lock.json'), 'utf8').catch(() => '{');\n" +
              '  JSON.parse(sidecar);\n' +
              '  return ok({ dir, dirName, manifest: validated.data });',
          ),
      ],
    ],
    tool: 'pnpm vitest run packages/runtime',
    // The hostile suite stays GREEN here, and that is the point: the structural guard turns the
    // throw into a Result, so the invariant holds. What breaks is behaviour - loading the shipped
    // pack now reports unexpected-error instead of succeeding. A crash became a legible failure
    // with a named test pointing at it, which is exactly the trade ADR-0044 buys.
    expect: /loads the shipped core-empty pack/,
  },
  {
    invariant: 'ADR-0048',
    breaks: 'persisting bytecode through the DATA path, which every import rule leaves open',
    edits: [
      [
        'apps/desktop/src/main/index.ts',
        (s) =>
          // Through loadPacks, the way the real bypass went. Declaring the parameter shape here
          // would only prove that a hand-written interface typechecks against itself - which is
          // what the first version of this case did, and why it reported MISS.
          `${s}\n` +
          "import { writeSave } from '@myfactorio/save';\n" +
          'export async function cacheProgram(): Promise<Uint8Array | null> {\n' +
          "  const loaded = await loadPacks({ packsDir: packsDir() });\n" +
          '  if (!loaded.ok) return null;\n' +
          '  const first = loaded.value.packs[0];\n' +
          '  if (first === undefined) return null;\n' +
          '  return writeSave({\n' +
          '    version: 2, palette: [], packs: [], migratedFrom: 2,\n' +
          "    chunks: [{ id: 'bytecode', byteOffset: 0, byteLength: first.compiled.program.byteLength, elementSize: 1 }],\n" +
          '    payload: first.compiled.program,\n' +
          '  });\n' +
          '}\n',
      ],
    ],
    // Not an import rule - apps may import anything, and that was the point. LoadedPack simply no
    // longer carries the bytes, so the parameter shape has nothing to bind to.
    tool: 'pnpm typecheck',
    expect: /error TS/,
  },
  {
    invariant: 'ADR-0049',
    breaks: 'a service locator on globalThis, a dependency the graph cannot see',
    edits: [
      [
        'packages/kernel/src/registry.ts',
        (s) =>
          `${s}\nexport const bridge = (globalThis as unknown as { __myfactorio?: unknown }).__myfactorio;\n`,
      ],
    ],
    tool: 'pnpm lint',
    expect: /dependency the graph cannot see/,
  },
  {
    invariant: 'ADR-0050',
    breaks: 'adding a hot function nobody measures',
    edits: [
      [
        'packages/sim/src/hot/buffer-ops.ts',
        (s) =>
          `${s}\nexport function scanRegion(cells: Uint16Array, from: number): number {\n` +
          '  return cells[from] ?? 0;\n}\n',
      ],
      // Exported, because coverage derives from what sim exports rather than from the directory.
      // An unexported hot function is unreachable from outside the package, and whatever calls it
      // is measured with its allocations included - so the export set is the right boundary.
      ['packages/sim/src/index.ts', (s) => s.replace('  findFirst,', '  findFirst,\n  scanRegion,')],
    ],
    tool: 'pnpm vitest run tests/hot-allocation',
    expect: /accounts for every callable/,
  },
  {
    invariant: 'Meta',
    breaks: 'padding the root CLAUDE.md without adding a line',
    edits: [
      [
        'CLAUDE.md',
        (s) => s.replace('## Verify', `## Verify${' Detail restated at length here.'.repeat(120)}`),
      ],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /bytes/,
  },
  {
    invariant: '1',
    breaks: 'forging a ContentId with a cast instead of parseContentId',
    edits: [
      [
        'packages/save/src/index.ts',
        (s) => `${s}\nconst forged = 'sand' as ContentId;\nexport const leak = forged;\n`,
      ],
    ],
    tool: 'pnpm lint',
    expect: /branded type/,
  },
  {
    invariant: '5',
    breaks: 'an object literal inside a hot-path function body',
    edits: [
      [
        'packages/sim/src/hot/buffer-ops.ts',
        (s) => s.replace('  let total = 0;', '  const scratch = { seen: 0 };\n  let total = scratch.seen;'),
      ],
    ],
    tool: 'pnpm lint',
    expect: /object literal allocates/,
  },
  {
    invariant: '5 (calibration)',
    breaks: 'the SAME object literal, but at module level in hot/',
    edits: [
      [
        'packages/sim/src/hot/buffer-ops.ts',
        (s) => `${s}\nexport const HOISTED = { allocatedOnce: true };\n`,
      ],
    ],
    tool: 'pnpm lint',
    expect: null, // must be ACCEPTED: module constants allocate once at load
  },
  {
    invariant: '5',
    breaks: 'an allocating array method in a hot-path function body',
    edits: [
      [
        'packages/sim/src/hot/buffer-ops.ts',
        (s) => s.replace('  let total = 0;', '  let total = cells.slice(0, 1).length - 1;'),
      ],
    ],
    tool: 'pnpm lint',
    expect: /allocates a new collection/,
  },
  {
    invariant: '7',
    breaks: 'Math.random inside sim',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => s.replace('  return CTRL_BYTES +', '  void Math.random();\n  return CTRL_BYTES +'),
      ],
    ],
    tool: 'pnpm lint',
    expect: /Math\.random breaks determinism/,
  },
  {
    invariant: '7',
    breaks: 'sorting pack directories with bare localeCompare',
    edits: [
      [
        'packages/runtime/src/loader.ts',
        (s) => s.replace('.sort(compareCodeUnits));', '.sort((a, b) => a.localeCompare(b)));'),
      ],
    ],
    tool: 'pnpm lint',
    expect: /localeCompare uses the machine locale/,
  },
  {
    invariant: '7',
    breaks: 'dropping the topological tie-break, so ties fall back to insertion order',
    edits: [['packages/kernel/src/order.ts', (s) => s.replace('    ready.sort(compareCodeUnits);', '')]],
    tool: 'pnpm vitest run packages/kernel',
    expect: /tie-break|expected/i,
  },
  {
    invariant: '7',
    breaks: 'dropping the loader pre-sort, which decides which duplicate is reported first',
    edits: [
      [
        'packages/runtime/src/loader.ts',
        (s) => s.replace('return ok([...names].sort(compareCodeUnits));', 'return ok([...names]);'),
      ],
    ],
    tool: 'pnpm vitest run packages/runtime',
    expect: /duplicate|identical|expected/i,
  },
  {
    invariant: '3 / ADR-0034',
    breaks: 'reaching past SimPort to the raw worker channel',
    edits: [
      [
        'apps/desktop/src/renderer/index.ts',
        (s) =>
          s.replace(
            'port.send(1);',
            "(port as unknown as { postMessage: (p: unknown) => void }).postMessage({ cmd: 'tick' });",
          ),
      ],
    ],
    tool: 'pnpm lint',
    expect: /boundary is closed, not guarded/,
  },
  {
    invariant: '5 / ADR-0036',
    breaks: 'delegating the allocation to a helper one directory above hot/',
    edits: [
      [
        'packages/sim/src/scratch.ts',
        () => 'export function pair(a: number, b: number): { a: number; b: number } {\n  return { a, b };\n}\n',
      ],
      [
        'packages/sim/src/hot/buffer-ops.ts',
        (s) =>
          s
            .replace('export const NOT_FOUND = -1;', "import { pair } from '../scratch.js';\n\nexport const NOT_FOUND = -1;")
            .replace('  let total = 0;', '  let total = pair(0, cells.length).a;'),
      ],
    ],
    // Lint cannot follow a call. The heap measurement can, which is the whole point of ADR-0036.
    tool: 'pnpm vitest run tests/hot-allocation',
    expect: /allocates nothing/,
  },
  {
    invariant: '7 / ADR-0035',
    breaks: 'reaching randomness through crypto, where Math.random is shut',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => s.replace('  return CTRL_BYTES +', '  void crypto.getRandomValues(new Uint32Array(1));\n  return CTRL_BYTES +'),
      ],
    ],
    tool: 'pnpm lint',
    expect: /crypto\.getRandomValues breaks determinism/,
  },
  {
    invariant: '7 / ADR-0035',
    breaks: 'an Intl.Collator with no locale - the fix the old lint message recommended',
    edits: [
      [
        'packages/runtime/src/loader.ts',
        (s) => s.replace('.sort(compareCodeUnits));', '.sort(new Intl.Collator().compare));'),
      ],
    ],
    tool: 'pnpm lint',
    expect: /no locale uses the machine locale/,
  },
  {
    invariant: '1 / ADR-0037',
    breaks: 'forging a ContentId with an angle-bracket assertion instead of `as`',
    edits: [
      ['packages/save/src/index.ts', (s) => `${s}\nexport const forged = <ContentId>'sand';\n`],
    ],
    tool: 'pnpm lint',
    expect: /speed bump/,
  },
  {
    invariant: '1 / ADR-0037',
    breaks: 'adding unsafeContentId beside parseContentId, where the lint is off',
    edits: [
      [
        'packages/kernel/src/id.ts',
        (s) => `${s}\nexport function unsafeContentId(raw: string): ContentId {\n  return raw as ContentId;\n}\n`,
      ],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /laundering service|exports exactly what it is meant to/,
  },
  {
    invariant: '4',
    breaks: 'a callback on an exported OBJECT LITERAL, which has neither call nor construct signatures',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => `${s}\nexport const hooks = {\n  register(handler: (index: number) => void): void {\n    handler(0);\n  },\n};\n`,
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  hooks,')],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /hooks/,
  },
  {
    invariant: '4',
    breaks: 'a callback inside an ARRAY of records, reached only through type arguments',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => `${s}\nexport const handlers = [{ on(handler: (index: number) => void): void { handler(0); } }];\n`,
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  handlers,')],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /handlers/,
  },
  {
    invariant: 'ADR-0050',
    breaks: 'moving a hot function OUT of hot/, where the directory-derived coverage lost it',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => `${s}\nexport function scanRegion(cells: Uint16Array, from: number): number {\n  return cells[from] ?? 0;\n}\n`,
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  scanRegion,')],
    ],
    tool: 'pnpm vitest run tests/hot-allocation',
    expect: /accounts for every callable/,
  },
  {
    invariant: '7 / ADR-0051',
    breaks: 'reversing the loader pre-sort, which removing it did not reveal',
    edits: [
      [
        'packages/runtime/src/loader.ts',
        (s) =>
          s.replace(
            'return ok([...names].sort(compareCodeUnits));',
            'return ok([...names].sort(compareCodeUnits).reverse());',
          ),
      ],
    ],
    // Deletion and inversion are different failures. The old test asserted only that two orderings
    // produced the SAME message, which a reversed sort satisfies perfectly.
    tool: 'pnpm vitest run packages/runtime',
    expect: /incumbent/,
  },
  {
    invariant: '4',
    breaks: 'a callback behind an INDEX SIGNATURE, where the type declares no properties at all',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => `${s}\nexport const table: Readonly<Record<string, (handler: (index: number) => void) => void>> = {};\n`,
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  table,')],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /table/,
  },
  {
    invariant: '4',
    breaks: 'an exported registry a mod DROPS a callback into, rather than a parameter',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => `${s}\nexport const sinks: Record<string, (index: number) => void> = {};\n`,
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  sinks,')],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /sinks/,
  },
  {
    invariant: '5 / ADR-0052',
    breaks: 'string concatenation in an UNEXPORTED hot function, which the export derivation lost',
    edits: [
      [
        'packages/sim/src/hot/buffer-ops.ts',
        (s) =>
          `${s}\nexport function describeRegion(cells: Uint16Array, value: number): string {\n` +
          "  let label = 'v';\n  label += String(value);\n  label += '/';\n  label += String(cells.length);\n  return label;\n}\n",
      ],
    ],
    tool: 'pnpm vitest run tests/hot-allocation',
    expect: /accounts for every callable/,
  },
  {
    invariant: 'Meta / ADR-0051',
    breaks: 'deleting a verifier case, which only ever changed the denominator',
    edits: [
      [
        'tools/verify-guardrails.mjs',
        (s) => s.replace("breaks: 'Math.random inside sim',", "breaks: 'Math.random inside sim (renamed away)',"),
      ],
    ],
    tool: 'pnpm vitest run tests/verifier-coverage',
    expect: /a demonstrated bypass keeps its case/,
  },
  {
    invariant: '3',
    breaks: 'sending a command object through SimPort instead of an index',
    edits: [
      [
        'apps/desktop/src/renderer/index.ts',
        (s) => s.replace('port.send(1);', "port.send({ cmd: 'tick' });"),
      ],
    ],
    tool: 'pnpm typecheck',
    // TypeScript checks the literal against each member of BoundaryPayload and reports TS2353
    // against SharedArrayBuffer rather than naming the union, so asserting on the union name
    // matched nothing while the type was refusing exactly as intended.
    expect: /renderer[\\/]index\.ts.*error TS(2353|2345)/,
  },
  {
    invariant: '7 / ADR-0035',
    breaks: 'reaching the clock through an alias and a constructor, where Date.now is sealed',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) =>
          s.replace(
            '  return CTRL_BYTES +',
            '  const D = Date;\n  void new D().getTime();\n  return CTRL_BYTES +',
          ),
      ],
    ],
    tool: 'pnpm lint',
    expect: /breaks determinism/,
  },
  {
    invariant: '7 / ADR-0035',
    breaks: 'reading performance.timeOrigin, which is a property and not a call',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => s.replace('  return CTRL_BYTES +', '  void performance.timeOrigin;\n  return CTRL_BYTES +'),
      ],
    ],
    tool: 'pnpm lint',
    expect: /breaks determinism/,
  },
  {
    invariant: '4',
    breaks: 'a callback on a METHOD of an exported class, not on a bare function',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) =>
          `${s}\nexport class Ticker {\n` +
          '  readonly #hooks: ((index: number) => void)[] = [];\n' +
          '  onCell(handler: (index: number) => void): void {\n    this.#hooks.push(handler);\n  }\n}\n',
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  Ticker,')],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /onCell|Ticker/,
  },
  {
    invariant: '4',
    breaks: 'an unconstrained generic, which the walker\'s own comment predicted',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => `${s}\nexport function withWorld<T>(world: World, extra: T): T {\n  void world;\n  return extra;\n}\n`,
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  withWorld,')],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /withWorld/,
  },
  {
    invariant: '4',
    breaks: 'adding a callback parameter to a public sim API',
    edits: [
      [
        'packages/sim/src/world.ts',
        (s) => `${s}\nexport function onCell(handler: (index: number) => void): void {\n  handler(0);\n}\n`,
      ],
      ['packages/sim/src/index.ts', (s) => s.replace('  viewWorld,', '  viewWorld,\n  onCell,')],
    ],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /onCell/,
  },
  {
    invariant: 'ADR-0032',
    breaks: 'renaming a v2 header key in the writer, the reader AND the migration at once',
    edits: [
      [
        'packages/save/src/container.ts',
        (s) => s.replace('chunkTable: doc.chunks,', 'chunks: doc.chunks,'),
      ],
      [
        'packages/save/src/index.ts',
        (s) => s.replace("migrated.value.header['chunkTable']", "migrated.value.header['chunks']"),
      ],
      ['packages/save/src/migrate.ts', (s) => s.replace('chunkTable: [', 'chunks: [')],
    ],
    tool: 'pnpm vitest run packages/save',
    // Asserting on the failing test's NAME, not on free text in the diff. vitest prints byte arrays
    // and code frames, so /chunkTable/ matched nothing even though the guardrail fired correctly.
    // The test name is the stable, meaningful thing: it says which guardrail caught it.
    expect: /pinned by a frozen fixture/,
  },
  {
    invariant: '2',
    breaks: 'raising CURRENT_VERSION without adding the migration',
    edits: [
      [
        'packages/save/src/container.ts',
        (s) => s.replace('export const CURRENT_VERSION = 2;', 'export const CURRENT_VERSION = 3;'),
      ],
    ],
    tool: 'pnpm vitest run packages/save',
    expect: /migration|unknown-version/i,
  },
  {
    invariant: 'ADR-0003',
    breaks: 'adding a schema field without regenerating the published JSON Schema',
    edits: [
      [
        'packages/rules-schema/src/index.ts',
        (s) =>
          s.replace(
            '    id: contentIdSchema,\n    constants:',
            '    id: contentIdSchema,\n    weight: z.number().optional(),\n    constants:',
          ),
      ],
    ],
    tool: 'pnpm gen:verify',
    expect: /out of date/,
  },
  {
    invariant: 'Meta',
    breaks: 'letting the root CLAUDE.md grow past 50 lines',
    edits: [['CLAUDE.md', (s) => `${s}${'\nfiller\n'.repeat(12)}`]],
    tool: 'pnpm vitest run tests/guardrails',
    expect: /50/,
  },
];

/* ------------------------------------------------------------------------------------------------
 * Worktree lifecycle
 * --------------------------------------------------------------------------------------------- */

// Same volume as the repository on purpose: pnpm's content-addressable store hard-links, and a
// worktree on another drive silently degrades to copying every file.
const worktree = path.join(repoRoot, '..', `.myfactorio-verify-${process.pid}`);
let worktreeCreated = false;

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', ...options });
}

let leftover = false;

function teardown() {
  if (!worktreeCreated) return;
  worktreeCreated = false;

  try {
    git(['worktree', 'remove', '--force', worktree]);
  } catch {
    /* fall through to the unconditional cleanup below */
  }

  // `git worktree remove` exits 0 having left node_modules behind: it manages tracked content and
  // nothing else. Taking its success as evidence the directory is gone leaked one worktree per run,
  // silently. Check the filesystem, not the exit code.
  rmSync(worktree, { recursive: true, force: true });
  try {
    git(['worktree', 'prune']);
  } catch {
    /* nothing registered to prune */
  }

  if (existsSync(worktree)) {
    leftover = true;
    console.error(`LEFTOVER: ${worktree} survived cleanup. Remove it by hand.`);
  }
}

// Ctrl-C used to leave the repository half-broken. The worst case now is a stray directory, and
// even that is cleaned up here.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    teardown();
    process.exit(130);
  });
}
process.on('exit', teardown);

function setupWorktree() {
  rmSync(worktree, { recursive: true, force: true });
  git(['worktree', 'prune']);
  git(['worktree', 'add', '--detach', worktree, 'HEAD'], { stdio: 'ignore' });
  worktreeCreated = true;

  const diff = git(['diff', 'HEAD']);
  if (diff.trim() !== '') {
    const patch = path.join(worktree, '.verify.patch');
    writeFileSync(patch, diff, 'utf8');
    execFileSync('git', ['apply', '--whitespace=nowarn', '.verify.patch'], { cwd: worktree, stdio: 'pipe' });
    rmSync(patch, { force: true });
    console.log('carried uncommitted changes into the worktree');
  }

  // Untracked files are invisible to `git diff HEAD`, so they have to be copied. Leaving them
  // behind and printing a warning was the first design, and it lasted exactly one run: a new test
  // file plus its new fixture simply were not there, and the case that depended on them reported
  // MISS for a reason that had nothing to do with the guardrail. A warning is not a mechanism.
  // .gitignore is respected, so node_modules and build output stay out.
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  for (const file of untracked) {
    const dest = path.join(worktree, file);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(repoRoot, file), dest);
  }
  if (untracked.length > 0) console.log(`carried ${untracked.length} untracked file(s) into the worktree`);
}

function run(command, cwd) {
  try {
    return {
      code: 0,
      output: execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Run
 * --------------------------------------------------------------------------------------------- */

console.log(`isolated worktree: ${path.basename(worktree)}`);
setupWorktree();

console.log('installing dependencies (Electron binary skipped: no case needs it)...');
const install = run('pnpm install --frozen-lockfile --prefer-offline', worktree);
if (install.code !== 0) {
  console.error(install.output.slice(-3000));
  process.exit(1);
}

/*
 * Baselines, before anything is broken.
 *
 * A case proves something only if the tool went from green to red BECAUSE of the edit. If the tool
 * was already failing on a pristine tree, every case using it "passes" while proving nothing - the
 * vacuity that let case 2 sit in the score on the bare word "error" for two sessions, in its most
 * general form. Asserting the regex matches is not enough; asserting the transition is.
 *
 * Cheap, too: distinct tools, run once each, not once per case.
 */
const tools = [...new Set(CASES.map((testCase) => testCase.tool))].sort();
console.log(`\nchecking ${tools.length} tools are green before anything is broken...`);

const broken = [];
for (const tool of tools) {
  const result = run(tool, worktree);
  if (result.code !== 0) broken.push({ tool, output: result.output });
}

if (broken.length > 0) {
  console.error('\nThese tools already fail on an untouched tree, so every case using them would');
  console.error('report a refusal that has nothing to do with the guardrail:\n');
  for (const { tool, output } of broken) {
    console.error(`  ${tool}`);
    console.error(
      output
        .split('\n')
        .filter((line) => line.trim() !== '')
        .slice(-4)
        .map((line) => `      | ${line}`)
        .join('\n'),
    );
  }
  teardown();
  process.exit(1);
}

let failures = 0;
console.log('\nBreaking each invariant on purpose and checking that a tool refuses.\n');

for (const testCase of CASES) {
  // Restore from a snapshot rather than `git checkout`: files carried in untracked have nothing to
  // check out, and git would silently leave them broken for every later case.
  const originals = new Map();
  const noop = [];

  try {
    for (const [file, transform] of testCase.edits) {
      const full = path.join(worktree, file);
      mkdirSync(path.dirname(full), { recursive: true });
      // Whether a file is being created is a property of the FILE, not of the case. It used to be a
      // per-case `create: true` flag, so a case that created one file and modified another blanked
      // the second one - and then reported MISS for a guardrail that works perfectly.
      const existed = existsSync(full);
      const before = existed ? readFileSync(full, 'utf8') : '';
      originals.set(full, existed ? before : null);

      const after = transform(before);

      // A transform whose anchor no longer matches returns its input unchanged, so the case runs
      // against pristine code, the tool passes, and the case reports MISS for a guardrail that
      // works. That has now happened five times, always after a refactor moved the line a case
      // pinned. Detecting it here says WHY, instead of leaving the next reader to diff by hand.
      if (existed && after === before) noop.push(file);

      writeFileSync(full, after, 'utf8');
    }

    if (noop.length > 0) {
      failures += 1;
      console.log(`MISS  [inv ${testCase.invariant}] ${testCase.breaks}`);
      console.log(`        the edit changed nothing in ${noop.join(', ')} - its anchor is stale,`);
      console.log('        so this case tested pristine code. Fix the anchor, not the guardrail.');
      continue;
    }

    const result = run(testCase.tool, worktree);
    const mustBeRefused = testCase.expect !== null || testCase.rule !== undefined;

    let passed;
    let detail = '';

    if (!mustBeRefused) {
      passed = result.code === 0;
      if (!passed) detail = `        expected exit 0, got ${result.code}`;
    } else if (testCase.rule !== undefined) {
      // A rule name absent from the real rule set means the case asserts on a string nobody
      // produces: vacuous by construction, and counted in the score all the same.
      const known = ruleSet.some((rule) => rule.name === testCase.rule);
      passed = result.code !== 0 && known && result.output.includes(testCase.rule);
      if (!known) detail = `        no rule named ${testCase.rule} exists in .dependency-cruiser.cjs`;
      else if (!passed) detail = `        expected ${testCase.rule} in the output, got exit ${result.code}`;
    } else {
      passed = result.code !== 0 && testCase.expect.test(result.output);
      if (!passed) detail = `        expected ${testCase.expect}, got exit ${result.code}`;
    }

    console.log(`${passed ? 'OK  ' : 'MISS'}  [inv ${testCase.invariant}] ${testCase.breaks}`);
    console.log(`        ${mustBeRefused ? 'refused by' : 'accepted by'} ${testCase.tool}`);

    if (!passed) {
      failures += 1;
      console.log(detail);
      console.log(
        result.output
          .split('\n')
          .filter((line) => line.trim() !== '')
          .slice(-6)
          .map((line) => `        | ${line}`)
          .join('\n'),
      );
    }
  } finally {
    // Per-case restore keeps cases independent. A crash now costs a stray worktree, nothing more.
    for (const [full, content] of originals) {
      if (content === null) rmSync(full, { force: true });
      else writeFileSync(full, content, 'utf8');
    }
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} guardrails behaved as specified.`);
teardown();

// A leaked worktree counts as a failure. Cleanup that reports success while leaving node_modules
// behind is the same defect this whole script exists to catch, one level up.
process.exit(failures === 0 && !leftover ? 0 : 1);
