import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { copyRegion, countValue, fillRegion, findFirst } from '@myfactorio/sim';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Which functions this file must account for, derived from what `sim` exports.
 *
 * The first version imported four names by hand, so a fifth hot function was measured by nobody.
 * The second derived them from the contents of `packages/sim/src/hot/` — which closed that, and
 * re-anchored the guarantee on a directory name, the very thing ADR-0036 says is "not a property of
 * the code". Moving a hot function to `sim/src/step.ts` took it out of the lint and out of the
 * derivation in one gesture.
 *
 * "Exported by sim" IS a property of the code. Every exported callable is either exercised here or
 * declared cold with a reason, and the two sets must together be exactly what sim exports. A
 * function that moves between directories stays in the set; a new one has to be classified.
 *
 * The remaining edge, stated rather than left implicit: a hot function that sim does not export
 * escapes this. It is then unreachable from outside the package, and the lint on `hot/` still
 * applies if it lives there.
 */
function exportedCallables(): string[] {
  const entry = path.join(repoRoot, 'packages/sim/src/index.ts');
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error('sim entry point not found');
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('sim module symbol not found');

  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      const type = checker.getTypeOfSymbolAtLocation(symbol, source);
      return type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0;
    })
    .map((symbol) => symbol.getName())
    .sort();
}

/** Called in the measurement below. */
const EXERCISED = ['copyRegion', 'countValue', 'fillRegion', 'findFirst'];

/** Not on the hot path, each for a reason worth stating rather than a name worth listing. */
const COLD: Readonly<Record<string, string>> = {
  attachSimPort: 'host-side, called once at startup',
  boundaryMessage: 'a type-level gate, identity at run time',
  sealAmbientSources: 'called once, before anything else, in the worker',
  viewWorld: 'creates the typed-array views; allocating is its whole job',
  worldByteLength: 'arithmetic on a spec, called at setup',
  NonDeterminismError: 'an error class, constructed only on the failure path',
};

/**
 * Invariant 5, measured rather than described.
 *
 * The ESLint rules read syntax inside one folder, and "hot" is a folder name, not a property of the
 * code. Both of these pass the lint and allocate once per cell in the inner loop:
 *
 *     // packages/sim/scratch.ts - one directory up, so no rule applies
 *     export function pair(a: number, b: number) { return { a, b }; }
 *
 *     // or simply move the hot function out of hot/ and re-export it from index.ts
 *
 * Measuring the heap follows the call. It also catches what the lint was never going to see -
 * `subarray`, `toSorted`, `structuredClone`, plain `+` string concatenation. The lint keeps its job,
 * which is failing in the editor in under a second; this is the guarantee.
 *
 * It lives in tests/ rather than packages/sim because it needs Node APIs, and `sim-no-node-builtins`
 * correctly refuses those inside a worker-bound package. The rule was right: a measurement harness
 * is host tooling, not simulation code.
 *
 * Three instruments were wrong before this one, each caught by the negative control:
 *   1. heapUsed measured after a forced collection - that reports RETAINED memory, so a control
 *      allocating 6.5 million short-lived objects came back at minus forty bytes.
 *   2. non-escaping object literals - V8's escape analysis deleted the allocation outright: 25 KB
 *      of growth for 6.5 million literals. Worth knowing on its own, since it means the lint bans a
 *      syntax whose runtime cost the engine sometimes removes.
 *   3. counting GC events through PerformanceObserver - its callbacks arrive on the microtask
 *      queue, so nothing is delivered during a synchronous loop, and a collection landing mid-run
 *      made the measurement swing between 9.7 MB and 1.8 KB.
 * The control is the only reason any of that surfaced instead of passing quietly.
 */

/**
 * Small grid, many calls — deliberately.
 *
 * The first calibration used a 128x128 grid and 400 iterations, and it did not catch the actual
 * bypass: delegating one object literal to a helper one directory up allocates once per CALL, so
 * 400 calls produced about 16 KB and vanished under the threshold. Sensitivity to a per-call
 * allocation is a function of call count, not of grid size. Measured at these numbers: 8 KB of
 * baseline noise against 160 KB for one small object per call, in 280 ms.
 */
const WIDTH = 32;
const HEIGHT = 32;
const ITERATIONS = 50_000;

/** Above the ~8 KB baseline, far below the ~160 KB a single per-call allocation produces. */
const ALLOCATION_BUDGET = 50_000;

/** Retains what the control allocates, so the measurement cannot be undone by a collection. */
const sink: unknown[] = [];

// Declared rather than fished out of globalThis. The service-locator ban caught this line, and it
// was right to: the honest way to name a global the runtime injects is to declare it.
declare const gc: (() => void) | undefined;

function heapGrowth(run: () => void): number {
  if (gc === undefined) throw new Error('run under --expose-gc; see vitest.config.ts');

  sink.length = 0;
  run(); // warm up: first-call compilation is not what is being measured
  sink.length = 0;
  gc();
  gc();

  const before = process.memoryUsage().heapUsed;
  run();
  // No collection here on purpose: retained allocations are exactly what we want to count.
  return process.memoryUsage().heapUsed - before;
}

/** The negative control: comparable work, one retained object per cell. */
function allocatingEquivalent(cells: Uint16Array): void {
  for (let i = 0; i < cells.length; i += 1) {
    sink.push({ index: i, value: cells[i]! });
  }
}

describe('invariant: the hot path allocates nothing', () => {
  const cells = new Uint16Array(WIDTH * HEIGHT);
  const scratch = new Uint16Array(WIDTH * HEIGHT);

  // Fewer passes than the hot measurement: these are retained, and the point is only to prove the
  // instrument registers allocation, not to exhaust memory doing it.
  const control = heapGrowth(() => {
    for (let i = 0; i < 20; i += 1) allocatingEquivalent(cells);
  });

  const hot = heapGrowth(() => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      fillRegion(cells, WIDTH, 0, 0, WIDTH, HEIGHT, i & 3);
      copyRegion(cells, scratch, WIDTH, 0, HEIGHT);
      countValue(cells, 1);
      findFirst(cells, 2);
    }
  });

  sink.length = 0;

  it('accounts for every callable sim exports, hot or cold', () => {
    // A new export is either measured or classified. Silence is not one of the options, and moving
    // a function between directories does not change the answer.
    const accounted = [...EXERCISED, ...Object.keys(COLD)].sort();
    expect(exportedCallables()).toEqual(accounted);
  });

  it('the instrument can detect allocation at all', () => {
    expect(control, `control grew the heap by ${control} bytes`).toBeGreaterThan(1_000_000);
  });

  it('runs 50k passes without producing garbage', () => {
    expect(
      hot,
      `hot path grew the heap by ${hot} bytes over ${ITERATIONS} iterations (control: ${control}). ` +
        'A single object literal per call, anywhere down the call chain, lands around 160 KB here.',
    ).toBeLessThan(ALLOCATION_BUDGET);
  });
});
