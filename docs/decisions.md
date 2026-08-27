# Decisions

Append-only. One entry per structuring decision. Never edit an entry in place: a decision that
contradicts an existing one adds a new entry that supersedes it, and says so.

The field that matters is **Rejected alternative**. That is the one someone will propose again
in six months with good arguments, and without the recorded reason the debate has to be replayed
from scratch.

---

## ADR-0001 — Simulation worker lives in the renderer

**Context.** The simulation must run off the main thread. Two homes were possible: a DOM Web
Worker owned by the renderer, or a Node `worker_threads` worker owned by the Electron main
process.

**Decision.** Web Worker in the renderer, sharing a `SharedArrayBuffer` with it.

**Rejected alternative.** `worker_threads` in main. It gives the worker full Node access and
trivial bundling, but the renderer is where pixels eventually get drawn, so state would have to
travel worker to main to renderer: two boundaries to lock instead of one, and a copy per frame.
With the worker in the renderer, the same buffer backs simulation and future rendering with no
copy at all.

---

## ADR-0002 — Renderer served over a custom `app://` protocol with COOP/COEP

**Context.** `SharedArrayBuffer` requires cross-origin isolation. Chromium has enforced this
since 92, and Electron follows Chromium — a `file://` renderer does not get a SAB.

**Decision.** Register an `app://` protocol in main and serve the renderer with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

**Rejected alternative.** `file://` plus a Chromium flag to force SAB on. It works today, breaks
on an Electron upgrade, and disables a security boundary to save a config block.

**Consequence to remember.** Under COEP, any externally loaded renderer resource must carry
`Cross-Origin-Resource-Policy`. A future in-app mod browser or remote images will need
`credentialless` or a proxy through main. Nothing to do now.

---

## ADR-0003 — Zod as the single source of truth, JSON Schema generated from it

**Context.** `rules-schema` defines the declarative rule format. Mod authors edit rule files by
hand and deserve editor autocompletion, which means a published JSON Schema.

**Decision.** Zod 4 declarations are the source of truth. `tools/gen-json-schema.mjs` emits
`packages/rules-schema/schema/*.schema.json` via the built-in `z.toJSONSchema()`. The generated
file is committed, and `pnpm gen:verify` fails if it drifts from the source.

**Rejected alternative.** TypeBox + Ajv, where the schema *is* JSON Schema so nothing is
generated. Rejected because Ajv compiles validators with `new Function`, which collides with a
strict CSP in Electron and would force Ajv's standalone precompilation mode — an extra build
step, added to remove a generation step. Zod validates without dynamic codegen.

---

## ADR-0004 — Internal packages are consumed as source

**Context.** Eight workspace packages import each other. `pnpm check` targets under 30 seconds.

**Decision.** Each `package.json` points `exports` at `src/index.ts`. No internal build, no
`dist/`, no composite projects, no `.tsbuildinfo`. One `tsc --noEmit` pass covers everything;
Vitest and Vite read the TypeScript directly.

**Rejected alternative.** TypeScript project references emitting `dist/`. It makes boundaries
feel more real (you consume `.d.ts`) and makes npm publishing immediate, at the cost of a slower
first check and real build orchestration. Boundaries here are guarded by dependency-cruiser, not
by the presence of a `.d.ts`. When `modding-api` genuinely needs publishing, adding a build to
that one package is an addition, not a rework.

---

## ADR-0005 — The instruction vocabulary is its own package

**Context.** Both `rules-compiler` (which emits bytecode) and `sim` (which decodes it) need the
same opcodes and layouts. The first design put them in `rules-compiler` and let `sim` reach in
through a protected `rules-compiler/isa` subpath.

**Decision.** `packages/isa` is a package at rank 2, imported by both.

**Rejected alternative.** The protected subpath. It was a workaround dressed as architecture: it
needed a bespoke dependency-cruiser rule to stay honest, and one careless import would drag the
whole compiler into the worker bundle. As a separate package there is no path from `sim` to
`rules-compiler` at all, so the bespoke rule disappears — the guarantee comes from the shape of
the graph rather than from a rule guarding a hole. Vocabulary shared by two packages is a third
package, not a recess of the first.

---

## ADR-0006 — The ISA is disposable and never persisted

**Context.** Four neutral opcodes exist (`HALT`, `NOP`, `LOAD_CONST`, `CMP`). No game element
exists yet, so no encoding choice can be justified against real requirements.

**Decision.** No forward-compatibility promise on the bytecode. Bytecode is a compilation
artefact, recomputed on every pack load, and is **never written to disk**. Enforced by the
`save-no-isa` dependency-cruiser rule: without access to the opcodes, `save` cannot serialise
them.

**Rejected alternative.** Caching compiled bytecode inside the `.fsav` to speed up startup. That
would silently create a second versioned format and retroactively freeze an ISA designed against
zero real requirements. The door is closed now, while closing it is free.

---

## ADR-0007 — Save container is binary with a JSON header

**Context.** Saves hold a large grid plus a palette of qualified content ids.

**Decision.** `.fsav` = magic `FSAV`, `u32` version, `u32` header length, UTF-8 JSON header
(palette, chunk table, packs), then raw binary chunks.

**Rejected alternative.** All-JSON with a base64 payload — trivial to inspect, roughly 33%
overhead and slow parsing once the grid grows, so it would need replacing later, which means
migrating the format of the format. Also rejected: all-binary with a fixed-field header, where
every new header field becomes a migration and hand-debugging is painful.

---

## ADR-0008 — Saves store a name palette, never runtime handles

**Context.** The registry assigns numeric handles at load. Those handles depend on load order,
which depends on which mods are installed.

**Decision.** `SaveDoc.palette` is `ContentId[]`. Grid cells store palette indices, remapped
through the registry at load. Typing `palette` as `ContentId[]` makes storing a numeric handle a
type error rather than a code review comment.

**Rejected alternative.** Writing runtime handles directly, which is faster and smaller. It makes
a save valid only for the exact mod set and load order that produced it — the single most common
way this genre corrupts player data.

---

## ADR-0009 — `ContentId` is a branded type, `core` is a reserved namespace

**Context.** Invariant 1 requires every content id to be namespaced.

**Decision.** `ContentId` is a branded string minted only by `parseContentId`, validated against
`^[a-z0-9_]+:[a-z0-9_/]+$`. A lint rule forbids casting to `ContentId` outside
`packages/kernel/src/id.ts`. The `core` namespace is reserved: a third-party pack claiming it is
rejected at load.

**Rejected alternative.** A template-literal type of the shape "string colon string". It is
checked at compile time only, accepts `Core:Sand` and `a:b:c`, and evaporates on any value read
from disk — which is exactly where ids actually come from.

---

## ADR-0010 — Hot-path lint is scoped to function bodies

**Context.** Invariant 5 bans allocation in `packages/sim/src/hot/`.

**Decision.** Selectors are of the form `FunctionDeclaration ObjectExpression`, so module-level
constants stay legal. Allocating methods (`.map`, `.filter`, `.slice`, `.concat`, `.reduce`,
`Array.from`, `Object.assign`) are banned via `no-restricted-properties`. `noInlineConfig` is on
for that directory, so `eslint-disable` cannot switch the rule off.

**Rejected alternative.** Banning object and array literals outright anywhere in `hot/`. That
also forbids module constants, which allocate exactly once at load. The rule would be impossible
to satisfy, the first implementer would reach for `eslint-disable`, and we would have taught
ourselves that this rule is negotiable — worse than having no rule at all.

**Known gap.** Plain `+` string concatenation cannot be detected without type information, and
type-aware linting was rejected for speed. Template literals and `.concat` are banned; `a + b` on
two strings is not caught.

---

## ADR-0011 — Determinism is decided now, before there is a loop to test

**Context.** `loader.ts` scans `packs/`. `readdir` order depends on the filesystem. That order
breaks ties in the topological sort, which decides handle assignment, which decides buffer
contents. Two machines with the same mods would diverge.

**Decision.** Three measures. Entries are sorted lexicographically on code units before anything
else. The topological sort is Kahn with its ready set tie-broken by `ContentId`, never by
insertion order. `Math.random`, `Date.now`, `performance.now`, `new Date()` and `localeCompare`
are lint-banned in `sim` and `runtime`.

**Rejected alternative.** Deferring determinism until there is a simulation loop to test it
against. By then there are saves in the wild and the divergence is unfixable.

**Why the lint is not redundant with the test.** The determinism test shuffles input order, so it
catches an unsorted `readdir`. It cannot catch `localeCompare`: it runs on one machine with one
locale and goes green while a player in `tr-TR` or `sv-SE` diverges. Test and lint cover two
different leaks and neither covers the other.

**Consequence.** There is now no source of randomness available inside `sim` at all. This is
deliberate — the ban is the forcing function that pushes the first element needing randomness
towards a seeded PRNG carried in simulation state. That PRNG does not exist yet.

---

## ADR-0012 — `modding-api` is private until 1.0

**Context.** The package exists so that `packs/core-empty` can dogfood the public surface.

**Decision.** `"private": true`, version `0.1.0`, and a line in its CLAUDE.md stating no
stability guarantee before 1.0.

**Rejected alternative.** Publishing it now to establish the name. That freezes an API validated
by zero real usage — immediate debt, for a name nobody is competing for.

---

## ADR-0013 — `modding-api` re-exports content, not internals

**Context.** Deciding what belongs on the public modding surface.

**Decision.** `modding-api` re-exports `kernel` (ids), `rules-schema` (the rule format) and
`runtime` (manifests). It does **not** re-export `isa` or `save`.

**Rejected alternative.** Re-exporting everything a mod might conceivably touch. Bytecode
encoding and save container internals are not a mod author's business; exposing them would make
ADR-0006's disposability claim false the moment a mod imported an opcode.

---

## ADR-0014 — `save` does not depend on `sim`

**Context.** `save` persists world state, which `sim` owns.

**Decision.** `save` depends on `kernel` only. Chunk payloads are opaque byte ranges described by
the chunk table; `save` never interprets them.

**Rejected alternative.** `save` importing `sim` for its world layout types. That couples the
file format to the in-memory layout, so any change to the simulation's typed-array packing
becomes a save migration. Keeping the payload opaque lets the layout change freely as long as
writer and reader agree, and keeps versioning confined to the header.

---

## ADR-0015 — Invariant 6 rests on the empty-directory test

**Context.** "Base content has no privilege" needs a test that actually proves it.

**Decision.** The real test points the loader at an empty directory and asserts a clear failure
with no throw. A second test, asserting that `loader.ts` contains no literal `core`, is kept as a
net but is explicitly not the proof.

**Rejected alternative.** Relying on the source-text assertion. It asserts on source text and is
trivially defeated by string concatenation or a constant. It proves nothing on its own.

---

## ADR-0016 — Everything is written in English

**Context.** The project is developed in French.

**Decision.** Identifiers, comments, error messages, pack names and every CLAUDE.md are in
English. Conversation stays in French.

**Rejected alternative.** French throughout. Loader error messages are read by mod authors, who
are international; French would close the door on outside mods and contributions.

---

## ADR-0017 — `pnpm check` is measured, not assumed

**Context.** The 30-second target covers five sequential steps.

**Decision.** The figure is measured at the end of each session and reported. If it is exceeded,
`arch` and `gen:verify` move to a `check:full` reserved for CI, and `check` keeps typecheck +
lint + test.

**Rejected alternative.** Asserting the budget is met because the steps look cheap.
