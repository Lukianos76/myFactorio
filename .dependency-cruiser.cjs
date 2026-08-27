/**
 * Architecture guardrails.
 *
 * The layer rules below are GENERATED from LAYERS, not hand-written. Adding a package means
 * adding one line here; the full N*(N-1)/2 set of forbidden edges follows automatically and
 * cannot drift out of sync with the intended ordering.
 */

/** Rank 0 is the top. A package may only import packages of a STRICTLY LOWER rank index. */
const LAYERS = [
  'kernel',
  'rules-schema',
  'isa',
  'rules-compiler',
  'sim',
  'save',
  'runtime',
  'modding-api',
];

const pkg = (name) => `(^|/)packages/${name}/`;
const anyOf = (names) => `(^|/)packages/(${names.join('|')})/`;

const layerRules = LAYERS.flatMap((name, i) => {
  const below = LAYERS.slice(i + 1);
  if (below.length === 0) return [];
  return [
    {
      name: `no-import-below:${name}`,
      severity: 'error',
      comment:
        `packages/${name} sits at rank ${i} and must not import anything below it ` +
        `(${below.join(', ')}). Dependencies flow strictly downward; if two packages need the ` +
        `same vocabulary, that vocabulary is a third package, not a reach-around.`,
      from: { path: pkg(name) },
      to: { path: anyOf(below) },
    },
  ];
});

module.exports = {
  forbidden: [
    ...layerRules,
    {
      name: 'save-no-isa',
      severity: 'error',
      comment:
        'packages/save must not import packages/isa, even though the ranks would allow it. ' +
        'Without access to opcodes, save cannot serialise bytecode. Bytecode is a compilation ' +
        'artefact recomputed on every pack load; persisting it would create a second versioned ' +
        'format and retroactively freeze the ISA. Referencing CONTENT (the id palette, packs[]) ' +
        'is a different thing and stays legitimate - that is invariant 2.',
      from: { path: pkg('save') },
      to: { path: pkg('isa') },
    },
    {
      name: 'packs-only-modding-api',
      severity: 'error',
      comment:
        'Content packs may only reach @myfactorio/modding-api. Base content has no privilege: ' +
        'core-empty loads through the exact same path as any third-party mod.',
      from: { path: '(^|/)packs/' },
      to: { path: '(^|/)packages/', pathNot: '(^|/)packages/modding-api/' },
    },
    {
      name: 'sim-no-node-builtins',
      severity: 'error',
      comment:
        'packages/sim is worker-bound. No node: builtins - the worker has no Node access and ' +
        'anything ambient is a determinism leak waiting to happen.',
      from: { path: pkg('sim') },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'sim-no-electron',
      severity: 'error',
      comment: 'packages/sim must never know it runs inside Electron.',
      from: { path: pkg('sim') },
      to: { path: 'node_modules/electron' },
    },
    {
      name: 'renderer-no-electron-main',
      severity: 'error',
      comment:
        'The renderer runs sandboxed with contextIsolation. It reaches the main process through ' +
        'the preload bridge only, never by importing electron directly.',
      from: { path: '(^|/)apps/desktop/src/renderer/' },
      to: { path: 'node_modules/electron' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make load order - and therefore handle assignment - ambiguous.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^|/)(node_modules|dist|out)/|(^|/)tests/fixtures/|[.]test[.]ts$',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'types', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
