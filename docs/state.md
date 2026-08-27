# State

*Snapshot. Rewrite this file at the end of every session; do not append to it.*

**Where we are.** The skeleton and its guardrails, and nothing else. Eight packages, an Electron
shell, an empty base content pack, four scripts in `tools/`. No gameplay: no rendering, no elements,
no game loop, no opcode that expresses a rule of play. Current, measured, on `adversarial-review`:

```
pnpm check          14.0 s   144 tests, 56 modules cruised, 17 dependency rules
pnpm verify:guardrails  31/31   in an isolated worktree, ~60 s
pnpm e2e:no-core        11/11   real Electron, both paths
docs/decisions.md       46 ADRs
```

**What the adversarial review changed.** Two rounds of review broke the guardrails rather than
reading them, and found 24 bypasses that passed `pnpm check`. The pattern behind almost all of them:
*a guardrail names a mechanism, and the invariant is always wider than the mechanism, so the door
that gets used is the one the list does not name.* `Math.random` was banned and
`crypto.getRandomValues` was not. `save` could not import `isa` but `apps` could write the bytecode.
"Hot" was a folder name, so the allocation moved one folder up. Four guardrails were rebuilt to
constrain the fact instead of the syntax: `SimPort` closes the worker channel rather than guarding
it, `sealAmbientSources()` replaces the functions themselves, hot-path allocation is measured
against a negative control, and the `ContentId` brand is now documented as the speed bump it is
rather than the wall it was claimed to be. The reserved namespace was deleted outright — its
authorisation token was a directory name, so it protected nothing; a collision is now the ordinary
duplicate check, and the guarantee comes from the absence of a mechanism.

**What kept going wrong, and is now mechanical.** Three claims in the docs were plausible and false
until someone broke a rule (ADR-0020, ADR-0022, ADR-0026), so `tests/doctrine.invariant.test.ts`
turns every `## Must never` line into an executable requirement. `pnpm check` ran only when a human
typed it, so there is CI. `verify-guardrails` edited the working tree and clobbered a reviewer
mid-review, so it runs in a throwaway worktree. Four scripted edits failed silently while printing
success — one of them produced a verifier case that could not fail and sat in the score for two
sessions (ADR-0031). And "exit 0" was taken as proof four separate times: dependency-cruiser's API
needs `validate: true`, `git status --porcelain` always exits 0, `git worktree remove` leaves
`node_modules`, `unrepresentable: 'throw'` does not throw on `.refine()` (ADR-0030).

**Open.** The CI workflow has still never run — its YAML parses and `--frozen-lockfile` holds
locally, and that is the whole of the evidence; the first push is the test. Known and deliberate
gaps: no seeded PRNG, so `sim` has no randomness at all by design (ADR-0011); a generic
`brand<T>()` helper still launders any string into a `ContentId` and no syntactic rule can see it
(ADR-0037); `const M = Math` passes the lint, which is why the runtime seal exists; plain `+` string
concatenation escapes the hot-path lint, though the heap measurement catches it in volume.
`apps/` is covered only by the e2e. The natural next milestone is the first real element, which
forces the PRNG decision and the question of what a rule schema needs beyond an id and a constant
pool.
