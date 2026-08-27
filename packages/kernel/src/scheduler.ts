import type { Result } from './result.js';
import { type TopoError, stableTopologicalSort } from './order.js';

/**
 * Phase ordering, and nothing else.
 *
 * There is no clock here, no accumulator and no loop: this session builds no game loop. What the
 * scheduler owns is the guarantee that, given the same set of phase declarations, every machine
 * computes the same order — including when two phases are unordered relative to each other.
 */
export interface PhaseSpec {
  readonly id: string;
  /** Phases that must have run before this one. */
  readonly after?: readonly string[];
}

export type ScheduleError = TopoError;

export function buildSchedule(phases: readonly PhaseSpec[]): Result<readonly string[], ScheduleError> {
  return stableTopologicalSort(
    phases.map((phase) => ({ id: phase.id, dependsOn: phase.after ?? [] })),
  );
}
