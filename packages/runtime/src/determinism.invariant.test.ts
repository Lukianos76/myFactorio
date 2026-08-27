import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPacks } from './index.js';

/**
 * Three packs with a diamond dependency, so the topological sort has genuine ties to break.
 * `zulu` and `alpha` both depend on `base` and neither depends on the other: without a stable
 * tie-break their relative order is whatever the traversal happened to produce.
 */
const PACKS = {
  base: { id: 'base', name: 'Base', version: '1.0.0', rules: ruleIds('base', ['a', 'b']) },
  zulu: {
    id: 'zulu',
    name: 'Zulu',
    version: '1.0.0',
    dependencies: { base: '1.0.0' },
    rules: ruleIds('zulu', ['a']),
  },
  alpha: {
    id: 'alpha',
    name: 'Alpha',
    version: '1.0.0',
    dependencies: { base: '1.0.0' },
    rules: ruleIds('alpha', ['a', 'b', 'c']),
  },
} as const;

function ruleIds(namespace: string, names: readonly string[]) {
  return names.map((name) => ({ id: `${namespace}:${name}`, constants: [1, 2, 3] }));
}

const dirs: string[] = [];

async function buildPacksDir(): Promise<string> {
  const packsDir = await mkdtemp(path.join(tmpdir(), 'myfactorio-determinism-'));
  dirs.push(packsDir);
  for (const [dirName, manifest] of Object.entries(PACKS)) {
    const dir = path.join(packsDir, dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'pack.json'), JSON.stringify(manifest, null, 2));
  }
  return packsDir;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('invariant: loading is deterministic regardless of directory enumeration order', () => {
  it('produces identical load order and identical handles for shuffled input', async () => {
    const packsDir = await buildPacksDir();

    // readdir order depends on the filesystem, so it differs between the developer's machine and
    // the player's. The `entries` option lets us stand in for that variation explicitly.
    const orderings: readonly string[][] = [
      ['base', 'zulu', 'alpha'],
      ['alpha', 'zulu', 'base'],
      ['zulu', 'alpha', 'base'],
      ['alpha', 'base', 'zulu'],
    ];

    const runs = [];
    for (const entries of orderings) {
      const result = await loadPacks({ packsDir, entries });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      runs.push({
        order: result.value.order,
        ids: result.value.registry.ids(),
        handles: result.value.registry.ids().map((id) => result.value.registry.handleOf(id)),
      });
    }

    const reference = runs[0]!;
    // `alpha` sorts before `zulu`, and both come after their shared dependency.
    expect(reference.order).toEqual(['base', 'alpha', 'zulu']);

    for (const run of runs.slice(1)) {
      expect(run.order).toEqual(reference.order);
      expect(run.ids).toEqual(reference.ids);
      expect(run.handles).toEqual(reference.handles);
    }
  });

  it('detects a dependency cycle instead of resolving it arbitrarily', async () => {
    const packsDir = await mkdtemp(path.join(tmpdir(), 'myfactorio-cycle-'));
    dirs.push(packsDir);
    for (const [id, dep] of [['one', 'two'], ['two', 'one']]) {
      const dir = path.join(packsDir, id!);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'pack.json'),
        JSON.stringify({ id, name: id, version: '1.0.0', dependencies: { [dep!]: '1.0.0' }, rules: [] }),
      );
    }

    const result = await loadPacks({ packsDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('dependency-cycle');
    expect(result.error.message).toContain('one');
    expect(result.error.message).toContain('two');
  });

  it('reports a missing dependency by name', async () => {
    const packsDir = await mkdtemp(path.join(tmpdir(), 'myfactorio-missing-'));
    dirs.push(packsDir);
    const dir = path.join(packsDir, 'lonely');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'pack.json'),
      JSON.stringify({ id: 'lonely', name: 'Lonely', version: '1.0.0', dependencies: { ghost: '1.0.0' }, rules: [] }),
    );

    const result = await loadPacks({ packsDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('missing-dependency');
    expect(result.error.message).toContain('ghost');
  });
});
