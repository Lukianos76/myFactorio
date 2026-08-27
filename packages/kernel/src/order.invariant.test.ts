import { describe, expect, it } from 'vitest';
import { compareCodeUnits, stableTopologicalSort } from './order.js';

/**
 * The tie-break gets its own test, at its own level, deliberately.
 *
 * Going through the loader could not isolate it: the loader sorts its input before building the
 * graph, so the topological sort never sees an unordered node list and removing its tie-break
 * changed nothing observable. Two mechanisms that each mask the other's absence are two mechanisms
 * with no test between them. Only calling this function directly, with genuinely unsorted input,
 * puts the tie-break under load.
 */
describe('invariant: topological order is a function of the graph, not of input order', () => {
  const NODES = [
    { id: 'zulu', dependsOn: ['anchor'] },
    { id: 'mike', dependsOn: ['anchor'] },
    { id: 'anchor', dependsOn: [] },
    { id: 'alpha', dependsOn: ['anchor'] },
  ];

  const shuffles: readonly (readonly number[])[] = [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
    [2, 0, 3, 1],
    [1, 3, 0, 2],
  ];

  it('yields the same order for every permutation of the same nodes', () => {
    const results = shuffles.map((order) => {
      const permuted = order.map((index) => NODES[index]!);
      const sorted = stableTopologicalSort(permuted);
      expect(sorted.ok).toBe(true);
      return sorted.ok ? sorted.value : [];
    });

    // anchor first because everything depends on it; the other three are mutually unordered, so
    // only the tie-break decides their relative positions.
    expect(results[0]).toEqual(['anchor', 'alpha', 'mike', 'zulu']);
    for (const result of results.slice(1)) {
      expect(result).toEqual(results[0]);
    }
  });

  it('breaks ties by id rather than by insertion order', () => {
    const reversed = stableTopologicalSort([
      { id: 'c', dependsOn: [] },
      { id: 'b', dependsOn: [] },
      { id: 'a', dependsOn: [] },
    ]);
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    expect(reversed.value).toEqual(['a', 'b', 'c']);
  });

  it('reports a cycle rather than picking an arbitrary order', () => {
    const result = stableTopologicalSort([
      { id: 'one', dependsOn: ['two'] },
      { id: 'two', dependsOn: ['one'] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('dependency-cycle');
    expect(result.error.involved).toEqual(['one', 'two']);
  });

  it('reports missing dependencies in a stable order', () => {
    const result = stableTopologicalSort([
      { id: 'z', dependsOn: ['ghost_b'] },
      { id: 'a', dependsOn: ['ghost_a'] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('missing-dependency');
    expect(result.error.involved).toEqual(['a -> ghost_a', 'z -> ghost_b']);
  });
});

describe('invariant: comparison never consults the machine locale', () => {
  it('orders on code units', () => {
    expect(compareCodeUnits('a', 'b')).toBe(-1);
    expect(compareCodeUnits('b', 'a')).toBe(1);
    expect(compareCodeUnits('a', 'a')).toBe(0);
  });

  it('differs from locale-aware comparison exactly where locales disagree', () => {
    // In a Swedish locale localeCompare orders "z" before "ä"; on code units it never does.
    // Asserting the code-unit answer is what pins behaviour to the same result on every machine.
    expect(compareCodeUnits('z', 'ä')).toBe(-1);
    expect(compareCodeUnits('Z', 'a')).toBe(-1);
  });
});
