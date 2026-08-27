/**
 * Breaks each invariant on purpose and checks that a tool refuses.
 *
 * A guardrail nobody has ever seen fire is a guardrail nobody knows is wired up. This applies each
 * violation to the working tree, runs the tool that is supposed to catch it, asserts the refusal
 * mentions the right thing, and restores the file. Nothing is left modified: every case is
 * reverted with `git checkout --` whether it passed, failed or threw.
 *
 * Run it on a clean tree. `pnpm verify:guardrails`.
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Each case: what we break, which tool must refuse, and what the refusal must mention. */
const CASES = [
  {
    invariant: 'Layering',
    breaks: 'kernel (rank 0) imports save (rank 5)',
    edits: [['packages/kernel/src/index.ts', (s) => `import '../../save/src/index.js';\n${s}`]],
    tool: 'pnpm arch',
    expect: /no-import-below:kernel/,
  },
  {
    invariant: 'Layering',
    breaks: 'sim imports rules-compiler (the path isa exists to remove)',
    edits: [['packages/sim/src/index.ts', (s) => `import '../../rules-compiler/src/index.js';\n${s}`]],
    tool: 'pnpm arch',
    expect: /no-import-below:rules-compiler|no-import-below:sim|error/,
  },
  {
    invariant: '2 / ADR-0006',
    breaks: 'save imports isa, the first step to caching bytecode in a .fsav',
    edits: [['packages/save/src/index.ts', (s) => `import '../../isa/src/index.js';\n${s}`]],
    tool: 'pnpm arch',
    expect: /save-no-isa/,
  },
  {
    invariant: '6',
    breaks: 'a content pack reaches past modding-api into the kernel',
    edits: [['packs/core-empty/probe.ts', () => "import '../../packages/kernel/src/index.js';\n"]],
    tool: 'pnpm arch',
    expect: /packs-only-modding-api/,
    create: true,
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
    expect: /branded type|no-restricted-syntax/,
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
    expect: /localeCompare depends on the machine locale/,
  },
  {
    invariant: '7',
    breaks: 'dropping the topological tie-break, so ties fall back to insertion order',
    edits: [
      [
        'packages/kernel/src/order.ts',
        (s) => s.replace('    ready.sort(compareCodeUnits);', '    // tie-break removed'),
      ],
    ],
    tool: 'pnpm vitest run packages/kernel',
    expect: /tie-break|expected/i,
  },
  {
    invariant: '7',
    breaks: 'dropping the loader pre-sort, which decides which duplicate is reported first',
    edits: [
      [
        'packages/runtime/src/loader.ts',
        (s) => s.replace('return ok([...found.value].sort(compareCodeUnits));', 'return ok([...found.value]);'),
      ],
    ],
    tool: 'pnpm vitest run packages/runtime',
    expect: /duplicate|identical|expected/i,
  },
  {
    invariant: '3',
    breaks: 'posting a command object across the worker boundary instead of an index',
    edits: [
      [
        'apps/desktop/src/renderer/index.ts',
        (s) => s.replace('boundaryMessage(1)', "boundaryMessage({ cmd: 'tick' })"),
      ],
    ],
    tool: 'pnpm typecheck',
    expect: /not assignable to parameter of type 'never'/,
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
        (s) => s.replace('    id: contentIdSchema,\n    constants:', '    id: contentIdSchema,\n    weight: z.number().optional(),\n    constants:'),
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

function run(command) {
  try {
    const stdout = execSync(command, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function restore(files) {
  for (const file of files) {
    try {
      execFileSync('git', ['checkout', '--', file], { cwd: repoRoot, stdio: 'ignore' });
    } catch {
      // Created files have nothing to check out; remove them instead.
    }
    try {
      execFileSync('git', ['clean', '-fq', '--', file], { cwd: repoRoot, stdio: 'ignore' });
    } catch {
      /* nothing to clean */
    }
  }
}

const dirty = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim();
if (dirty !== '') {
  console.error('Working tree is not clean. Commit or stash first — this script edits files in place.');
  console.error(dirty);
  process.exit(1);
}

let failures = 0;
console.log('Breaking each invariant on purpose and checking that a tool refuses.\n');

for (const testCase of CASES) {
  const touched = testCase.edits.map(([file]) => file);
  const originals = new Map();

  try {
    for (const [file, transform] of testCase.edits) {
      const full = path.join(repoRoot, file);
      const before = testCase.create ? '' : readFileSync(full, 'utf8');
      originals.set(full, before);
      writeFileSync(full, transform(before), 'utf8');
    }

    const result = run(testCase.tool);
    const mustBeRefused = testCase.expect !== null;
    const refused = result.code !== 0 && testCase.expect !== null && testCase.expect.test(result.output);
    const accepted = result.code === 0;

    const passed = mustBeRefused ? refused : accepted;
    if (!passed) failures += 1;

    const verdict = passed ? 'OK  ' : 'MISS';
    const outcome = mustBeRefused ? `refused by ${testCase.tool}` : `accepted by ${testCase.tool} (intended)`;
    console.log(`${verdict}  [inv ${testCase.invariant}] ${testCase.breaks}`);
    console.log(`        ${outcome}`);
    if (!passed) {
      console.log(`        expected ${mustBeRefused ? testCase.expect : 'exit 0'}, got exit ${result.code}`);
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
    restore(touched);
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} guardrails behaved as specified.`);
process.exit(failures === 0 ? 0 : 1);
