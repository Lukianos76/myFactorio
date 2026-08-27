import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPacks } from './index.js';

/**
 * Invariant: the loader returns a failure, it never throws one.
 *
 * `result.ts` is the first file in kernel and its comment says why this matters: the shell has to be
 * able to open a window and show a readable message rather than dying before it draws anything. The
 * only proof of it was the empty-directory test - one happy path for the promise that covers every
 * unhappy one.
 *
 * These are the shapes a content directory actually takes when something has gone wrong on a
 * player's machine: an interrupted download, an antivirus quarantine, a mod unzipped one level too
 * deep, a manifest that is a folder. Every one must come back as a Result.
 */
const dirs: string[] = [];

async function fixture(build: (dir: string) => Promise<void>): Promise<string> {
  const packsDir = await mkdtemp(path.join(tmpdir(), 'myfactorio-hostile-'));
  dirs.push(packsDir);
  await build(packsDir);
  return packsDir;
}

async function pack(packsDir: string, name: string, manifest: string): Promise<void> {
  const dir = path.join(packsDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'pack.json'), manifest);
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('invariant: loadPacks always returns, whatever it is pointed at', () => {
  const cases: readonly (readonly [label: string, build: (dir: string) => Promise<void>])[] = [
    ['truncated JSON', (d) => pack(d, 'a', '{"id":"a","name":"A","vers')],
    ['JSON that is an array', (d) => pack(d, 'a', '[]')],
    ['JSON that is null', (d) => pack(d, 'a', 'null')],
    ['JSON that is a bare string', (d) => pack(d, 'a', '"hello"')],
    ['an empty file', (d) => pack(d, 'a', '')],
    ['a UTF-8 BOM before the object', (d) => pack(d, 'a', '﻿{"id":"a","name":"A","version":"1.0.0"}')],
    ['valid JSON of the wrong shape', (d) => pack(d, 'a', '{"totally":"different"}')],
    ['a version that is not a version', (d) => pack(d, 'a', '{"id":"a","name":"A","version":"one"}')],
    ['a rule id that is not namespaced', (d) => pack(d, 'a', '{"id":"a","name":"A","version":"1.0.0","rules":[{"id":"sand"}]}')],
    ['an unknown manifest field', (d) => pack(d, 'a', '{"id":"a","name":"A","version":"1.0.0","surprise":1}')],
    ['deeply nested garbage', (d) => pack(d, 'a', `{"id":"a","name":"A","version":"1.0.0","rules":${'['.repeat(200)}${']'.repeat(200)}}`)],
    [
      'a manifest that is a directory, not a file',
      async (d) => {
        await mkdir(path.join(d, 'a', 'pack.json'), { recursive: true });
      },
    ],
    [
      'a pack directory that is a dangling symlink',
      async (d) => {
        await pack(d, 'real', '{"id":"real","name":"Real","version":"1.0.0"}');
        try {
          await symlink(path.join(d, 'nowhere'), path.join(d, 'ghost'), 'dir');
        } catch {
          // Symlink creation needs privileges on Windows. The other cases still run.
        }
      },
    ],
    [
      'a pack whose rules belong to someone else',
      (d) => pack(d, 'a', '{"id":"a","name":"A","version":"1.0.0","rules":[{"id":"b:thing"}]}'),
    ],
    [
      'two packs claiming the same namespace',
      async (d) => {
        await pack(d, 'one', '{"id":"same","name":"One","version":"1.0.0"}');
        await pack(d, 'two', '{"id":"same","name":"Two","version":"1.0.0"}');
      },
    ],
    [
      'a dependency on a version nobody provides',
      async (d) => {
        await pack(d, 'base', '{"id":"base","name":"Base","version":"1.0.0"}');
        await pack(d, 'needy', '{"id":"needy","name":"Needy","version":"1.0.0","dependencies":{"base":"42.0.0"}}');
      },
    ],
  ];

  it.each(cases)('survives %s', async (_label, build) => {
    const packsDir = await fixture(build);

    // The assertion is not "it fails" - some of these could legitimately succeed. It is that a value
    // comes back at all, with a message worth showing, instead of an exception escaping.
    const result = await loadPacks({ packsDir });

    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
    if (!result.ok) {
      expect(result.error.code, 'every failure carries a code the shell can branch on').toBeTruthy();
      expect(result.error.message.length, 'and a message a player can act on').toBeGreaterThan(20);
    }
  });

  it('reports an unreadable manifest instead of pretending the pack is absent', async () => {
    const packsDir = await fixture(async (d) => {
      await mkdir(path.join(d, 'a', 'pack.json'), { recursive: true });
    });

    const result = await loadPacks({ packsDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Before, any read error meant "not a pack", so a manifest that existed and could not be read
    // made the mod silently vanish - and the player had nothing to go on.
    expect(result.error.code).toBe('unreadable-manifest');
    expect(result.error.message).toContain('pack.json');
  });

  it('turns an unanticipated failure into a Result rather than an exception', async () => {
    // A getter that throws stands in for whatever the next unguarded line will be. The structural
    // guard is the point: auditing every line is not a mechanism, and a doc comment promising
    // "never throws" is what convinces the next person they need not check.
    const hostile = { get packsDir(): string { throw new Error('exploding option'); } };

    const result = await loadPacks(hostile as unknown as { packsDir: string });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unexpected-error');
    expect(result.error.message).toContain('exploding option');
  });
});
