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

const NAMESPACE_PATTERN = /^[a-z0-9_]+$/;
const PATH_PATTERN = /^[a-z0-9_/]+$/;

export type IdErrorCode =
  | 'missing-namespace'
  | 'empty-namespace'
  | 'empty-path'
  | 'too-many-separators'
  | 'not-lowercase'
  | 'invalid-characters';

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
  if (!NAMESPACE_PATTERN.test(namespace)) {
    return fail('invalid-characters', raw, 'the namespace accepts only a-z, 0-9 and underscore.');
  }
  if (!PATH_PATTERN.test(pathPart)) {
    return fail('invalid-characters', raw, 'the path accepts only a-z, 0-9, underscore and slash.');
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
