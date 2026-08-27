# myFactorio — invariants

Read `docs/state.md` and `docs/decisions.md` before doing anything.
End every session by applying `docs/session-checklist.md`.

## Dependency ranks — a package imports only STRICTLY LOWER ranks

0 kernel · 1 rules-schema · 2 isa · 3 rules-compiler · 4 sim · 5 save · 6 runtime · 7 modding-api

`apps/*` may import anything. `packs/*` may import `modding-api` only.
Vocabulary shared by two packages is a third package, never a subpath of one of them.

## Invariants — mechanically enforced, never merely documented

1. Every content id is namespaced (`core:x`, `mymod:x`). `ContentId` is branded and minted only
   by `parseContentId`. Casting to it is a lint error outside `packages/kernel/src/id.ts`.
2. Saves never serialise runtime numeric ids: palette of qualified names, remapped on load.
   Versioned container with a migration chain. `save` may not import `isa` (`save-no-isa`):
   no bytecode is ever persisted. Referencing content — palette, `packs[]` — is legitimate.
3. Nothing crosses the worker boundary but indices and shared buffers (`TransferSafe`).
4. No `sim` API accepts a function. A mod supplies data only (`DataOnly`).
5. No allocation inside function bodies in `packages/sim/src/hot/`. Module-level constants are
   allowed. `eslint-disable` is inert there (`noInlineConfig`).
6. Base content has no privilege: `core-empty` loads through the same loader as any mod.
7. Determinism: sorted scan, topological tie-break by `ContentId`. No `Math.random`, `Date.now`,
   `performance.now`, `new Date()` or `localeCompare` in `sim` or `runtime`.

## Rules about the rules

- A failing `*.invariant.test.ts` means THE CODE IS WRONG. Never adjust the assertion to make it
  pass. If the invariant itself must change, that goes through a `docs/decisions.md` entry first.
- A decision contradicting an existing entry ADDS a superseding entry. Never edit one in place.
- This file is capped at 50 lines by a test. Detail belongs in each package's own CLAUDE.md,
  written as `## Owns` / `## Must never`.

## Verify

`pnpm check` = typecheck + lint + arch + gen:verify + test.
`pnpm e2e:no-core` launches the real Electron shell with no content pack present.
