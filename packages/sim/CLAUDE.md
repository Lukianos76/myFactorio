# @myfactorio/sim

## Owns

- The world layout over typed arrays, and views onto the shared buffer.
- The worker boundary contract: `BoundaryPayload`, `TransferSafe`, `boundaryMessage`, the control
  block slot indices.
- `src/hot/`: the allocation-free inner loops.
- `src/worker/worker.ts`: the worker itself. Currently empty on purpose — it exists so the boundary
  can be observed rather than argued about.

## Must never

- Accept a function in any public API (invariant 4). `DataOnly<T>` makes it unrepresentable and
  `tests/guardrails.invariant.test.ts` walks the exported signatures to confirm it independently.
- Send anything across the boundary but an index or the shared buffer (invariant 3).
- Allocate inside a function body in `src/hot/` (invariant 5). Module-level constants are fine.
  Inline suppression comments are inert there; if a rule becomes unsatisfiable, the calibration in
  `eslint.config.js` is wrong and gets fixed there.
- Touch the DOM, Node builtins, Electron, or any ambient clock or randomness. When randomness is
  finally needed, it comes from a seeded PRNG carried in simulation state.
