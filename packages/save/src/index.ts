import { type ContentId, type Handle, type Registry, type Result, ok, err, compareCodeUnits } from '@myfactorio/kernel';
import {
  type ChunkRef,
  type PackRef,
  type SaveDoc,
  type SaveError,
  CURRENT_VERSION,
  parsePalette,
  readContainer,
} from './container.js';
import { migrateToCurrent } from './migrate.js';

export {
  type ChunkRef,
  type PackRef,
  type SaveDoc,
  type SaveError,
  type SaveErrorCode,
  type RawContainer,
  MAGIC,
  CURRENT_VERSION,
  OLDEST_READABLE_VERSION,
  HEADER_OFFSET,
  writeSave,
} from './container.js';
export { type Migration, MIGRATIONS, migrateToCurrent } from './migrate.js';

function readChunkTable(raw: unknown): readonly ChunkRef[] {
  if (!Array.isArray(raw)) return [];
  const chunks: ChunkRef[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    chunks.push({
      id: String(record['id'] ?? ''),
      byteOffset: Number(record['byteOffset'] ?? 0),
      byteLength: Number(record['byteLength'] ?? 0),
      elementSize: Number(record['elementSize'] ?? 1),
    });
  }
  return chunks;
}

function readPackRefs(raw: unknown): readonly PackRef[] {
  if (!Array.isArray(raw)) return [];
  const packs: PackRef[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    packs.push({ id: String(record['id'] ?? ''), version: String(record['version'] ?? '') });
  }
  return packs;
}

export function readSave(bytes: Uint8Array): Result<SaveDoc, SaveError> {
  const container = readContainer(bytes);
  if (!container.ok) return container;

  const onDiskVersion = container.value.version;

  const migrated = migrateToCurrent(container.value);
  if (!migrated.ok) return migrated;

  const paletteHolder = migrated.value.header['palette'];
  const rawIds =
    paletteHolder !== null && typeof paletteHolder === 'object' && !Array.isArray(paletteHolder)
      ? (paletteHolder as Record<string, unknown>)['ids']
      : paletteHolder;

  const palette = parsePalette(rawIds);
  if (!palette.ok) return palette;

  return ok({
    version: CURRENT_VERSION,
    palette: palette.value,
    chunks: readChunkTable(migrated.value.header['chunkTable']),
    packs: readPackRefs(migrated.value.header['packs']),
    payload: migrated.value.payload,
    migratedFrom: onDiskVersion,
  });
}

/**
 * Maps palette index to runtime handle (invariant 2).
 *
 * This is the whole reason saves carry names. Handles depend on load order, which depends on the
 * installed mod set, so the same content gets different numbers on different machines. Content
 * that is no longer installed is reported by name rather than silently remapped onto whatever
 * handle happens to sit at that index.
 */
export function resolvePalette(doc: SaveDoc, registry: Registry): Result<Int32Array, SaveError> {
  const mapping = new Int32Array(doc.palette.length);
  const missing: ContentId[] = [];

  for (let index = 0; index < doc.palette.length; index += 1) {
    const id = doc.palette[index]!;
    const handle: Handle | undefined = registry.handleOf(id);
    if (handle === undefined) {
      missing.push(id);
      continue;
    }
    mapping[index] = handle;
  }

  if (missing.length > 0) {
    const names = [...missing].sort(compareCodeUnits).join(', ');
    return err({
      code: 'unknown-content',
      message:
        `This save references content that is not installed: ${names}. ` +
        'Install the packs that provide it, or the affected cells cannot be restored.',
    });
  }

  return ok(mapping);
}
