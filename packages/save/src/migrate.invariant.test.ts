import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Registry } from '@myfactorio/kernel';
import { CURRENT_VERSION, readSave, writeSave, resolvePalette } from './index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Frozen artefact. These bytes were produced by the v1 writer and must never be regenerated:
 * regenerating them would test the current writer against itself instead of testing that we can
 * still read what shipped.
 */
const v1Bytes = new Uint8Array(readFileSync(path.join(repoRoot, 'tests/fixtures/save/v1.fsav')));

describe('invariant: an older save version migrates forward', () => {
  it('reads a v1 container and yields a current-version document', () => {
    const result = readSave(v1Bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doc = result.value;
    expect(doc.version).toBe(CURRENT_VERSION);
    expect(doc.migratedFrom).toBe(1);
    expect(doc.palette).toEqual(['core:sand', 'core:water', 'core:stone']);
    // v1 had no chunk table; the migration synthesises one covering the whole payload.
    expect(doc.chunks).toEqual([
      { id: 'grid', byteOffset: 0, byteLength: 16, elementSize: 2 },
    ]);
    expect(doc.packs).toEqual([]);
    expect(doc.payload.byteLength).toBe(16);
  });

  it('round-trips a migrated document through the current writer', () => {
    const first = readSave(v1Bytes);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rewritten = writeSave(first.value);
    const second = readSave(rewritten);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.migratedFrom).toBe(CURRENT_VERSION);
    expect(second.value.palette).toEqual(first.value.palette);
    expect(second.value.chunks).toEqual(first.value.chunks);
    expect([...second.value.payload]).toEqual([...first.value.payload]);
  });

  it('refuses a version from the future with a clear message, without throwing', () => {
    const future = Uint8Array.from(v1Bytes);
    new DataView(future.buffer).setUint32(4, 99, true);

    const result = readSave(future);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-version');
    expect(result.error.message).toContain('99');
    expect(result.error.message).toContain(String(CURRENT_VERSION));
  });

  it('refuses a container that is not a save at all', () => {
    const result = readSave(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('bad-magic');
  });
});

describe('invariant: saves carry a name palette, never runtime handles', () => {
  it('resolves to the same qualified names across registries with different handle assignment', () => {
    const result = readSave(v1Bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = result.value;

    // Two registries, deliberately different insertion orders. This is what actually happens
    // when a player installs a different set of mods: the same content gets different handles.
    const a = new Registry();
    for (const id of ['core:sand', 'core:water', 'core:stone']) a.register(id);

    const b = new Registry();
    for (const id of ['core:stone', 'core:water', 'core:sand']) b.register(id);

    const mappingA = resolvePalette(doc, a);
    const mappingB = resolvePalette(doc, b);
    expect(mappingA.ok && mappingB.ok).toBe(true);
    if (!mappingA.ok || !mappingB.ok) return;

    // The handles genuinely differ - otherwise this test would prove nothing.
    expect([...mappingA.value]).not.toEqual([...mappingB.value]);

    const cells = new Uint16Array(doc.payload.buffer, doc.payload.byteOffset, doc.payload.byteLength / 2);
    const namesA = [...cells].map((cell) => a.idOf(mappingA.value[cell]!));
    const namesB = [...cells].map((cell) => b.idOf(mappingB.value[cell]!));

    expect(namesA).toEqual(namesB);
    expect(namesA).toEqual([
      'core:sand', 'core:water', 'core:stone', 'core:sand',
      'core:water', 'core:water', 'core:sand', 'core:stone',
    ]);
  });

  it('reports content that is no longer installed instead of silently remapping it', () => {
    const result = readSave(v1Bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const partial = new Registry();
    partial.register('core:sand');

    const mapping = resolvePalette(result.value, partial);
    expect(mapping.ok).toBe(false);
    if (mapping.ok) return;
    expect(mapping.error.code).toBe('unknown-content');
    expect(mapping.error.message).toContain('core:water');
    expect(mapping.error.message).toContain('core:stone');
  });
});
