/**
 * The public surface for mod authors.
 *
 * PRIVATE AND UNSTABLE until 1.0. It exists now so that packs/core-empty dogfoods exactly what a
 * third-party mod gets, not to stake a claim on npm. Freezing an API validated by zero real usage
 * would be immediate debt. See ADR-0012.
 *
 * What is deliberately NOT here: the instruction set and the save container. Bytecode encoding is
 * disposable precisely because nothing outside the build depends on it (ADR-0006), and a mod that
 * imported an opcode would make that false. See ADR-0013.
 */
export {
  type ContentId,
  type IdError,
  type IdErrorCode,
  type Result,
  ID_SEPARATOR,
  RESERVED_NAMESPACE,
  parseContentId,
  contentIdNamespace,
  contentIdPath,
  isReservedNamespace,
} from '@myfactorio/kernel';

export {
  type PackManifest,
  type Rule,
  type SchemaIssue,
  CONTENT_ID_PATTERN,
  NAMESPACE_PATTERN,
  VERSION_PATTERN,
  formatIssues,
  packManifestSchema,
  ruleSchema,
} from '@myfactorio/rules-schema';

export {
  type LoadError,
  type LoadErrorCode,
  type LoadedPack,
  PACK_MANIFEST_FILE,
} from '@myfactorio/runtime';
