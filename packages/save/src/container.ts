import { type ContentId, type Result, ok, err, parseContentId } from '@myfactorio/kernel';

/**
 * The .fsav container.
 *
 * MAGIC (4 bytes) | version u32 LE | header length u32 LE | header JSON UTF-8 | payload bytes
 *
 * A JSON header keeps the part that evolves readable and cheap to migrate; the payload stays raw
 * so a large grid costs what it weighs. The payload is opaque here on purpose: save does not
 * import sim, so the in-memory layout can change without every change becoming a migration
 * (ADR-0014).
 */
export const MAGIC = 'FSAV';
export const CURRENT_VERSION = 2;
export const OLDEST_READABLE_VERSION = 1;
export const HEADER_OFFSET = 12;

export interface ChunkRef {
  readonly id: string;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly elementSize: number;
}

export interface PackRef {
  readonly id: string;
  readonly version: string;
}

export interface SaveDoc {
  readonly version: typeof CURRENT_VERSION;
  /**
   * Qualified names, never runtime handles (invariant 2). Typing this as ContentId[] is what makes
   * writing a handle a type error rather than a review comment.
   */
  readonly palette: readonly ContentId[];
  readonly chunks: readonly ChunkRef[];
  readonly packs: readonly PackRef[];
  readonly payload: Uint8Array;
  /** The version as found on disk, before migration. Equal to version for a fresh save. */
  readonly migratedFrom: number;
}

export type SaveErrorCode =
  | 'bad-magic'
  | 'truncated'
  | 'unknown-version'
  | 'invalid-header'
  | 'invalid-palette-id'
  | 'unknown-content';

export interface SaveError {
  readonly code: SaveErrorCode;
  readonly message: string;
}

export interface RawContainer {
  readonly version: number;
  readonly header: Record<string, unknown>;
  readonly payload: Uint8Array;
}

export function readContainer(bytes: Uint8Array): Result<RawContainer, SaveError> {
  // Identity before size: told "this file is truncated" about a JPEG, a player goes looking for
  // corruption that is not there. Answer the question they actually asked first.
  if (bytes.byteLength < MAGIC.length) {
    return err({ code: 'bad-magic', message: `Not a myFactorio save: file is only ${bytes.byteLength} bytes.` });
  }
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== MAGIC) {
    return err({ code: 'bad-magic', message: `Not a myFactorio save: expected magic ${MAGIC}, found ${JSON.stringify(magic)}.` });
  }

  if (bytes.byteLength < HEADER_OFFSET) {
    return err({ code: 'truncated', message: `A save is at least ${HEADER_OFFSET} bytes; got ${bytes.byteLength}.` });
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  const headerLength = view.getUint32(8, true);

  const payloadOffset = HEADER_OFFSET + headerLength;
  if (payloadOffset > bytes.byteLength) {
    return err({
      code: 'truncated',
      message: `Header claims ${headerLength} bytes but the file holds ${bytes.byteLength - HEADER_OFFSET}.`,
    });
  }

  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_OFFSET, payloadOffset)));
  } catch (cause) {
    return err({ code: 'invalid-header', message: `Save header is not valid JSON: ${String(cause)}.` });
  }
  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    return err({ code: 'invalid-header', message: 'Save header must be a JSON object.' });
  }

  return ok({
    version,
    header: header as Record<string, unknown>,
    payload: bytes.slice(payloadOffset),
  });
}

export function writeSave(doc: SaveDoc): Uint8Array {
  const header = JSON.stringify({
    palette: { ids: doc.palette },
    chunkTable: doc.chunks,
    packs: doc.packs,
  });
  const headerBytes = new TextEncoder().encode(header);

  const out = new Uint8Array(HEADER_OFFSET + headerBytes.byteLength + doc.payload.byteLength);
  for (let i = 0; i < MAGIC.length; i += 1) out[i] = MAGIC.charCodeAt(i);

  const view = new DataView(out.buffer);
  view.setUint32(4, CURRENT_VERSION, true);
  view.setUint32(8, headerBytes.byteLength, true);

  out.set(headerBytes, HEADER_OFFSET);
  out.set(doc.payload, HEADER_OFFSET + headerBytes.byteLength);
  return out;
}

export function parsePalette(raw: unknown): Result<readonly ContentId[], SaveError> {
  if (!Array.isArray(raw)) {
    return err({ code: 'invalid-header', message: 'Save palette must be an array of qualified content ids.' });
  }

  const palette: ContentId[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return err({ code: 'invalid-palette-id', message: `Palette entry ${JSON.stringify(entry)} is not a string.` });
    }
    const parsed = parseContentId(entry);
    if (!parsed.ok) {
      return err({ code: 'invalid-palette-id', message: parsed.error.message });
    }
    palette.push(parsed.value);
  }
  return ok(palette);
}
