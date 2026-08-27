# State

*Snapshot. Rewrite this file at the end of every session; do not append to it.*

**Where we are.** The skeleton and its guardrails, and nothing else. Eight packages, an Electron
shell, an empty base content pack, four scripts in `tools/`. No gameplay: no rendering, no elements,
no game loop, no opcode that expresses a rule of play. Measured on `main` at
github.com/Lukianos76/myFactorio:

```
pnpm check              14.2 s   195 tests, 57 modules cruised, 17 dependency rules
pnpm verify:guardrails  47/47    isolated worktree, ~60 s, 10 tools proved green first
pnpm e2e:no-core        11/11    real Electron, both paths, green on Linux under xvfb in CI
CI                      green    check · guardrails · e2e, every push
docs/decisions.md       54 ADRs
```

**The original brief is met.** Every invariant is enforced by a tool, the four requested tests went
red before green in checkable commits, and breaking any rule produces a named refusal —
`pnpm verify:guardrails` does exactly that, 47 times, and CI replays it on every push.

**What four adversarial review rounds did to it.** The reviewer broke the guardrails instead of
reading them, and one lesson arrived in four costumes: *the mechanism names something narrower than
the invariant.* First a function name — `Math.random` banned, `crypto.getRandomValues` not. Then a
hand-written list — four imports in the heap harness, so a fifth hot function was measured by
nobody. Then a directory name, which ADR-0036 itself calls not a property of the code. Then the
quietest one: replacing a mechanism with a better one is a change of reach, and a change of reach
can lose ground — deriving hot coverage from sim's exports silently dropped what deriving it from
`hot/` had caught (ADR-0052). Four guardrails were rebuilt to constrain the fact rather than the
spelling: `SimPort` closes the worker channel, `sealAmbientSources()` replaces the functions
themselves, hot-path allocation is measured against a negative control, and invariant 4 is one
reachability walk instead of a branch per demonstrated shape. Three claims that were plausible,
documented and false are corrected in place by superseding entries (ADR-0020, ADR-0046, ADR-0048).

**What kept going wrong on my side, and is now mechanical.** Four scripted edits failed silently
while printing success — one produced a verifier case that could not fail and sat in the score for
two sessions (ADR-0031), so a stale anchor is now reported as one. "Exit 0" was taken as proof four
separate times: dependency-cruiser needs `validate: true`, `git status --porcelain` always exits 0,
`git worktree remove` leaves `node_modules`, `unrepresentable: 'throw'` does not throw on `.refine()`
(ADR-0030). And a deleted attack case used to change only the denominator; it now fails a test
(ADR-0054).

**Open, and deliberately so.** A generic `brand<T>()` still launders any string into a `ContentId`
and no syntactic rule can see it (ADR-0037). The seal has an ordering dependency: an alias taken
before `sealAmbientSources()` runs survives it. `const M = Math` passes the lint, which is why the
runtime seal exists. Plain `+` concatenation escapes the hot-path lint, though the heap measurement
catches it in volume. A second enumeration site in the loader, concatenated unsorted, has no fixture
that reaches it. `apps/` is covered only by the e2e. And ADR-0051 states the limit that matters: no
mechanism here derives the verifier's own case list — somebody decides what to try, and "fixed" is
the state where the next edge has not been touched yet, not a terminal one.

**Next.** The first real element. It forces the seeded-PRNG decision that ADR-0011 deferred, and the
question of what a rule schema needs beyond an id and a constant pool.
