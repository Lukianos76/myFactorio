# @myfactorio/modding-api

## Owns

- The public surface a mod author sees: content ids, the rule format, pack manifests, and the
  failure types they will meet.

## Must never

- Be published before 1.0. `private: true`, version `0.x`, **no stability guarantee**. It exists so
  `packs/core-empty` dogfoods exactly what a third-party mod gets — not to stake a claim on a name
  (ADR-0012). Freezing an API validated by zero real usage is immediate debt.
- Re-export `isa` or `save`. Bytecode encoding is disposable only because nothing outside the build
  depends on it, and a mod importing an opcode would make that false. Save container internals are
  not a mod author's business either (ADR-0013).
- Contain logic. Re-exports, types and validators. Anything else belongs in the package that owns it.
