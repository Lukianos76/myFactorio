import { z } from 'zod';

/**
 * The declarative rule format, and the single source of truth for it.
 *
 * These Zod declarations generate the JSON Schema that ships to mod authors
 * (`pnpm gen`, verified by `pnpm gen:verify`). Editing a schema without regenerating fails the
 * check, so the published schema cannot drift away from what the loader actually enforces.
 *
 * Nothing here expresses a game rule. A rule is currently an id plus a constant pool: enough to
 * exercise the compile pipeline end to end, and not one field more.
 */

export const NAMESPACE_PATTERN = '^[a-z0-9_]+$';
export const CONTENT_ID_PATTERN = '^[a-z0-9_]+:[a-z0-9_/]+$';
export const VERSION_PATTERN = '^[0-9]+\\.[0-9]+\\.[0-9]+$';

export const namespaceSchema = z
  .string()
  .regex(new RegExp(NAMESPACE_PATTERN), 'A namespace accepts only a-z, 0-9 and underscore.')
  .describe('Pack namespace. Owns every content id the pack declares.');

export const contentIdSchema = z
  .string()
  .regex(
    new RegExp(CONTENT_ID_PATTERN),
    'Content ids are namespaced and lowercase, as in core:sand or my_mod:ore/iron.',
  )
  .describe('Fully qualified content id.');

export const versionSchema = z
  .string()
  .regex(new RegExp(VERSION_PATTERN), 'Versions are major.minor.patch.')
  .describe('Pack version.');

export const ruleSchema = z
  .strictObject({
    id: contentIdSchema,
    constants: z
      .array(z.number().int())
      .max(256)
      .default([])
      .describe('Constant pool for this rule. Data only: a rule can never carry code.'),
  })
  .describe('A single declarative rule.');

export const packManifestSchema = z
  .strictObject({
    id: namespaceSchema,
    name: z.string().min(1).describe('Human-readable pack name.'),
    version: versionSchema,
    dependencies: z
      .record(namespaceSchema, versionSchema)
      .default({})
      .describe('Packs that must load before this one, by namespace.'),
    rules: z.array(ruleSchema).default([]).describe('Declarative rules contributed by this pack.'),
  })
  .describe('pack.json — the manifest every content pack provides, base content included.');

export type Rule = z.output<typeof ruleSchema>;
export type PackManifest = z.output<typeof packManifestSchema>;

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
}

/** Flattens Zod issues into a shape that can go straight into a message a mod author reads. */
export function formatIssues(error: z.ZodError): readonly SchemaIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

export { z };
