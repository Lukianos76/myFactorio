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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    create: true,
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
    create: true,
  },
  {
    invariant: 'ADR-0027',
    breaks: 'a type error inside a content pack, where a mod author would write one',
    edits: [['packs/core-empty/src/probe.ts', () => 'export const broken: string = 42;\n']],
    tool: 'pnpm typecheck',
    expect: /not assignable to type 'string'/,
    create: true,
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
    expect: /localeCompare depends on the machine locale/,
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

  const untracked = git(['ls-files', '--others', '--exclude-standard']).trim();
  if (untracked !== '') {
    console.log(`note: ${untracked.split('\n').length} untracked file(s) are NOT carried over`);
  }
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

let failures = 0;
console.log('\nBreaking each invariant on purpose and checking that a tool refuses.\n');

for (const testCase of CASES) {
  const touched = testCase.edits.map(([file]) => file);

  try {
    for (const [file, transform] of testCase.edits) {
      const full = path.join(worktree, file);
      mkdirSync(path.dirname(full), { recursive: true });
      const before = testCase.create || !existsSync(full) ? '' : readFileSync(full, 'utf8');
      writeFileSync(full, transform(before), 'utf8');
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
    for (const file of touched) {
      try {
        execFileSync('git', ['checkout', '--', file], { cwd: worktree, stdio: 'ignore' });
      } catch {
        rmSync(path.join(worktree, file), { force: true });
      }
    }
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} guardrails behaved as specified.`);
teardown();

// A leaked worktree counts as a failure. Cleanup that reports success while leaving node_modules
// behind is the same defect this whole script exists to catch, one level up.
process.exit(failures === 0 && !leftover ? 0 : 1);
