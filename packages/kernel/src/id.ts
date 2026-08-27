import { type Result, ok, err } from './result.js';

declare const contentIdBrand: unique symbol;

/**
 * A validated, namespaced content id.
 *
 * The brand is not decoration. Ids arrive from disk — manifests, saves, mod files — where a
 * compile-time-only type such as `${string}:${string}` evaporates entirely. Minting is confined
 * to parseContentId below, and a lint rule forbids casting to ContentId anywhere else, so the
 * only way to hold one is to have validated it.
 */
export type ContentId = string & { readonly [contentIdBrand]: 'ContentId' };

export const ID_SEPARATOR = ':';

/** Reserved for the base content pack. Which pack may claim it is the host's call, not ours. */
export const RESERVED_NAMESPACE = 'core';

/**
 * The grammar, as source strings so `rules-schema` can publish exactly this and not a copy.
 *
 * It used to be one regex here and another, hand-written, in `rules-schema`. Two definitions of one
 * truth with nothing comparing them: `core:a-b` parsed here and was rejected by the published
 * schema, and neither side noticed. `id-grammar.invariant.test.ts` runs a shared corpus through
 * both and demands the same verdict. See ADR-0040.
 *
 * Tighter than the first version, which accepted `core:/`, `core://a`, `core:a/` and a 3005
 * character id. A path is slash-separated segments, each non-empty - the degenerate forms are the
 * ones that hurt once paths become hierarchical.
 */
export const NAMESPACE_SOURCE = '[a-z][a-z0-9_]*';
export const PATH_SEGMENT_SOURCE = '[a-z0-9_]+';
export const PATH_SOURCE = `${PATH_SEGMENT_SOURCE}(?:/${PATH_SEGMENT_SOURCE})*`;
export const CONTENT_ID_SOURCE = `^${NAMESPACE_SOURCE}:${PATH_SOURCE}$`;

/** Long enough for deep hierarchies, short enough to stay a key rather than a document. */
export const MAX_CONTENT_ID_LENGTH = 128;

const NAMESPACE_PATTERN = new RegExp(`^${NAMESPACE_SOURCE}$`);
const PATH_PATTERN = new RegExp(`^${PATH_SOURCE}$`);

export type IdErrorCode =
  | 'missing-namespace'
  | 'empty-namespace'
  | 'empty-path'
  | 'too-many-separators'
  | 'not-lowercase'
  | 'invalid-characters'
  | 'too-long';

export interface IdError {
  readonly code: IdErrorCode;
  readonly input: string;
  readonly message: string;
}

function fail(code: IdErrorCode, input: string, detail: string): Result<never, IdError> {
  const shown = input === '' ? '(empty string)' : input;
  return err({ code, input, message: `Invalid content id ${shown}: ${detail}` });
}

export function parseContentId(raw: string): Result<ContentId, IdError> {
  if (!raw.includes(ID_SEPARATOR)) {
    return fail(
      'missing-namespace',
      raw,
      `every content id must be namespaced, as in core:sand or my_mod:sand. Add a namespace and a ${ID_SEPARATOR}.`,
    );
  }

  const parts = raw.split(ID_SEPARATOR);
  if (parts.length > 2) {
    return fail('too-many-separators', raw, `exactly one ${ID_SEPARATOR} is allowed; found ${parts.length - 1}.`);
  }

  const [namespace = '', pathPart = ''] = parts;
  if (namespace === '') {
    return fail('empty-namespace', raw, 'the namespace before the separator is empty.');
  }
  if (pathPart === '') {
    return fail('empty-path', raw, 'the path after the separator is empty.');
  }
  if (raw !== raw.toLowerCase()) {
    return fail('not-lowercase', raw, 'content ids are lowercase. Case-insensitive filesystems make mixed case ambiguous.');
  }
  if (raw.length > MAX_CONTENT_ID_LENGTH) {
    return fail('too-long', raw, `content ids are at most ${MAX_CONTENT_ID_LENGTH} characters; this one is ${raw.length}.`);
  }
  if (!NAMESPACE_PATTERN.test(namespace)) {
    return fail(
      'invalid-characters',
      raw,
      'the namespace starts with a letter and then accepts a-z, 0-9 and underscore.',
    );
  }
  if (!PATH_PATTERN.test(pathPart)) {
    return fail(
      'invalid-characters',
      raw,
      'the path is slash-separated segments of a-z, 0-9 and underscore. No leading, trailing or ' +
        'doubled slash, and no empty segment.',
    );
  }

  // The single minting point for the brand; see the lint rule in eslint.config.js.
  return ok(raw as ContentId);
}

export function contentIdNamespace(id: ContentId): string {
  return id.slice(0, id.indexOf(ID_SEPARATOR));
}

export function contentIdPath(id: ContentId): string {
  return id.slice(id.indexOf(ID_SEPARATOR) + 1);
}

export function isReservedNamespace(namespace: string): boolean {
  return namespace === RESERVED_NAMESPACE;
}
