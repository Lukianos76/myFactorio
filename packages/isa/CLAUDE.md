# @myfactorio/isa

## Owns

- The instruction vocabulary shared by `rules-compiler` and `sim`: opcodes, instruction layout,
  encoder and decoder.

## Must never

- Promise encoding stability. These four opcodes are disposable. No game element exists yet, so no
  encoding choice here answers a real requirement (ADR-0006).
- Be persisted. Bytecode is a compilation artefact, recomputed on every pack load, and never
  written to disk. `save` cannot even import this package (`save-no-isa`) — if it could, caching a
  compiled program in a `.fsav` to save startup time would silently create a second versioned
  format and freeze this ISA forever.
- Grow into a compiler. Vocabulary only. The moment this package knows how to build a program from
  rules, `sim` inherits the compiler.
