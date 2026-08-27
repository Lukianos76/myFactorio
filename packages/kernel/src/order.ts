import { type Result, ok, err } from './result.js';

/**
 * Deterministic ordering primitives.
 *
 * These live in kernel rather than in runtime because the scheduler and the pack loader both need
 * them, and vocabulary shared by two consumers belongs to neither of them.
 */

/**
 * Compare on UTF-16 code units. Never String.prototype.localeCompare: its result depends on the
 * machine's locale, so the same content would order differently for a player in tr-TR or sv-SE
 * than it does here. That reorders handle assignment, which reorders buffer contents. If a
 * linguistic ordering is ever genuinely needed, use an Intl.Collator pinned to a fixed locale.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export interface TopoNode {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

export type TopoErrorCode = 'missing-dependency' | 'dependency-cycle' | 'duplicate-node';

export interface TopoError {
  readonly code: TopoErrorCode;
  readonly message: string;
  readonly involved: readonly string[];
}

/**
 * Kahn's algorithm with the ready set kept sorted by id.
 *
 * The sort is the whole point. Plain Kahn pops whatever entered the queue first, so ties are
 * broken by insertion order, which comes from directory enumeration order, which differs between
 * machines. Sorting the ready set at every step makes the output a function of the graph alone.
 */
export function stableTopologicalSort(nodes: readonly TopoNode[]): Result<readonly string[], TopoError> {
  const byId = new Map<string, TopoNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      return err({
        code: 'duplicate-node',
        message: `Duplicate entry ${node.id}.`,
        involved: [node.id],
      });
    }
    byId.set(node.id, node);
  }

  const missing: string[] = [];
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) missing.push(`${node.id} -> ${dependency}`);
    }
  }
  if (missing.length > 0) {
    missing.sort(compareCodeUnits);
    return err({
      code: 'missing-dependency',
      message: `Unresolved dependencies: ${missing.join(', ')}.`,
      involved: missing,
    });
  }

  const remaining = new Map<string, Set<string>>();
  for (const node of nodes) remaining.set(node.id, new Set(node.dependsOn));

  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const [id, dependencies] of remaining) {
      if (dependencies.size === 0) ready.push(id);
    }

    if (ready.length === 0) {
      const involved = [...remaining.keys()].sort(compareCodeUnits);
      return err({
        code: 'dependency-cycle',
        message: `Dependency cycle between: ${involved.join(', ')}.`,
        involved,
      });
    }

    ready.sort(compareCodeUnits);
    for (const id of ready) {
      ordered.push(id);
      remaining.delete(id);
    }
    for (const dependencies of remaining.values()) {
      for (const id of ready) dependencies.delete(id);
    }
  }

  return ok(ordered);
}
