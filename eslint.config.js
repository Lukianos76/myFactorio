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
const RANDOM = 'Randomness must come from a seeded PRNG carried in simulation state.';
const CLOCK = 'Time must be a tick count passed in as data.';

// Every entry below was reachable while the previous, shorter list was in force. The pattern is
// always the same: the ban names a mechanism, and the invariant is wider than the mechanism, so the
// unlisted door is the one you reach for once the listed one is shut. crypto.getRandomValues is
// where you go when Math.random is closed. This list is the fast local signal; the guarantee is
// sealAmbientSources() in packages/sim/src/determinism.ts, which replaces the functions themselves
// and therefore has no aliasing ceiling. See ADR-0035.
const ambientSourceProperties = [
  { object: 'Math', property: 'random', message: `Math.random breaks determinism. ${RANDOM}` },
  { property: 'getRandomValues', message: `crypto.getRandomValues breaks determinism. ${RANDOM}` },
  { property: 'randomUUID', message: `crypto.randomUUID breaks determinism. ${RANDOM}` },
  { object: 'Date', property: 'now', message: `Date.now breaks determinism. ${CLOCK}` },
  { object: 'performance', property: 'now', message: `performance.now breaks determinism. ${CLOCK}` },
  { object: 'process', property: 'hrtime', message: `process.hrtime breaks determinism. ${CLOCK}` },
  { object: 'process', property: 'uptime', message: `process.uptime breaks determinism. ${CLOCK}` },
  // A property read, not a call, so replacing functions never reached it.
  { property: 'timeOrigin', message: `performance.timeOrigin breaks determinism. ${CLOCK}` },
  // Catches `const D = Date; new D().getTime()`, where the alias hides the constructor from the
  // NewExpression selector below. The seal covers it at run time; this is the editor-speed signal.
  { property: 'getTime', message: `reading a Date breaks determinism. ${CLOCK}` },
  {
    property: 'localeCompare',
    // The previous wording ended "...or an Intl.Collator pinned to a fixed locale", and a reader in
    // a hurry keeps `Intl.Collator` and drops `pinned` - arriving back at the machine's locale with
    // the linter's blessing. A guardrail whose message teaches the workaround is worse than absent,
    // so the replacement spells the locale out.
    message:
      'localeCompare uses the machine locale, so the same content orders differently for different ' +
      'players, which reorders handle assignment. Use compareCodeUnits from @myfactorio/kernel, or ' +
      "if a linguistic order is genuinely needed, new Intl.Collator('en-US-u-kn').",
  },
  {
    property: 'toLocaleLowerCase',
    message: "toLocaleLowerCase is locale-dependent: 'I' becomes 'ı' in tr-TR, which changes the namespace. Use toLowerCase.",
  },
  {
    property: 'toLocaleUpperCase',
    message: 'toLocaleUpperCase is locale-dependent. Use toUpperCase.',
  },
  { property: 'toLocaleString', message: 'toLocaleString is locale-dependent. Format explicitly.' },
];

const boundaryProperties = [
  {
    property: 'postMessage',
    message:
      'The worker boundary is closed, not guarded. Use attachSimPort from @myfactorio/sim and send ' +
      'indices through SimPort.send; a raw postMessage accepts any object and reopens the hole the ' +
      'type was supposed to shut.',
  },
];

const ambientSourceSyntax = [
  { selector: "NewExpression[callee.name='Date']", message: `new Date() breaks determinism. ${CLOCK}` },
  {
    // `new Intl.Collator()` with no argument uses the machine locale - the exact bug the
    // localeCompare ban exists to prevent, reached through the API the old message recommended.
    selector: "NewExpression[callee.object.name='Intl'][arguments.length=0]",
    message:
      'An Intl constructor with no locale uses the machine locale, so two players get different ' +
      "results. Pin it: new Intl.Collator('en-US-u-kn').",
  },
];

/**
 * Selectors that must survive into EVERY block.
 *
 * Flat config REPLACES a rule's options rather than merging them, so a later block that sets
 * no-restricted-syntax for its own reasons silently drops everything an earlier block put there.
 * That is exactly how the ContentId ban went dead across all of packages/ while still reading as
 * enabled at the top of this file. Every use of no-restricted-syntax below spreads this array, and
 * tests/guardrails.invariant.test.ts asserts the effective config still contains it.
 */
const CONTENT_ID_CAST =
  'ContentId is a branded type. Mint it with parseContentId. This rule is a speed bump against ' +
  'the accidental cast, not a wall: a three-line generic helper launders any string into any ' +
  'branded type and no syntactic rule can see it. The guarantee is that every point where an id ' +
  'enters from outside parses it. See ADR-0037.';

const contentIdSyntax = [
  {
    selector: "TSAsExpression > TSTypeReference > Identifier[name='ContentId']",
    message: CONTENT_ID_CAST,
  },
  {
    // `<ContentId>'sand'` is a TSTypeAssertion, a different node entirely, and it walked past the
    // rule above for two sessions. Cheap to add; found by someone trying rather than reading.
    selector: "TSTypeAssertion > TSTypeReference > Identifier[name='ContentId']",
    message: CONTENT_ID_CAST,
  },
  {
    // `type Cid = ContentId` then `'sand' as Cid`. The alias renames the brand out of both
    // selectors above. Banning the alias is not the same as banning the laundering - a generic
    // helper still gets through, and ADR-0037 says so - but it closes the form someone reaches for
    // first, and it costs one line.
    selector: "TSTypeAliasDeclaration > TSTypeReference > Identifier[name='ContentId']",
    message:
      'Do not alias ContentId. An alias renames the brand out of the cast rules, which is the ' +
      'shortest route to a forged id. Use ContentId directly.',
  },
];

/**
 * A service locator on globalThis is a dependency with no import.
 *
 * dependency-cruiser reasons about resolved import edges: no file, no edge, no rule. So `kernel`
 * can reach `runtime` six ranks down and every layer rule stays silent. Both spellings are here
 * because only the first was, and the one that was missing is the one anybody would actually
 * write - `(globalThis as unknown as { __bridge?: X }).__bridge`. See ADR-0049.
 */
const globalThisSyntax = [
  {
    selector: "MemberExpression[object.name='globalThis']",
    message:
      'Reaching through globalThis is a dependency with no import, and the layer rules only see ' +
      'imports. If two packages need to share something, that is a package.',
  },
  {
    selector: "TSAsExpression > Identifier[name='globalThis']",
    message:
      'Casting globalThis is the service-locator spelling: a dependency the graph cannot see. If ' +
      'two packages need to share something, that is a package.',
  },
];

const alwaysSyntax = [...contentIdSyntax, ...globalThisSyntax];

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
      'no-restricted-syntax': ['error', ...alwaysSyntax],
    },
  },
  {
    // Every package, not just sim and runtime. compareCodeUnits lives in kernel, so a localeCompare
    // there would defeat the ban downstream while looking perfectly innocent. Nothing under
    // packages/ has a legitimate need for ambient time or randomness. apps/ is another matter:
    // a shell logs timestamps. See ADR-0018.
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...ambientSourceProperties],
      'no-restricted-syntax': ['error', ...alwaysSyntax, ...ambientSourceSyntax],
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
      'no-restricted-syntax': ['error', ...alwaysSyntax, ...hotPathSyntax, ...ambientSourceSyntax],
      'no-restricted-properties': ['error', ...hotPathProperties, ...ambientSourceProperties],
    },
  },
  {
    // Invariant 3 is a wall only if the raw channel is unreachable. attachSimPort is the one place
    // allowed to touch postMessage; everywhere else, code goes through SimPort.send, whose
    // parameter is a BoundaryPayload and cannot be an object. See ADR-0034.
    //
    // Note the spread of hotPathProperties: this block matches packages/**, which INCLUDES
    // packages/sim/src/hot, and flat config replaces rule options rather than merging them. Written
    // without it, this block silently switched off every allocating-method ban in the hot path -
    // the exact defect ADR-0021 named, reintroduced four ADRs later by a block that looked
    // unrelated. Order and overlap are semantics in this file.
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    ignores: ['packages/sim/src/port.ts', 'packages/sim/src/worker/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...ambientSourceProperties, ...boundaryProperties],
    },
  },
  {
    files: ['packages/sim/src/hot/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...hotPathProperties,
        ...ambientSourceProperties,
        ...boundaryProperties,
      ],
    },
  },
  {
    // A constraint that cannot be published is a constraint a mod author meets at load time with
    // no warning in their editor. `.refine()` is invisible to z.toJSONSchema - and, measured,
    // `unrepresentable: 'throw'` does not catch it either: the emitted schema is byte-identical, so
    // gen:verify stays green while the loader silently gets stricter than the published contract.
    // If the rule format needs a constraint, it has to be one JSON Schema can express. See ADR-0041.
    files: ['packages/rules-schema/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...ambientSourceProperties,
        ...boundaryProperties,
        {
          property: 'refine',
          message:
            'refine() does not survive into the published JSON Schema, so a mod author\'s editor ' +
            'accepts what the loader rejects. Express the constraint with a schema primitive, or ' +
            'decide the format does not have it.',
        },
        { property: 'superRefine', message: 'superRefine() does not survive into the published JSON Schema.' },
        { property: 'transform', message: 'transform() does not survive into the published JSON Schema.' },
      ],
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
    // The two files that legitimately reach globals by string key: the runtime seal, whose export
    // list is frozen by a test, and the worker entry, which must find its own scope. They keep every
    // other shared selector - flat config replaces rather than merges, and dropping the ContentId
    // ban here would be ADR-0021 for the third time.
    files: ['packages/sim/src/determinism.ts', 'packages/sim/src/worker/worker.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...contentIdSyntax, ...ambientSourceSyntax],
    },
  },
  {
    // LAST on purpose. Flat config applies blocks in order and the later one wins, so this
    // exemption has to sit after every block that sets no-restricted-syntax - otherwise the
    // packages/** block re-enables the ban here and parseContentId, the one function allowed to
    // mint the brand, cannot compile past lint. Position is semantics in this file.
    files: ['packages/kernel/src/id.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
