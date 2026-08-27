# State

*Snapshot. Rewrite this file at the end of every session; do not append to it.*

**Where we are.** The skeleton and its guardrails exist, and nothing else. Eight packages
(`kernel`, `rules-schema`, `isa`, `rules-compiler`, `sim`, `save`, `runtime`, `modding-api`), an
Electron shell in `apps/desktop`, an empty base content pack in `packs/core-empty`, and two scripts
in `tools/`. `pnpm check` is green in **11.1 s** against a 30 s target, so the `check:full` fallback
described in ADR-0017 was not needed and the script was removed rather than left as a misleading
alias. 46 tests pass. There is deliberately no gameplay: no rendering, no elements, no game loop,
and no opcode that expresses a rule of play.

**What is in place and how it is held.** Every invariant is enforced by a tool rather than by
documentation: dependency-cruiser generates one layer rule per package from a single `LAYERS`
array plus `save-no-isa`; `ContentId` is branded and can only be minted by `parseContentId`, with
casts lint-banned elsewhere; saves carry a palette of qualified names typed as `ContentId[]`;
`TransferSafe` makes a non-integer worker payload fail to compile; `DataOnly` plus a compiler-API
test keep functions out of `sim`'s public surface; the hot-path allocation lint is scoped to
function bodies with `noInlineConfig` on so suppressions are inert; the loader has no branch for
the base pack; and load order is deterministic through a sorted scan and a tie-broken topological
sort. Two guardrails guard the guardrails: the root `CLAUDE.md` is capped at 50 lines by a test,
and invariant tests are named `*.invariant.test.ts` so a future session knows a red one means the
code is wrong. The history has two commits on purpose — `test: invariant suite, red` then the
implementation — so "these went from red to green" is checkable rather than asserted.

**Open, and next.** `pnpm e2e:no-core` has been written but **never executed**: it builds the shell
and launches a real Electron against an empty content directory, and it is the only part of this
session that has not been observed working. Run it first. The break-a-rule verification pass —
deliberately violating each invariant and watching the tool refuse — is likewise written up in the
plan but not yet performed end to end. Two things are known-absent by design and will bite the
first person who needs them: there is no seeded PRNG, so the ban on `Math.random` leaves `sim` with
no randomness at all (ADR-0011), and plain `+` string concatenation escapes the hot-path lint
because type-aware linting was rejected for speed (ADR-0010). The natural next milestone is the
first real element, which forces both the PRNG decision and the question of what a rule schema
needs to grow beyond an id and a constant pool.
