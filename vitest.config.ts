import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'tests/fixtures/**'],
    environment: 'node',
    // --expose-gc for the hot-path allocation measurement. Invariant 5's lint can only see the
    // syntax in one directory; moving the allocation into a helper one directory up defeats it
    // entirely, because "hot" is a path and not a property of the code. Measuring the heap follows
    // the call. See ADR-0036.
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--expose-gc'] } },
  },
});
