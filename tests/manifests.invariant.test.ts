import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The declared dependency graph and the applied one must be the same graph.
 *
 * `runtime` declared `@myfactorio/isa` and `@myfactorio/save` and imported neither. Nothing noticed,
 * because dependency-cruiser checks the edges that exist and has no opinion about edges that were
 * announced and never drawn. A declaration nobody uses is a claim about the architecture that the
 * architecture does not make - and the direction that matters is the one where a package quietly
 * grants itself reach it does not need.
 */
function sourceFilesOf(pkg: string): string[] {
  return globSync(`packages/${pkg}/src/**/*.ts`, { cwd: repoRoot }).map((file) =>
    readFileSync(path.join(repoRoot, file), 'utf8'),
  );
}

const PACKAGES = readFileSync(path.join(repoRoot, '.dependency-cruiser.cjs'), 'utf8')
  .split('const LAYERS = [')[1]!
  .split(']')[0]!
  .split(',')
  .map((entry) => entry.trim().replace(/^'|'$/g, ''))
  .filter(Boolean);

describe('invariant: every declared workspace dependency is actually imported', () => {
  it('found the package list', () => {
    expect(PACKAGES.length).toBe(8);
  });

  it.each(PACKAGES)('%s declares nothing it does not use', (pkg) => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages', pkg, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    const declared = Object.keys(manifest.dependencies ?? {}).filter((name) =>
      name.startsWith('@myfactorio/'),
    );
    const sources = sourceFilesOf(pkg).join('\n');

    const unused = declared.filter((name) => !sources.includes(name));
    expect(unused, `${pkg}/package.json declares ${unused.join(', ')} but never imports it`).toEqual([]);
  });
});
