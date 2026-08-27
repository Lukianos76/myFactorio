import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPacks } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

async function emptyPacksDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'myfactorio-packs-'));
}

describe('invariant: base content has no privilege', () => {
  it('starts without any content pack and explains what is missing', async () => {
    const packsDir = await emptyPacksDir();

    // The whole point: this must resolve, never reject. The shell has to be able to open a
    // window and show the message rather than die before it draws anything.
    const result = await loadPacks({ packsDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('no-packs-found');
    expect(result.error.message).toContain(packsDir);
    expect(result.error.message).toContain('pack.json');

    await rm(packsDir, { recursive: true, force: true });
  });

  it('does not throw when the packs directory does not exist at all', async () => {
    const missing = path.join(tmpdir(), 'myfactorio-does-not-exist-9d3f1c');

    const result = await loadPacks({ packsDir: missing });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('packs-dir-missing');
    expect(result.error.message).toContain(missing);
  });

  it('loads the shipped core-empty pack through the ordinary mod path', async () => {
    // One argument, the same one any mod directory would get. There is nothing here to tell the
    // loader which pack is "the base one", which is what makes invariant 6 hold.
    const result = await loadPacks({ packsDir: path.join(repoRoot, 'packs') });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order).toEqual(['core']);
    expect(result.value.packs[0]?.rules).toEqual([]);
  });

  it('a third-party pack claiming core collides with it like any other namespace', async () => {
    // `core` used to be reserved, and the token was a DIRECTORY NAME: an impostor dropped into a
    // folder called `core-empty` was handed the namespace. The invariant held while the mechanism
    // was hollow. Removing the reservation makes this an ordinary collision, and the ordinary
    // message is better - it names both directories instead of announcing a rule. See ADR-0046.
    const packsDir = await emptyPacksDir();
    for (const [dirName, name] of [['a_impostor', 'Impostor'], ['b_base', 'Base']]) {
      const dir = path.join(packsDir, dirName!);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'pack.json'),
        JSON.stringify({ id: 'core', name, version: '1.0.0', rules: [] }),
      );
    }

    const result = await loadPacks({ packsDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('duplicate-namespace');
    expect(result.error.message).toContain('a_impostor');
    expect(result.error.message).toContain('b_base');

    await rm(packsDir, { recursive: true, force: true });
  });

  it('a pack dropped into a directory named core-empty gets no privilege from the name', async () => {
    const packsDir = await emptyPacksDir();
    const dir = path.join(packsDir, 'core-empty');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'pack.json'),
      JSON.stringify({ id: 'not_core', name: 'Impostor', version: '1.0.0', rules: [{ id: 'not_core:x', constants: [] }] }),
    );

    const result = await loadPacks({ packsDir });

    // It loads, exactly like any other pack, because the directory name means nothing.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order).toEqual(['not_core']);

    await rm(packsDir, { recursive: true, force: true });
  });

  /**
   * Kept as a net, explicitly NOT the proof. It asserts on source text and any constant or bit
   * of concatenation walks straight past it. The test that actually carries invariant 6 is the
   * empty-directory one above. See docs/decisions.md, ADR-0015.
   */
  it('net: the loader has no hardcoded branch on the base pack', async () => {
    const source = await readFile(path.join(here, 'loader.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/['"`]core['"`]/);
    expect(code).not.toMatch(/core-empty/);
  });
});
