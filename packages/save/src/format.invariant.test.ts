import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, HEADER_OFFSET, MAGIC, readSave, writeSave } from './index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The CURRENT format, frozen.
 *
 * Until this file existed, `writeSave` and `readSave` were only ever tested against each other, so
 * renaming a header key in the writer, the reader and the migration at the same time passed the
 * whole suite — and silently dropped the chunk table out of every save ever written. The frozen v1
 * fixture explains exactly why that is worthless ("regenerating would test the current writer
 * against itself") and then the current format had no fixture at all.
 *
 * These bytes were produced by `tools/make-save-fixture.ts` and must be left alone. If a test here
 * fails, the format changed: raise CURRENT_VERSION, add the migration, and freeze a NEW fixture.
 * Regenerating this one is how the guarantee gets deleted.
 */
const v2Bytes = new Uint8Array(readFileSync(path.join(repoRoot, 'tests/fixtures/save/v2.fsav')));

const EXPECTED_CELLS = [0, 1, 2, 0, 1, 1, 2, 2, 0, 0, 1, 2];

describe('invariant: the current save format is pinned by a frozen fixture', () => {
  it('reads a v2 container written by a shipped build', () => {
    const result = readSave(v2Bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doc = result.value;
    expect(doc.version).toBe(CURRENT_VERSION);
    // Not migrated: it was already current when it was written.
    expect(doc.migratedFrom).toBe(CURRENT_VERSION);
    expect(doc.palette).toEqual(['core:sand', 'core:water', 'my_mod:ore/iron']);
    expect(doc.chunks).toEqual([{ id: 'grid', byteOffset: 0, byteLength: 24, elementSize: 2 }]);
    expect(doc.packs).toEqual([
      { id: 'core', version: '0.1.0' },
      { id: 'my_mod', version: '2.3.4' },
    ]);

    const cells = new Uint16Array(doc.payload.buffer, doc.payload.byteOffset, doc.payload.byteLength / 2);
    expect([...cells]).toEqual(EXPECTED_CELLS);
  });

  it('pins the header key names, not just the decoded shape', () => {
    // Reading through readSave would also catch a rename, but only as a missing chunk table three
    // assertions later. Naming the keys says what the on-disk contract IS.
    const view = new DataView(v2Bytes.buffer, v2Bytes.byteOffset, v2Bytes.byteLength);
    expect(String.fromCharCode(...v2Bytes.subarray(0, 4))).toBe(MAGIC);
    expect(view.getUint32(4, true)).toBe(CURRENT_VERSION);

    const headerLength = view.getUint32(8, true);
    const header = JSON.parse(
      new TextDecoder().decode(v2Bytes.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength)),
    ) as Record<string, unknown>;

    expect(Object.keys(header).sort()).toEqual(['chunkTable', 'packs', 'palette']);
    expect(Object.keys(header['palette'] as object)).toEqual(['ids']);
  });

  it('the current writer still produces these exact bytes', () => {
    const result = readSave(v2Bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The strongest form of the pin: not "we can read it back", but "we still write it". A failure
    // here means the writer's output drifted, which is a format change whether or not it was
    // intended — and a format change without a version bump is the bug this file exists to catch.
    expect([...writeSave(result.value)]).toEqual([...v2Bytes]);
  });

  it('a v1 save and a v2 save agree on what the palette means', () => {
    // The two frozen fixtures share no bytes and were written years of format apart in principle.
    // Both must land on qualified names, which is the whole of invariant 2.
    const v1 = readSave(new Uint8Array(readFileSync(path.join(repoRoot, 'tests/fixtures/save/v1.fsav'))));
    const v2 = readSave(v2Bytes);
    expect(v1.ok && v2.ok).toBe(true);
    if (!v1.ok || !v2.ok) return;

    expect(v1.value.migratedFrom).toBe(1);
    expect(v2.value.migratedFrom).toBe(2);
    for (const doc of [v1.value, v2.value]) {
      for (const entry of doc.palette) expect(entry).toMatch(/^[a-z0-9_]+:[a-z0-9_/]+$/);
    }
  });
});
