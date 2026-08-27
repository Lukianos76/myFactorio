import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, MIGRATIONS, OLDEST_READABLE_VERSION, migrateToCurrent } from './index.js';

describe('invariant: the migration chain has no gaps', () => {
  /**
   * The failure this guards against is raising CURRENT_VERSION and forgetting the migration.
   * Without this test the mistake surfaces later, on a player's save, as a load failure.
   */
  it('has a migration for every version step below the current one', () => {
    const steps: number[] = [];
    for (let version = OLDEST_READABLE_VERSION; version < CURRENT_VERSION; version += 1) {
      steps.push(version);
    }

    const missing = steps.filter((version) => MIGRATIONS[version] === undefined);
    expect(missing).toEqual([]);
    expect(Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b)).toEqual(steps);
  });

  it('each migration advances the version by exactly one', () => {
    for (const [from, migration] of Object.entries(MIGRATIONS)) {
      const result = migration({ version: Number(from), header: {}, payload: new Uint8Array() });
      expect(result.version, `migration from ${from}`).toBe(Number(from) + 1);
    }
  });

  it('a version we cannot reach reports which step is missing, rather than loading garbage', () => {
    const result = migrateToCurrent({
      version: CURRENT_VERSION + 1,
      header: {},
      payload: new Uint8Array(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-version');
  });
});
