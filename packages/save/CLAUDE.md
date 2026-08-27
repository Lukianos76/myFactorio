# @myfactorio/save

## Owns

- The `.fsav` container: magic, version, JSON header, raw payload.
- The name palette, and `resolvePalette` — the remap from palette index to runtime handle.
- The migration chain, and the guarantee that it has no gaps.

## Must never

- Serialise a runtime handle (invariant 2). `SaveDoc.palette` is `ContentId[]`, so a handle is a
  type error rather than a review comment. Handles depend on load order; names do not.
- Import `isa` (`save-no-isa`). The rule forbids persisting **bytecode**, and nothing else:
  referencing content — the id palette, the `packs[]` list — is exactly what invariant 2 asks for
  and stays entirely legitimate.
- Import `sim` (`save-no-sim`). The ranks permit this edge, so only the explicit rule closes it.
  Chunk payloads are opaque byte ranges. Keeping them opaque is what lets the
  in-memory layout change without every change becoming a save migration (ADR-0014).
- Raise `CURRENT_VERSION` without adding the matching entry to `MIGRATIONS`.
  `chain.invariant.test.ts` fails if that happens.
