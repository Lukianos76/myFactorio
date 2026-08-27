# State

*Snapshot. Rewrite this file at the end of every session; do not append to it.*

**Where we are.** The skeleton and its guardrails exist, and nothing else. Eight packages
(`kernel`, `rules-schema`, `isa`, `rules-compiler`, `sim`, `save`, `runtime`, `modding-api`), an
Electron shell in `apps/desktop`, an empty base content pack in `packs/core-empty`, three scripts in
`tools/`. `pnpm check` is green in **12.5 s** against a 30 s target, so the `check:full` fallback
from ADR-0017 was never needed and the script was removed rather than left as a misleading alias.
71 tests pass. `pnpm verify:guardrails` reports **17/17**. There is deliberately no gameplay: no
rendering, no elements, no game loop, no opcode that expresses a rule of play.

**What is in place and how it is held.** Every invariant is enforced by a tool: dependency-cruiser
generates one layer rule per package from a single `LAYERS` array, plus `save-no-isa` and
`sim-no-compiler`; `ContentId` is branded and mintable only by `parseContentId`; saves carry a
palette typed `ContentId[]`; `TransferSafe` makes a non-integer worker payload fail to compile;
`DataOnly` plus a compiler-API test keep functions out of `sim`'s surface; the hot-path allocation
lint is scoped to function bodies with `noInlineConfig` so suppressions are inert; the loader has no
branch for the base pack; load order is deterministic. Guardrails on the guardrails: the root
`CLAUDE.md` is capped at 50 lines by a test, a test asserts the *effective* ESLint config still
carries the shared selectors, and invariant tests are named `*.invariant.test.ts` so a future
session knows a red one means the code is wrong. History is red-then-green on purpose, so
"these went from failing to passing" is checkable rather than asserted.

**What the verification pass changed.** Running `verify-guardrails` for the first time scored 13/16
and every miss was real. `sim` could import `rules-compiler` — the ranks permit that edge, so
extracting `isa` had removed the *need* and not the *possibility*, and ADR-0005 said otherwise
(corrected by ADR-0020, now closed by `sim-no-compiler`). The `ContentId` cast ban was dead across
all of `packages/` because flat config replaces rule options instead of merging them, so a later
block had silently discarded it while the source still read as enabled (ADR-0021). And neither
determinism mechanism was actually under test: the loader pre-sort and the topological tie-break
each masked the other's absence (ADR-0022, ADR-0023). Three plausible, documented, wrong claims,
all of which survived until a rule was deliberately broken.

**Open, and next.** `pnpm e2e:no-core` is written but **has never been executed** — it builds the
shell and launches a real Electron against an empty content directory, and it is the only part of
this session not observed working. Run it first. Two absences are by design and will bite the first
person who meets them: there is no seeded PRNG, so the ban on `Math.random` leaves `sim` with no
randomness at all (ADR-0011), and plain `+` string concatenation escapes the hot-path lint because
type-aware linting was rejected for speed (ADR-0010). The natural next milestone is the first real
element, which forces both the PRNG decision and the question of what a rule schema needs beyond an
id and a constant pool.
