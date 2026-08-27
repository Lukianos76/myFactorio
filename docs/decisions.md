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

---

## ADR-0018 — The determinism ban covers every package, superseding ADR-0011's scope

**Context.** ADR-0011 banned `Math.random`, `Date.now`, `performance.now`, `new Date()` and
`localeCompare` in `sim` and `runtime`. Implementation then moved `compareCodeUnits` and the stable
topological sort into `kernel`, because the scheduler and the loader both need them.

**Decision.** The ban applies to `packages/**`, not to two named packages. This supersedes the
scope stated in ADR-0011; everything else in that entry stands.

**Rejected alternative.** Keeping the ban on `sim` and `runtime` only. The comparator now lives in
`kernel`, so a `localeCompare` there would defeat the ban downstream while sitting in a file the
rule does not look at. A guardrail that stops at the boundary of the package that uses the
primitive, rather than the one that defines it, is decoration.

**Not extended to `apps/`.** A shell legitimately logs timestamps. Nothing under `packages/` has a
legitimate need for ambient time or randomness.

---

## ADR-0019 — `no-non-null-assertion` is off, centrally

**Context.** `noUncheckedIndexedAccess` is on, so every indexed read is `T | undefined`. With
typescript-eslint's strict preset also banning `!`, eight sites across the codebase failed lint on
first run — all of them bounds-checked loop bodies.

**Decision.** `@typescript-eslint/no-non-null-assertion` is disabled once, in the base block, with
the reason written next to it.

**Rejected alternative.** Leaving the rule on and adding a guard at each site. In `sim/src/hot/`
that is a branch inside the inner loop, which is the one place we have committed to spending
nothing; elsewhere it is noise around an access the surrounding loop already proved safe. The real
outcome would have been eight inline suppressions accumulating over time — the same failure mode
ADR-0010 identified for the hot-path rule, arrived at from the other direction. Deciding it once,
here, is honest; letting it be worked around case by case is not.

**What still holds the line.** `noUncheckedIndexedAccess` itself stays on, so the compiler still
forces the author to look at every indexed read and say what they mean.

---

## ADR-0020 — `sim-no-compiler`, correcting a claim in ADR-0005

**Context.** ADR-0005 stated that extracting `packages/isa` meant "there is no path from `sim` to
`rules-compiler` at all". The break-a-rule verification pass showed that to be false: importing the
compiler from `sim` produced no violation. `rules-compiler` is rank 3 and `sim` is rank 4, so that
edge runs *upward* through the layering and the generated rules never look at it.

**Decision.** An explicit `sim-no-compiler` rule, in the same spirit as `save-no-isa`. Extracting
`isa` removed sim's *need* to reach the compiler; only this rule removes the *possibility*.

**Rejected alternative.** Reordering the ranks to put `rules-compiler` below `sim`. That would make
the edge illegal for free, but it inverts a dependency direction that is correct on its own terms —
the compiler is upstream of the simulation — purely to get a side effect out of the layer rules.
Encoding one constraint by distorting another is how a layering stops meaning anything.

**What this says about the method.** The claim in ADR-0005 was plausible, written down, and wrong,
and it survived review because nobody had watched the rule fire. That is the entire argument for
`tools/verify-guardrails.mjs`.

---

## ADR-0021 — Shared lint selectors are composed explicitly

**Context.** ESLint flat config REPLACES a rule's options rather than merging them. The `ContentId`
cast ban was declared once in the base block and then silently discarded for every file under
`packages/` by a later block that set `no-restricted-syntax` for determinism. It read as enabled
and applied nowhere that mattered. Nothing warned.

**Decision.** An `alwaysSyntax` array spread into every `no-restricted-syntax` in the config, plus a
test that asserts the **effective** config for representative files still contains the selector.
Block order is now semantically load-bearing and commented as such: the `kernel/src/id.ts`
exemption must come last, or the ban re-enables on the one function permitted to mint the brand.

**Rejected alternative.** Trusting the config to be read the way it looks. A rule that is present in
the source and absent from the effective config is worse than an absent rule, because it is
reassuring.

---

## ADR-0022 — What the loader pre-sort actually protects

**Context.** ADR-0011 presented the sorted scan as the mechanism carrying deterministic handle
assignment. The verification pass showed the determinism test still passes with that sort removed.

**Decision.** Keep the pre-sort, and be accurate about its role. Deterministic load order is carried
by the tie-break inside `stableTopologicalSort`, whose output is a pure function of the graph
regardless of input order. The pre-sort governs what happens *before* the graph exists — chiefly
which of two conflicting packs is reported as the incumbent — and now has its own test asserting
that a duplicate-namespace conflict reports identically whatever the enumeration order.

**Rejected alternative.** Removing the pre-sort as redundant. Two players with the same broken mod
set would get different error messages, and a bug report stops being reproducible. It is cheap
defence in depth; it just is not what ADR-0011 implied it was.

---

## ADR-0023 — Each determinism mechanism is tested at its own level

**Context.** Two mechanisms carry deterministic load order: the loader sorts its input, and
`stableTopologicalSort` breaks ties by id. The verification pass showed that removing *either* one
left every test green — because each masks the absence of the other. With the input pre-sorted the
tie-break never faces an unordered list; with the tie-break present the input order stops mattering.

**Decision.** Test each at its own level. `packages/kernel/src/order.invariant.test.ts` calls
`stableTopologicalSort` directly with permuted node lists, which is the only way to put the
tie-break under load. The loader test keeps covering what the pre-sort actually governs (ADR-0022).

**Rejected alternative.** Testing both through the loader, which is the natural place to look
because that is where determinism matters to a player. Two redundant mechanisms tested only through
their combination are two mechanisms with no test between them: whichever one someone deletes, the
suite stays green and the survivor quietly covers for it until the day it too is touched.

**The general form.** Defence in depth is worth having, and it makes end-to-end tests blind. Any
belt-and-braces pair needs a test that removes the belt.

---

## ADR-0024 — `electron` stays external in the main bundle

**Context.** The first real launch of the shell failed with "Electron failed to install correctly.
Please delete node_modules/electron". Nothing was wrong with the install: the main bundle had
inlined the `electron` npm package, whose `module.exports` is the *path to the binary*, computed by
spawning `install.js` from `__dirname`. Bundled, that `__dirname` no longer exists.

**Decision.** `rollupOptions.external: ['electron', /^node:/]` for the main process. Workspace
packages stay bundled, because they are consumed as TypeScript source (ADR-0004).

**Rejected alternative.** The `commonjsOptions: { include: [/node_modules/] }` that caused it, added
to make sure the workspace packages were inlined. They already were — Vite resolves them as source,
not as CommonJS dependencies — so the option bought nothing and disabled electron-vite's default
externalisation. The error message it produced pointed at the install, which is the wrong place
entirely; that is worth remembering the next time Electron claims it is not installed.

---

## ADR-0025 — The renderer reports when it is done; main does not read its state

**Context.** The e2e harness needs to know what the renderer ended up showing. Reading it right
after `loadURL` resolves does not work: `loadURL` settles on the load event, while the renderer's
own startup — fetching status, allocating the shared buffer, waiting for the worker to reach ready
— is still in flight.

**Decision.** The renderer calls `report()` over the preload bridge once it has finished, and main
prints that and quits. A 20-second timeout in main prints `renderer-timeout` and quits anyway.

**Rejected alternative.** `executeJavaScript` after load, optionally with a delay. It passes on this
machine and turns into a flaky test on a slower one, which is worse than no test — a harness that
fails intermittently gets muted rather than fixed. A timeout that reports a distinct failure line is
legible; hanging is not.

---

## ADR-0026 — Written prohibitions are an executable specification

**Context.** ADR-0020 diagnosed a general shape — the layer ranks permit an edge that the doctrine
forbids, so the generated rules never look at it — and then closed exactly one instance of it. An
adversarial review found two more sitting in the CLAUDE.md files the whole time: `save` must never
import `sim` (ADR-0014 devotes a whole entry to it), and `modding-api` must never re-export `isa` or
`save` (ADR-0013). Both are upward edges. Neither had a rule.

**Decision.** `save-no-sim`, `modding-api-no-isa` and `modding-api-no-save` exist. More importantly,
`tests/doctrine.invariant.test.ts` parses the `## Must never` section of every package, extracts
each stated import or re-export prohibition, and requires a dependency-cruiser rule whose path
predicates actually match that edge. Writing "Must never import X" without a rule behind it now
turns the suite red.

**Rejected alternative.** Adding the three rules and moving on, which is what ADR-0020 did with the
first one. Fixing instances of a class I had just finished naming is how the second and third
instances survived. The gap was even legible in the prose: prohibitions that cited a rule in
parentheses had one, prohibitions that cited none had none.

**Why the test checks the predicate, not the name.** A rule named `save-no-sim` whose regex matched
nothing would satisfy a name check and refuse nothing — the same vacuity that made
`verify-guardrails` case 2 pass on the word "error".

**Known limit.** It reads the first sentence of each bullet. A prohibition phrased in a way the
parser does not recognise is silently not checked, so the test asserts the exact set of prohibitions
it found: a parser regression fails loudly instead of quietly finding nothing.

---

## ADR-0027 — Test files are cruised, and packs are typechecked

**Context.** `.dependency-cruiser.cjs` excluded `*.test.ts`, and the TypeScript program excluded
`packs/`. So `packages/kernel/src/scratch.test.ts` importing `runtime` passed the entire check —
arch never opened the file, `tsc` compiled it, vitest ran it green. The same hole made
`packs-only-modding-api` and `sim-no-compiler` optional. Separately, `packs/core-empty` exists to
dogfood exactly what a third-party mod gets (ADR-0012), and nothing a mod author wrote there was
typechecked, linted or cruised.

**Decision.** Drop the test-file exclusion; add `packs/*/src/**/*.ts` to the program. Measured: the
cruise went from 35 modules to 47, a forbidden import inside a `.test.ts` is now reported as
`no-import-below:kernel`, and a type error inside a content pack fails `pnpm typecheck`.

**Rejected alternative.** Keeping tests out on the grounds that test code is not shipped. Test code
imports production code, and a layering that stops at the test boundary is a layering with a
documented way around it. Nothing in the real suite needed the exemption — it was never load-bearing,
only unexamined.

---

## ADR-0028 — Continuous integration

**Context.** The project's thesis is "mechanical, never merely documented", and every guardrail
depended on a human remembering to type a command. `pnpm check` did not include
`verify:guardrails` or `e2e:no-core` either. The thesis was a documentation claim about itself.

**Decision.** `.github/workflows/ci.yml`, three jobs matching the three levels of proof: `check`
(the rules hold on this tree), `guardrails` (the rules still refuse a deliberate violation, followed
by a step asserting the verifier restored every file it touched), `e2e` (the application actually
runs, under xvfb).

**Rejected alternative.** Folding everything into `pnpm check`. The 30-second budget exists so the
local loop stays worth running; `verify:guardrails` takes minutes and edits the working tree, and
the e2e needs a display. Different cadences, different jobs.

**Unverified.** The workflow has never run. Its YAML parses and `pnpm install --frozen-lockfile`
succeeds locally, and that is the whole of the evidence — the first push is the real test. Written
down here rather than implied, because "CI exists" and "CI passes" are different claims.

---

## ADR-0029 — The guardrail verifier runs in a throwaway worktree

**Context.** `verify-guardrails.mjs` edited the working tree in place. That demanded a clean tree,
made concurrent work impossible, and left the repository broken on Ctrl-C. It also clobbered a
reviewer's files mid-review, which is how the cost became concrete rather than theoretical.

**Decision.** It creates a detached `git worktree` from HEAD, carries uncommitted changes across
with `git diff HEAD | git apply`, installs dependencies there, runs every case, and removes the
worktree. Isolation also removes the clean-tree precondition: what gets verified is what you have,
not what you committed. Measured: 59 s end to end, 23/23.

**Rejected alternative.** Keeping in-place edits and asking people to be careful. The whole premise
of this repository is that care is not a mechanism.

**Known limit, stated rather than implied.** Untracked files are invisible to `git diff HEAD`, so a
brand new file is not carried over. The script reports how many it skipped at startup.

---

## ADR-0030 — A command exiting 0 is not evidence that it did the thing

**Context.** Four instances in one session. `dependency-cruiser`'s API builds the graph without
evaluating rules unless `validate: true`, so an assertion about violations passed vacuously.
`git status --porcelain` exits 0 whether or not it prints anything, so a CI step checking for a
dirty tree could never fail. `git worktree remove --force` exits 0 having left `node_modules`
behind, so cleanup leaked a directory per run while reporting success. And
`z.toJSONSchema(..., { unrepresentable: 'throw' })` does not throw on a `.refine()`, so the
proposed fix for a schema gap would not have closed it.

**Decision.** For any cleanup or check whose failure would be silent, assert the *state*, not the
exit code. The verifier now calls `existsSync` on the worktree and exits non-zero if it survives;
the CI step tests the output of `git status`, not its status code.

**Rejected alternative.** Treating each of these as a separate bug. They are one habit — trusting a
tool's report over the world it was supposed to change — and the audit that found them found them
by looking at the world.

---

## ADR-0031 — Source edits go through a tool that fails loudly

**Context.** Four scripted string-replacements failed silently this session while printing a success
message. Two were caught because the code stopped working. The third produced
`verify-guardrails` case 2, which asserted on a rule name that does not exist and therefore passed
on the bare word "error" — a guardrail case that could not fail, counted in the score for two
sessions. The fourth silently dropped a one-line change.

**Decision.** Edits to existing files use an exact-match edit that errors when the pattern is not
found. Scripted `replace()` calls are not used for source changes.

**Rejected alternative.** Being more careful, or verifying each replacement afterwards. The failure
mode is precisely that verification gets skipped when the tool says it succeeded. This is ADR-0030
applied to my own tooling.

---

## ADR-0032 — The current save format has a frozen fixture too

**Context.** `tests/fixtures/save/v1.fsav` is frozen, and its comment explains exactly why
regenerating it would be worthless: it would test the current writer against itself. The current
format then had no fixture at all, so `writeSave` and `readSave` were only ever tested against each
other. Renaming a header key in the writer, the reader and the migration at the same time passed the
entire suite — and a v2 save written by the shipped build came back `ok: true` with an empty chunk
table. No error, no `unknown-version`, silent data loss.

**Decision.** `tests/fixtures/save/v2.fsav`, produced by `tools/make-save-fixture.ts` and frozen.
`format.invariant.test.ts` pins four things: the decoded document, the raw header key names, that
the current writer still emits these exact bytes, and that both frozen fixtures agree on what a
palette entry looks like. The byte-identity assertion is the strong one — it turns any drift in the
writer's output into a failure, which is what a format change is whether or not it was intended.

**Rejected alternative.** Trusting round-trip tests. `write(read(x)) === x` holds no matter how the
format changes, as long as both ends change together. The general rule: the current format needs a
fixture at least as much as the old ones do, and freezing it is free today and impossible later.

**When it fails.** Raise `CURRENT_VERSION`, add the migration step, freeze a *new* fixture. Never
regenerate this one to make the test pass — that deletes the guarantee while appearing to fix it.

---

## ADR-0033 — The verifier carries untracked files, and asserts on test names

**Context.** Two defects found by running the verifier against work in progress, one run apart.
Untracked files were not carried into the isolated worktree — the script printed a warning and moved
on — so a brand new test file and its brand new fixture simply were not there, and the case that
depended on them reported MISS for a reason unrelated to the guardrail. Separately, that case
asserted `/chunkTable/` against vitest output, which prints byte arrays and code frames rather than
the key name, so it reported MISS while the guardrail was firing perfectly.

**Decision.** Untracked, non-ignored files are copied into the worktree. Per-case restore works from
a content snapshot rather than `git checkout`, which has nothing to restore for a file git never
knew about. Cases driven by vitest assert on the failing test's NAME, which is stable and says which
guardrail caught the violation.

**Rejected alternative.** Keeping the warning. A warning is not a mechanism — the whole premise of
this repository — and this one had a lifetime of exactly one run.

**Worth noting.** Both defects failed in the safe direction: a case that cannot pass is visible,
where a case that cannot fail is counted in the score. `verify-guardrails` case 2 was the dangerous
form of the same mistake and survived two sessions.

---

## ADR-0034 — SimPort closes the worker channel instead of guarding it

**Context.** `boundaryMessage` was a typed gate that nothing forced anyone through. The renderer
held a raw `Worker`, and `worker.postMessage({ cmd: 'tick', payload: [1,2,3] })` compiled cleanly.
`TransferSafe<T>` constrained only the code that mentioned it, so invariant 3 was type-level at
exactly one call site that someone had chosen to write correctly.

**Decision.** `attachSimPort(worker, shared)` takes the raw Worker, sends the buffer once, and
returns a `SimPort` whose only channel is `send(payload: BoundaryPayload)`. A
`no-restricted-properties` ban on `postMessage` everywhere except `packages/sim/src/port.ts` and the
worker itself keeps the raw channel out of reach. `new Worker` stays at the call site because Vite
only bundles a worker when it can see that exact shape — but the handle does not survive the line.

**Rejected alternative.** Keeping the gate and documenting that people should use it. A type
constrains the code that mentions it; a wall constrains the code that does not.

**On invariant 4.** The parameter is a DOM `Worker`, a host object like `SharedArrayBuffer`, not a
callback and not something a mod supplies. The guardrails test skips standard-library shapes for
exactly this reason.

---

## ADR-0035 — Ambient non-determinism is sealed at runtime, not only linted

**Context.** The lint banned `Math.random`, `Date.now`, `performance.now`, `new Date()` and
`localeCompare`. All of these passed: `crypto.getRandomValues` (unlisted, and precisely where you go
when `Math.random` is shut), `const M = Math; M.random()`, `globalThis.Math.random()`,
`Math['random']()`, `const { random } = Math`. A guardrail names a mechanism; the invariant is wider
than the mechanism, and the unlisted door is the one that gets used.

**Decision.** `sealAmbientSources()` replaces the functions themselves with throwing stubs,
non-writable and non-configurable, called first thing in the worker. Every alias, computed access
and re-export resolves to the same function object, so there is no aliasing ceiling. The lint stays
as a fast local signal and was widened (`crypto.*`, `process.hrtime`, `toLocale*`, and `new Intl.X()`
with no locale).

**Rejected alternative.** A longer blacklist. Nine bypasses were demonstrated against the previous
one; the tenth was always going to exist.

**And the message that taught the bug.** The old `localeCompare` text ended "or an `Intl.Collator`
pinned to a fixed locale", and a reader in a hurry keeps the class and drops the word "pinned",
landing back on the machine locale with the linter's approval. It now spells out
`new Intl.Collator('en-US-u-kn')`, and an unpinned `Intl` constructor is itself banned.

---

## ADR-0036 — The hot path is measured, not only linted

**Context.** "Hot" was a folder name, not a property of the code. Moving one object literal into a
helper one directory up allocated once per call inside the inner loop and passed lint completely.
So did `subarray`, `toSorted`, `structuredClone` and `+` string concatenation.

**Decision.** `tests/hot-allocation.invariant.test.ts` runs the hot functions 50 000 times and
asserts heap growth stays under 50 KB, against a negative control that must exceed 1 MB. Measured:
8 KB of baseline noise, 110 KB when the delegated-allocation bypass is applied, in 280 ms.

**Rejected alternative.** More lint rules. Lint cannot follow a call, which is the entire bypass.

**Three broken instruments, all caught by the negative control.** Measuring `heapUsed` after a
forced collection reports RETAINED memory, so a control allocating 6.5 million short-lived objects
came back at minus forty bytes. Non-escaping object literals were deleted outright by V8's escape
analysis — 25 KB for 6.5 million literals, which is worth knowing on its own since the lint bans a
syntax whose cost the engine sometimes removes. And `PerformanceObserver` delivers on the microtask
queue, so a synchronous loop yields zero entries. The first calibration then failed to catch the
real bypass because sensitivity to a per-call allocation depends on call count, not grid size.
Without a control that must fail, all four would have passed as a green test proving nothing.

---

## ADR-0037 — The ContentId brand is a speed bump, and says so

**Context.** Six routes forged a `ContentId` past the cast ban. Two are now closed: the
angle-bracket assertion `<ContentId>'sand'` is a different AST node and has its own selector, and
adding `unsafeContentId` beside `parseContentId` — the most natural bypass in the codebase, written
exactly where the rules allow it — is stopped by freezing that file's export list. One cannot be
closed by any syntactic rule:

    function brand<T>(raw: string): T { return raw as unknown as T; }
    export const forged: ContentId = brand<ContentId>('sand');

The cast names `T`. A local type alias is equally invisible.

**Decision.** State the strength honestly. The brand stops the accidental cast; it does not stop
intent. The guarantee is that every point where an id enters from outside — manifests, saves, IPC —
parses it, and that set is small and enumerable. The root CLAUDE.md now says this rather than
claiming ids can only be minted by `parseContentId`.

**Rejected alternative.** Type-aware linting, which would catch the alias but not the generic, at
the cost of the check budget. And leaving the claim as written, which is worse than a weaker claim:
a guarantee believed to be absolute stops being verified.

---

## ADR-0038 — The effective-config guard covers every rule it shares a block with

**Context.** ADR-0021 established that ESLint flat config replaces rule options rather than merging
them, and added a test asserting the effective config still carried the shared `no-restricted-syntax`
selectors. Four ADRs later, the block added for the worker boundary matched `packages/**`, which
includes `packages/sim/src/hot`, and silently switched off every allocating-method ban there.
`.slice()` in a hot function stopped being an error. The guard covered one rule and not its
neighbour, so the named failure mode recurred with the guard in place.

**Decision.** `no-restricted-properties` is composed from named arrays the same way, the hot-path
block re-states all three sets, and the effective-config test now checks properties as well as
syntax, per file.

**Rejected alternative.** Remembering. This is the second occurrence of one mistake, and the first
one already had a test.

---

## ADR-0039 — Verifier flags belong to the thing they describe

**Context.** `verify-guardrails` cases carried a per-case `create: true` flag. A case that creates
one file and modifies another therefore blanked the second, and reported MISS for a guardrail that
worked perfectly — the delegated-allocation case, which is the one that matters most for ADR-0036.

**Decision.** The flag is gone. Whether a file is being created is read from the filesystem, which
is where that fact lives.

**Rejected alternative.** Making it per-edit. It was never information the author needed to supply.

**The pattern this closes.** Four verifier cases have now failed for reasons unrelated to their
guardrail: a rule name that did not exist, an assertion on text the tool never prints (twice), and
this. Each failed in the safe direction — a case that cannot pass is visible in the score. The
dangerous form is the case that cannot fail, which is what `rule:` and the assert-on-test-name
convention exist to prevent.

---

## ADR-0040 — One grammar for content ids, owned by kernel

**Context.** `kernel` had `NAMESPACE_PATTERN`/`PATH_PATTERN`; `rules-schema` had a hand-written
`CONTENT_ID_PATTERN` saying the same thing in different characters. Nothing compared them, and they
had already diverged in effect: adding a hyphen to one made `parseContentId('core:a-b')` succeed
while the published schema rejected it, with `pnpm check` green throughout. ADR-0003 says Zod is the
single source of truth — true for the rule FORMAT, never true for the id grammar, whose real owner
is `kernel`, outside `gen:verify`'s reach.

**Decision.** `kernel` exports the grammar as source strings and `rules-schema` builds its regex
from them, so the two cannot differ by construction. `tests/id-grammar.invariant.test.ts` still runs
a shared corpus through both: derivation is a claim about the code, the corpus is a claim about
behaviour, and the length limit is not expressible as a regex at all.

**Tightened while opening it up.** The old grammar accepted `core:/`, `core://a`, `core:a/`, `0:0`
and a 3005-character id. A path is now slash-separated non-empty segments, a namespace starts with a
letter, and ids cap at 128 characters — the degenerate forms are exactly the ones that hurt once
paths become hierarchical, and they were free to close today.

**Rejected alternative.** A test asserting the two patterns are equal. It keeps the duplication and
only reports the drift.

---

## ADR-0041 — A rule constraint that cannot be published does not exist

**Context.** `.refine()` on a Zod schema is invisible to `z.toJSONSchema`: the emitted file is
byte-identical, `gen:verify` stays green, and the loader silently becomes stricter than the contract
a mod author's editor validates against. Measured — `unrepresentable: 'throw'` does not catch it
either, so the obvious fix does not work.

**Decision.** `.refine`, `.superRefine` and `.transform` are lint-banned in `rules-schema`. A
constraint on the rule format must be expressible in JSON Schema, or the format does not have it.

**Rejected alternative.** Allowing them and documenting the gap. The whole point of publishing a
schema is that the editor and the loader agree; a constraint only one of them knows about is the
failure the schema exists to prevent.

---

## ADR-0042 — Repo TypeScript is run through vite-node, not Node's type stripping

**Context.** `tools/gen-json-schema.mjs` imported `@myfactorio/rules-schema` from plain Node. That
worked only because that file happened to have no relative imports: type stripping removes types, it
does not rewrite `./result.js` to `./result.ts`. The moment `rules-schema` imported
`@myfactorio/kernel`, whose index does have relative imports, `pnpm gen` died on
`Cannot find module .../result.js`. The dependency was latent from the first commit and fired on an
unrelated change. `engines` also said `node >= 22` while stripping only became default in 22.18.

**Decision.** `tools/gen-json-schema.ts` and `tools/make-save-fixture.ts` run under `vite-node`,
which resolves the same way Vite and Vitest do. Being `.ts`, they are typechecked by `pnpm check`
now as well.

**Rejected alternative.** Keeping the `.mjs` and avoiding relative imports in whatever it touches.
That is a constraint on unrelated packages, enforced by nothing, to preserve a convenience.

---

## ADR-0043 — Every verifier tool is proved green before anything is broken

**Context.** A case proves something only if the tool went from green to red BECAUSE of the edit. If
the tool already failed on an untouched tree, every case using it "passes" while proving nothing —
the general form of the vacuity that kept case 2 in the score for two sessions.

**Decision.** `verify-guardrails` runs each distinct tool once on the pristine worktree and aborts
with the failing output if any is already red. Ten tools, once each, not once per case.

**Rejected alternative.** Asserting harder on the refusal text. That checks the message, not the
transition, and four cases have already failed on message-matching for reasons unrelated to their
guardrail.

---

## ADR-0044 — "Never throws" is held structurally, not by audit

**Context.** `result.ts` is the first file in `kernel` and its comment says why the loader must not
throw: the shell has to open a window and show a readable message rather than dying before it draws
anything. The only proof was the empty-directory test — one happy path standing in for every unhappy
one. An unguarded `JSON.parse` on a sidecar file, added later by someone who read that comment and
believed it, sends a `SyntaxError` to the shell's `main()`, which writes `fatal` and exits.

**Decision.** Two layers. Every anticipated failure is still handled individually, because that is
what produces a message a player can act on. And `loadPacks` wraps the whole body, turning anything
unanticipated into `unexpected-error` with the original error in the message. Plus a corpus of
seventeen hostile directories — truncated JSON, a manifest that is a folder, a BOM, a dangling
symlink, two hundred nested arrays, a dangling dependency version — each asserting a Result comes
back at all.

**Rejected alternative.** Auditing each line and keeping the doc comment. Auditing is not a
mechanism, and the comment is what convinces the next person they need not check.

**Not a way to hide bugs.** The catch-all carries the original error, so a crash becomes a legible
failure that a named test points at. The verifier case demonstrates the trade: introduce the
unguarded parse and the hostile suite stays green — the invariant holds — while
"loads the shipped core-empty pack" goes red.

**Found by the test, in the safety net itself.** The first version interpolated `options.packsDir`
into the failure message, so a hostile options object threw again from inside the `catch`. The error
path has to be at least as robust as the happy path, which is easy to write and easy to forget.

---

## ADR-0045 — A manifest that cannot be read is not a missing manifest

**Context.** `readManifest` caught every error from `readFile` and returned "this directory is not a
pack". A `pack.json` that existed but could not be read — a directory of that name, a permission
problem, a bad symlink — made the mod silently disappear, and the player had nothing to go on.

**Decision.** Only `ENOENT` means "not a pack". Anything else is `unreadable-manifest`, naming the
path and the underlying error.

**Rejected alternative.** Catching broadly for robustness. Turning a diagnosable failure into an
absence is not robustness; it is the loss of the only information anyone had.

---

## ADR-0046 — There is no reserved namespace, superseding ADR-0009

**Context.** ADR-0009 reserved `core` for base content, and ADR-0015 handed the question of *who may
claim it* to the host through `reservedNamespaceOwner`. The authorisation token was a directory
NAME. Measured during review: a third-party pack dropped into a folder called `core-empty` was given
the reserved namespace and registered `core:sand` without complaint. Invariant 6 held — the loader
genuinely had no branch for the base pack — while the mechanism guarding the reservation had no
substance at all.

**Decision.** The reservation is removed. `RESERVED_NAMESPACE`, `isReservedNamespace`,
`reservedNamespaceOwner` and the `reserved-namespace` error code are gone. `core` is an ordinary
namespace; the shipped pack claims it the way any mod claims its own, and `loadPacks` now takes one
argument. This supersedes the reservation clause of ADR-0009; everything else in that entry stands.

**Rejected alternative.** Giving the token substance — a signature, a manifest hash pinned in the
shell. That is real work to protect a privilege we had already decided base content should not have.
Invariant 6 says the base pack goes through the mod loader; a namespace only it may use is the same
privilege wearing a different hat.

**What replaces it.** Nothing, which is the point: two packs claiming one namespace is caught by the
duplicate check that was already there, and its message is better than the one it replaces because
it names both directories instead of announcing a rule. A guarantee that comes from the absence of a
mechanism cannot be circumvented by finding the mechanism's edge.

**Kept as convention.** `core` still belongs to the shipped pack by convention, and a mod author who
takes it gets a load-time collision naming both packs. Convention plus a good error message, stated
as such, rather than enforcement that only looked like enforcement.

---

## ADR-0047 — The CI has run, and ADR-0028's caveat is discharged

**Context.** ADR-0028 said plainly that the workflow had never executed and that its YAML parsing
was the whole of the evidence. That caveat is now settled: the first push went green on all three
jobs.

**What it verified that nothing local could.** The e2e passed on Linux under `xvfb`. Cross-origin
isolation, the worker booting over the `SharedArrayBuffer` and the integer round-trip had only ever
been observed on Windows, so the `app://` handler's COOP/COEP headers are now known to work on a
second platform rather than assumed to. The guardrails job also proves the verifier leaves no trace
on a machine that has never seen this repository — a claim previously resting on a local check that
had, at one point, been silently false.

**Amended immediately.** Every job carried a deprecation annotation: `checkout`, `setup-node` and
`pnpm/action-setup` all targeted the Node 20 runtime. Bumped to versions read from the registry
rather than guessed at. A green run with a warning on every job is a green run that trains people to
ignore the warnings.

**Note on the credential helper.** `gh repo create --push` authenticated through gh; a plain
`git push` afterwards did not, because no git credential helper was configured. Set repo-locally
(`git config --local`) rather than globally, so pushing this project does not change how every other
repository on the machine authenticates.

---

## ADR-0048 — Compiled bytecode is not handed out, superseding ADR-0006's claim

**Context.** `save-no-isa`, `save-no-sim` and `modding-api-no-isa` closed every IMPORT path by which
bytecode could reach a save file. The DATA path was untouched: `apps` may import anything,
`LoadedPack.compiled.program` was a public `Uint8Array`, and `SaveDoc.payload` is an opaque
`Uint8Array` by design (ADR-0014). Between two correct decisions sat a five-line function that
writes bytecode into a `.fsav` while no package ever sees an opcode. ADR-0006 said "never written to
disk", and it was false from the day it was written.

**Decision.** `LoadedPack` no longer carries the program. Compiled output lives in a `WeakMap`
inside `runtime`, and packs expose `programLength` — metadata, not bytes. When the simulation needs
the program it crosses into the worker as a `SharedArrayBuffer` through the ADR-0034 boundary, which
is where it was always going and is not a value anyone can hand to `writeSave`.

**Rejected alternative.** An allowlist of chunk ids in `writeSave`. That is a hand-written list
guarding a mechanism — the pattern this review has just spent its time removing — and relabelling a
chunk `grid` defeats it in one word.

**Stated honestly.** `apps` can still build a `Uint8Array` of anything and persist it. What is gone
is the convenient path where the loader hands you compiled bytecode already shaped like a payload.
The claim is now "bytecode is not persisted by accident or by convenience", which is true, rather
than "never", which was not.

**Third instance of one shape.** ADR-0020 corrected ADR-0005 for reachability; ADR-0046 removed a
privilege whose token was a directory name; this removes a value whose absence is the guarantee.
Removing the need is not removing the possibility — and an import rule constrains imports, not data.

---

## ADR-0049 — A dependency without an import is a dependency nothing checks

**Context.** dependency-cruiser reasons about resolved import edges. A service locator —
`(globalThis as unknown as { __bridge?: X }).__bridge` — creates real coupling with no edge, so
`kernel` can reach `runtime` six ranks down and every generated layer rule stays silent.

**Decision.** Both spellings are lint-banned across `packages/` and `apps/`: the member access on
`globalThis` and the cast. Two files are exempt and both are already frozen by tests — the runtime
seal, which must reach globals by string key, and the worker entry, which must find its own scope.

**Caught while writing it.** Only the member-access form was banned at first, and the cast — the one
anybody would actually write, and the one in the report — went straight through. The ban then caught
the heap harness reading `(globalThis as { gc?: () => void }).gc`, correctly: the honest way to name
a global the runtime injects is `declare const gc`, not a cast.

---

## ADR-0050 — Coverage is derived, not remembered

**Context.** Three guardrails had a sound mechanism and a hand-written reach. The heap harness
imported four hot functions by name, so a fifth was measured by nobody. The `DataOnly` walker
iterated call signatures, so an exported class — which carries construct signatures — was invisible,
along with the unconstrained generic its own doc comment predicted. And the loader's `entries`
option, a mock for filesystem ordering, had become the only path any test took, leaving the real
`readdir` unsorted and green.

**Decision.** The heap harness derives the set of functions in `hot/` from the directory and fails if
one is not exercised. The walker follows construct signatures and instance members, and flags a bare
unconstrained type parameter. The determinism suite has a test that passes no `entries` at all.

**Why this pattern is worse than the first one.** "A guardrail names a mechanism, not a fact" is
visible once stated: the rule reads like a list and lists are obviously incomplete. This one hides
behind a mechanism that is genuinely correct — nobody re-reads a walker that works. The tell is the
same in all three: a literal enumerating what the mechanism applies to.

---

## ADR-0051 — Falsify the mechanism, not only the code it guards

**Context.** Three review rounds produced one lesson in three costumes. A guardrail named
`Math.random` and not the class "ambient randomness". Coverage was a hand-written import list, then
a directory name — which ADR-0036 itself calls "not a property of the code". And a test written to
close a mock problem asserted load order, which the topological tie-break already guarantees, so the
pre-sort it was meant to cover could be *reversed* with twenty-nine tests still green.

Each fix was better than the last and each stopped at the edge of the report that prompted it. As
long as coverage is derived from a list of findings, "it is fixed" means "the named forms are
fixed".

**Decision, where derivation is possible.** Derive from a property of the code rather than from a
list. The `DataOnly` walker is now one reachability recursion — signatures, construct signatures,
properties, union members, type arguments — instead of four branches added one demonstration at a
time; object literals, nested objects, arrays of records and Map values all close together. Hot-path
coverage derives from what `sim` exports: every exported callable is exercised or declared cold with
a reason, so moving a function between directories changes nothing.

**Decision, where it is not.** `verify-guardrails` mutates the code a guardrail protects. The
complementary move is to mutate the guardrail's own mechanism and require the suite to go red —
deletion and inversion are different failures, and the pre-sort survived deletion-testing while
being replaceable by its own reverse. Those mutations are now cases in their own right.

**Stated plainly, because pretending otherwise is the failure mode.** The verifier's case list is
itself hand-written, and no mechanism in this repository derives it. Somebody decides what to try.
What can be improved is the cost of trying, so the next reviewer's probes become permanent cases
cheaply — which is what every round has actually done. "Fixed" is not a terminal state; it is the
state where the next edge has not been touched yet.

**Still open, and deliberately so.** The seal has an ordering dependency: an alias taken before
`sealAmbientSources()` runs, or a `.constructor` from an instance created earlier, survives.
Documented, not mechanised. The generic `brand<T>()` launderer stands (ADR-0037). A hot function
`sim` does not export is outside the derived set, and is measured through whatever calls it.
