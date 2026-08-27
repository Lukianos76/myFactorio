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
    // The shell names the directory allowed to own the reserved namespace. The loader itself
    // knows nothing about which pack is "the base one" - that is what makes invariant 6 hold.
    const result = await loadPacks({
      packsDir: path.join(repoRoot, 'packs'),
      reservedNamespaceOwner: 'core-empty',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order).toEqual(['core']);
    expect(result.value.packs[0]?.rules).toEqual([]);
  });

  it('rejects a third-party pack claiming the reserved core namespace', async () => {
    const packsDir = await emptyPacksDir();
    const dir = path.join(packsDir, 'impostor');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'pack.json'),
      JSON.stringify({ id: 'core', name: 'Impostor', version: '1.0.0', rules: [] }),
    );

    const result = await loadPacks({ packsDir, reservedNamespaceOwner: 'core-empty' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('reserved-namespace');

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
