# @myfactorio/kernel

## Owns

- `ContentId`: the branded type, its grammar, and `parseContentId` — the one place it is minted.
- The `Registry`: qualified name to runtime handle, and back.
- Deterministic ordering primitives: `compareCodeUnits`, `stableTopologicalSort`.
- The event bus and phase scheduler (ordering only — there is no clock and no loop here).
- `Result`, so that fallible calls return failure instead of throwing it.

## Must never

- Import anything. Rank 0 has no dependencies, and that is what lets everyone else share it.
- Let a `ContentId` be produced by anything but `parseContentId`. Casting to it is a lint error
  everywhere except `src/id.ts`.
- Reach for an ambient source of truth: no `Math.random`, `Date.now`, `performance.now`,
  `new Date()`, `localeCompare`. `compareCodeUnits` lives here precisely so nobody needs them.
- Reserve a namespace for anyone. `core` used to be reserved, and the authorisation token was a
  directory NAME — so the privilege went to whoever created that folder. Base content has no
  privilege, so it has no namespace privilege either; a collision is the loader's ordinary
  duplicate check, which names both directories (ADR-0046).
