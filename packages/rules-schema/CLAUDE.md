# @myfactorio/rules-schema

## Owns

- The declarative rule format, as Zod declarations. This is the single source of truth for it.
- The generated JSON Schema shipped to mod authors, in `schema/`. `pnpm gen:verify` fails if it
  drifts from the declarations, so the published contract cannot lie.
- `formatIssues`: turning validation failures into something a mod author can act on.

## Must never

- Express a game rule. A rule is an id and a constant pool; when elements arrive, extending this
  is a decision that goes through `docs/decisions.md`, not a quiet field addition.
- Validate with dynamic code generation. Zod was chosen over Ajv precisely to avoid `new Function`
  under a strict CSP (ADR-0003).
- Hand-edit anything in `schema/`. Regenerate it.
