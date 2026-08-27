import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/* ---------------------------------------------------------------------------------------------
 * Hot-path allocation ban (invariant 5).
 *
 * The selectors are SCOPED TO FUNCTION BODIES on purpose. Module-level constants allocate once
 * at load and are perfectly fine; banning them outright would make the rule impossible to
 * satisfy, someone would reach for eslint-disable, and we would have taught ourselves that this
 * rule is negotiable. That is a worse outcome than having no rule at all.
 *
 * noInlineConfig is set for hot/ below, so eslint-disable comments there are inert.
 * ------------------------------------------------------------------------------------------ */
const FN = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];
const ALLOCATING_NODE = {
  NewExpression: 'new allocates',
  ObjectExpression: 'object literal allocates',
  ArrayExpression: 'array literal allocates',
  SpreadElement: 'spread allocates a new object or array',
  TemplateLiteral: 'template literal allocates a string',
};
const CLOSURE_NODE = {
  ArrowFunctionExpression: 'closure allocates',
  FunctionExpression: 'closure allocates',
};

const hotPathSyntax = FN.flatMap((fn) => [
  ...Object.entries(ALLOCATING_NODE).map(([node, why]) => ({
    selector: `${fn} ${node}`,
    message: `No allocation inside a hot-path function body: ${why}. Module-level constants are allowed; hoist it, or write into a preallocated typed array.`,
  })),
  ...Object.entries(CLOSURE_NODE).map(([node, why]) => ({
    selector: `${fn} ${node}`,
    message: `No allocation inside a hot-path function body: ${why}. Hot code takes indices, not callbacks.`,
  })),
]);

const ALLOCATING_METHOD = ['map', 'filter', 'slice', 'concat', 'reduce', 'flatMap', 'join', 'split'];
const hotPathProperties = [
  ...ALLOCATING_METHOD.map((property) => ({
    property,
    message: `.${property}() allocates a new collection on every call. Hot path uses indexed for-loops over preallocated buffers.`,
  })),
  { object: 'Array', property: 'from', message: 'Array.from allocates. Preallocate instead.' },
  { object: 'Object', property: 'assign', message: 'Object.assign allocates. Write fields directly.' },
];

/* ---------------------------------------------------------------------------------------------
 * Determinism (see docs/decisions.md).
 *
 * localeCompare is in here for a reason that is easy to miss: the determinism TEST cannot catch
 * it. That test runs on one machine with one locale and goes green while a player in tr-TR or
 * sv-SE diverges. The test catches an unsorted readdir; this lint catches locale-dependent
 * ordering. Neither covers the other.
 * ------------------------------------------------------------------------------------------ */
const ambientSourceProperties = [
  { object: 'Math', property: 'random', message: 'Math.random breaks determinism. Randomness must come from a seeded PRNG carried in simulation state.' },
  { object: 'Date', property: 'now', message: 'Date.now breaks determinism. Time must be a tick count passed in as data.' },
  { object: 'performance', property: 'now', message: 'performance.now breaks determinism. Time must be a tick count passed in as data.' },
  { property: 'localeCompare', message: 'localeCompare depends on the machine locale and silently reorders content between players. Compare with a < b on code units, or an Intl.Collator pinned to a fixed locale.' },
];
const ambientSourceSyntax = [
  { selector: "NewExpression[callee.name='Date']", message: 'new Date() breaks determinism. Time must be a tick count passed in as data.' },
];

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', 'tests/fixtures/**', '**/*.generated.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Off deliberately, and centrally. noUncheckedIndexedAccess is on, so every indexed read is
      // T | undefined; combined with a ban on `!` the only way through a bounds-checked loop is a
      // redundant guard on every access - a branch in the hot path, and noise everywhere else. The
      // rule would be worked around case by case, which is worse than deciding it once here.
      // See ADR-0019.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSTypeReference > Identifier[name='ContentId']",
          message: 'ContentId is a branded type. It may only be minted by parseContentId in packages/kernel/src/id.ts. Casting defeats invariant 1.',
        },
      ],
    },
  },
  {
    files: ['packages/kernel/src/id.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Every package, not just sim and runtime. compareCodeUnits lives in kernel, so a localeCompare
    // there would defeat the ban downstream while looking perfectly innocent. Nothing under
    // packages/ has a legitimate need for ambient time or randomness. apps/ is another matter:
    // a shell logs timestamps. See ADR-0018.
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...ambientSourceProperties],
      'no-restricted-syntax': ['error', ...ambientSourceSyntax],
    },
  },
  {
    files: ['packages/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'sim is worker-bound and must not touch the DOM.' },
        { name: 'document', message: 'sim is worker-bound and must not touch the DOM.' },
        { name: 'navigator', message: 'sim is worker-bound and must not touch host APIs.' },
        { name: 'localStorage', message: 'sim owns no persistence. That is packages/save.' },
        { name: 'fetch', message: 'sim performs no I/O.' },
      ],
    },
  },
  {
    files: ['packages/sim/src/hot/**/*.ts'],
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-syntax': ['error', ...hotPathSyntax, ...ambientSourceSyntax],
      'no-restricted-properties': ['error', ...hotPathProperties, ...ambientSourceProperties],
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
