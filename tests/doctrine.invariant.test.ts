import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRegularForbiddenRuleType } from 'dependency-cruiser';

/**
 * Every import prohibition a package writes down must be enforced by a rule.
 *
 * This exists because of a failure of reasoning, not a typo. ADR-0020 diagnosed the general shape —
 * the layer ranks permit an edge that the doctrine forbids, so the generated rules never look at it
 * — and then closed exactly one instance of it. Two more were sitting in the CLAUDE.md files the
 * whole time: `save` must never import `sim`, `modding-api` must never re-export `isa` or `save`.
 * Both are upward edges. Neither had a rule.
 *
 * The prose was already machine-readable, which is the useful part: a prohibition that names its
 * rule in parentheses had one, and a prohibition that named no rule had none. So the fix is not to
 * add three rules, it is to make the CLAUDE.md files an executable specification. Write
 * "Must never import X" without a rule behind it and this test goes red.
 *
 * It checks the rule PREDICATE, not the rule name: a rule called `save-no-sim` that matched nothing
 * would pass a name check and refuse nothing.
 */

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface DepcruiseConfig {
  // The narrow member of the union: every rule in this project restricts by path. Using the full
  // IForbiddenRuleType would hide `to` behind members we do not use, and casting past that would
  // defeat the point of reading the real config.
  forbidden: IRegularForbiddenRuleType[];
}
const config = require(path.join(repoRoot, '.dependency-cruiser.cjs')) as DepcruiseConfig;

const PACKAGES = [
  'kernel',
  'rules-schema',
  'isa',
  'rules-compiler',
  'sim',
  'save',
  'runtime',
  'modding-api',
] as const;

interface Prohibition {
  readonly from: string;
  readonly to: string;
  /** The CLAUDE.md line it came from, so a failure says where to look. */
  readonly source: string;
}

/** Bullet items under `## Must never`, rejoined across their wrapped continuation lines. */
function mustNeverItems(claudeMd: string): string[] {
  const section = claudeMd.split('## Must never')[1] ?? '';
  const body = section.split(/^## /m)[0] ?? '';

  const items: string[] = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) items.push(line.slice(2).trim());
    else if (line.startsWith('  ') && items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

/**
 * Only the first sentence states the prohibition; the rest is rationale, and the rationale names
 * other packages. Taking every backtick in the item made `sim`'s entry claim it must not import
 * itself, which is the sort of nonsense that gets a test quietly weakened rather than fixed.
 */
function claim(item: string): string {
  const [first = item] = item.split(/\.\s|\.$/);
  return first;
}

function backtickedPackages(item: string): string[] {
  const tokens = [...claim(item).matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
  return tokens.filter((token): token is (typeof PACKAGES)[number] =>
    (PACKAGES as readonly string[]).includes(token),
  );
}

function collectProhibitions(): Prohibition[] {
  const found: Prohibition[] = [];

  for (const owner of PACKAGES) {
    const file = path.join(repoRoot, 'packages', owner, 'CLAUDE.md');
    for (const item of mustNeverItems(readFileSync(file, 'utf8'))) {
      const targets = backtickedPackages(item);
      const excerpt = `${owner}/CLAUDE.md: ${item.slice(0, 70)}`;

      if (/^Import anything\b/.test(item)) {
        // "Import anything" means every other package, and the rank rules already say so.
        for (const target of PACKAGES) {
          if (target !== owner) found.push({ from: owner, to: target, source: excerpt });
        }
        continue;
      }
      if (/^(Import|Re-export)\b/.test(item)) {
        for (const target of targets) found.push({ from: owner, to: target, source: excerpt });
        continue;
      }
      if (/^Be imported by\b/.test(item)) {
        // Stated from the other end: "Be imported by `sim`" is a prohibition on sim.
        for (const target of targets) found.push({ from: target, to: owner, source: excerpt });
      }
    }
  }
  return found;
}

/**
 * Does any forbidden rule actually match this edge? Evaluates the same path predicates
 * dependency-cruiser evaluates, rather than trusting a rule name to mean what it says.
 */
function ruleRefusing(from: string, to: string): string | undefined {
  const fromFile = `packages/${from}/src/index.ts`;
  const toFile = `packages/${to}/src/index.ts`;

  const match = config.forbidden.find((rule) => {
    const fromPath = rule.from?.path;
    const toPath = rule.to?.path;
    const toPathNot = rule.to?.pathNot;
    if (typeof fromPath !== 'string' || typeof toPath !== 'string') return false;
    if (!new RegExp(fromPath).test(fromFile)) return false;
    if (!new RegExp(toPath).test(toFile)) return false;
    if (typeof toPathNot === 'string' && new RegExp(toPathNot).test(toFile)) return false;
    return true;
  });
  return match?.name;
}

describe('invariant: every written prohibition has a rule behind it', () => {
  const prohibitions = collectProhibitions();

  it('finds the prohibitions in the first place', () => {
    // Without this, a parser regression turns the whole suite green by finding nothing to check —
    // which is the exact failure mode this file exists to prevent, one level up.
    const stated = prohibitions.filter((p) => !p.source.startsWith('kernel/'));
    expect(stated.length).toBeGreaterThanOrEqual(4);

    const pairs = [...new Set(stated.map((p) => `${p.from} -> ${p.to}`))].sort();
    expect(pairs).toEqual([
      'modding-api -> isa',
      'modding-api -> save',
      'save -> isa',
      'save -> sim',
      'sim -> rules-compiler',
    ]);
  });

  it.each(collectProhibitions().map((p) => [`${p.from} -> ${p.to}`, p] as const))(
    '%s is refused by a rule',
    (_label, prohibition) => {
      const rule = ruleRefusing(prohibition.from, prohibition.to);
      expect(
        rule,
        `${prohibition.source}\n  states this prohibition, but no dependency-cruiser rule matches ` +
          `packages/${prohibition.from}/src -> packages/${prohibition.to}/src.`,
      ).toBeDefined();
    },
  );

  it('names its rule in the prose, so a reader can find it', () => {
    const unnamed: string[] = [];

    for (const owner of PACKAGES) {
      const file = path.join(repoRoot, 'packages', owner, 'CLAUDE.md');
      for (const item of mustNeverItems(readFileSync(file, 'utf8'))) {
        if (!/^(Import|Re-export)\b/.test(item)) continue;
        if (/^Import anything\b/.test(item)) continue;
        if (backtickedPackages(item).length === 0) continue;

        const names = [...claim(item).matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
        const citesARule = names.some((name) => config.forbidden.some((rule) => rule.name === name));
        if (!citesARule) unnamed.push(`${owner}: ${item.slice(0, 60)}`);
      }
    }

    // The convention is what made the gap visible: prohibitions citing a rule had one, prohibitions
    // citing none had none. Keeping the convention keeps the next gap visible too.
    expect(unnamed).toEqual([]);
  });
});
