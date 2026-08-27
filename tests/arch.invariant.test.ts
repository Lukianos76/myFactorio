import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cruise,
  type ICruiseOptions,
  type ICruiseResult,
  type IForbiddenRuleType,
} from 'dependency-cruiser';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface DepcruiseConfig {
  forbidden: IForbiddenRuleType[];
  options: Partial<ICruiseOptions>;
}
const config = require(path.join(repoRoot, '.dependency-cruiser.cjs')) as DepcruiseConfig;

async function cruiseWith(targets: string[], overrides: Partial<ICruiseOptions>) {
  const result = await cruise(targets, {
    ...config.options,
    // Without this the API builds the graph and never evaluates the rules, so every assertion
    // about violations passes vacuously. The CLI sets it for you; the API does not.
    validate: true,
    ruleSet: { forbidden: config.forbidden },
    outputType: 'json',
    ...overrides,
  } as ICruiseOptions);
  const output = (result as { output: string | ICruiseResult }).output;
  return (typeof output === 'string' ? JSON.parse(output) : output) as ICruiseResult;
}

describe('invariant: dependencies flow strictly downward', () => {
  it('rejects an upward import (kernel reaching into sim)', async () => {
    const report = await cruiseWith(['tests/fixtures/arch'], {
      // The main config excludes tests/fixtures precisely so the broken fixture does not poison
      // the real run. Here we deliberately look at it.
      exclude: { path: '(^|/)node_modules/' },
    });

    expect(report.summary.error).toBeGreaterThan(0);

    const names = report.summary.violations.map((violation) => violation.rule.name);
    expect(names).toContain('no-import-below:kernel');

    const violation = report.summary.violations.find((v) => v.rule.name === 'no-import-below:kernel');
    expect(violation?.from).toMatch(/packages[\\/]kernel[\\/]src[\\/]bad\.ts$/);
    expect(violation?.to).toMatch(/packages[\\/]sim[\\/]/);
  });

  it('finds no violation in the real source tree', async () => {
    const report = await cruiseWith(['packages', 'apps', 'packs', 'tools'], {});

    const detail = report.summary.violations
      .map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`)
      .join('\n');
    expect(detail).toBe('');
    expect(report.summary.error).toBe(0);
  });

  it('generates one layer rule per package, so the ordering cannot drift', () => {
    const layerRules = config.forbidden
      .map((rule) => rule.name ?? '')
      .filter((name) => name.startsWith('no-import-below:'));

    // 8 packages, the lowest one has nothing below it, so 7 rules.
    expect(layerRules).toEqual([
      'no-import-below:kernel',
      'no-import-below:rules-schema',
      'no-import-below:isa',
      'no-import-below:rules-compiler',
      'no-import-below:sim',
      'no-import-below:save',
      'no-import-below:runtime',
    ]);
  });
});
