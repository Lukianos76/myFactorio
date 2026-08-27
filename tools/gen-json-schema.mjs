/**
 * Emits the JSON Schema that ships to mod authors, from the Zod declarations that are the source
 * of truth (ADR-0003).
 *
 * `--verify` regenerates in memory and fails if the committed file differs. That check is the
 * whole reason a generated artefact is safe to commit: the published contract cannot quietly drift
 * away from what the loader actually enforces.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// z comes from rules-schema rather than from zod directly: one Zod instance, and no way for this
// tool to validate against a different version than the loader does.
import { z, packManifestSchema, ruleSchema } from '@myfactorio/rules-schema';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'packages/rules-schema/schema');

const TARGETS = [
  { file: 'pack-manifest.schema.json', schema: packManifestSchema, id: 'https://myfactorio.dev/schema/pack-manifest.json' },
  { file: 'rule.schema.json', schema: ruleSchema, id: 'https://myfactorio.dev/schema/rule.json' },
];

function render(target) {
  // `io: 'input'` describes what an author writes, which is what editor tooling needs: fields with
  // defaults are optional on the way in even though they always exist on the way out.
  const schema = z.toJSONSchema(target.schema, { io: 'input' });
  return `${JSON.stringify({ $id: target.id, ...schema }, null, 2)}\n`;
}

const verify = process.argv.includes('--verify');
let failed = false;

await mkdir(outDir, { recursive: true });

for (const target of TARGETS) {
  const filePath = path.join(outDir, target.file);
  const expected = render(target);

  if (!verify) {
    await writeFile(filePath, expected, 'utf8');
    console.log(`wrote ${path.relative(repoRoot, filePath)}`);
    continue;
  }

  let actual;
  try {
    actual = await readFile(filePath, 'utf8');
  } catch {
    console.error(`missing ${path.relative(repoRoot, filePath)} — run: pnpm gen`);
    failed = true;
    continue;
  }

  if (actual !== expected) {
    console.error(
      `${path.relative(repoRoot, filePath)} is out of date with the Zod declarations. Run: pnpm gen`,
    );
    failed = true;
  }
}

if (verify && !failed) console.log(`generated schemas are up to date (${TARGETS.length} files)`);
if (failed) process.exitCode = 1;
