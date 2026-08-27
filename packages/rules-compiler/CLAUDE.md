# @myfactorio/rules-compiler

## Owns

- The translation from validated rules to flat tables and bytecode.
- The layout of those tables: `ruleIds`, `constantPool`, `constantOffsets`, `program`.

## Must never

- Emit anything that holds a reference to a rule object. Output is typed arrays and bytes, so that
  it can become a shared buffer later without this package following it across.
- Be imported by `sim`. There is no path — that is the point of `isa` being its own package.
- Run at load time in the worker. Compilation happens host-side, once, before the worker starts.
