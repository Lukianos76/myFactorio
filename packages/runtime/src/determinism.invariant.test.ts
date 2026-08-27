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
    // the player's. readDirectory substitutes the READ, so every ordering below still travels
    // through the one sort site - the seam is under it, not over it.
    const orderings: readonly string[][] = [
      ['base', 'zulu', 'alpha'],
      ['alpha', 'zulu', 'base'],
      ['zulu', 'alpha', 'base'],
      ['alpha', 'base', 'zulu'],
    ];

    const runs = [];
    for (const entries of orderings) {
      const result = await loadPacks({ packsDir, readDirectory: async () => entries });
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

  /**
   * What the loader's pre-sort actually protects.
   *
   * The topological sort tie-breaks by id, so load order is already a pure function of the graph
   * even with an unsorted input. The pre-sort matters for what happens BEFORE the graph exists:
   * which of two conflicting packs is reported as the incumbent. Without it, two players with the
   * same broken mod set get different error messages, and a bug report becomes unreproducible.
   */
  it('names the lexicographically first pack as the incumbent of a conflict', async () => {
    const packsDir = await mkdtemp(path.join(tmpdir(), 'myfactorio-duplicate-'));
    dirs.push(packsDir);
    // Created in reverse, so creation order and lexicographic order disagree.
    for (const dirName of ['z_last', 'a_first']) {
      const dir = path.join(packsDir, dirName);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'pack.json'),
        JSON.stringify({ id: 'contested', name: dirName, version: '1.0.0', rules: [] }),
      );
    }

    const forward = await loadPacks({ packsDir, readDirectory: async () => ['a_first', 'z_last'] });
    const backward = await loadPacks({ packsDir, readDirectory: async () => ['z_last', 'a_first'] });
    const enumerated = await loadPacks({ packsDir });

    for (const result of [forward, backward, enumerated]) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('duplicate-namespace');

      /*
       * The WHICH, not just the stability.
       *
       * The previous version asserted only that the two messages were equal, which any
       * deterministic function of the input satisfies — including reversing the sort. That is how
       * the pre-sort came to be replaceable by `.sort(...).reverse()` with 29 runtime tests still
       * green, and it is ADR-0023 recurring inside the test written to fix a different mock
       * problem.
       *
       * The duplicate check runs BEFORE the topological sort, so the tie-break cannot reach this:
       * whichever pack the enumeration presents first becomes the incumbent, and only the pre-sort
       * decides that. Asserting the load order instead proves nothing, because the tie-break
       * guarantees it whatever arrives.
       */
      expect(result.error.message.indexOf('a_first')).toBeGreaterThanOrEqual(0);
      expect(result.error.message.indexOf('a_first')).toBeLessThan(
        result.error.message.indexOf('z_last'),
      );
    }
  });

  /**
   * The real filesystem, with no seam at all.
   *
   * Weaker than the tests above by construction: NTFS enumerates in order already, so this cannot
   * fail on the developer's machine whatever the sort does. It is kept because ext4 in CI hashes,
   * so it can bite there - but the guarantee comes from the seam sitting below the sort, not from
   * this. Stated so nobody reads a green tick here as evidence.
   */
  it('loads through the real filesystem with no seam', async () => {
    const packsDir = await mkdtemp(path.join(tmpdir(), 'myfactorio-readdir-'));
    dirs.push(packsDir);

    for (const id of ['zulu', 'mike', 'alpha']) {
      const dir = path.join(packsDir, id);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'pack.json'),
        JSON.stringify({ id, name: id, version: '1.0.0', rules: [{ id: `${id}:a`, constants: [] }] }),
      );
    }

    const result = await loadPacks({ packsDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.order).toEqual(['alpha', 'mike', 'zulu']);
    expect(result.value.registry.ids()).toEqual(['alpha:a', 'mike:a', 'zulu:a']);
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
