/**
 * Produces a frozen save fixture with the shipped writer.
 *
 * Run deliberately, almost never:  pnpm exec vite-node tools/make-save-fixture.ts
 *
 * A frozen fixture is only worth anything if it was written by a build that shipped and is then
 * left alone. Regenerating it to make a failing test pass converts it into a test of the current
 * writer against itself, which is exactly the state that let `chunkTable` be renamed in the writer,
 * the reader and the migration at once without a single test noticing.
 *
 * If the format genuinely has to change, the answer is not to re-run this on v2. It is to raise
 * CURRENT_VERSION, add the migration step, and freeze a NEW fixture for the new version - leaving
 * the old one exactly where it is, because reading it is the thing being promised.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContentId, type ContentId } from '@myfactorio/kernel';
import { CURRENT_VERSION, writeSave } from '@myfactorio/save';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function id(raw: string): ContentId {
  const parsed = parseContentId(raw);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

// Deliberately not a trivial document: a modded id alongside base content proves the palette spans
// packs, and a non-empty packs[] exercises the field a one-pack save would leave empty.
const cells = Uint16Array.from([0, 1, 2, 0, 1, 1, 2, 2, 0, 0, 1, 2]);

const bytes = writeSave({
  version: CURRENT_VERSION,
  palette: [id('core:sand'), id('core:water'), id('my_mod:ore/iron')],
  chunks: [{ id: 'grid', byteOffset: 0, byteLength: cells.byteLength, elementSize: 2 }],
  packs: [
    { id: 'core', version: '0.1.0' },
    { id: 'my_mod', version: '2.3.4' },
  ],
  payload: new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength),
  migratedFrom: CURRENT_VERSION,
});

const out = path.join(repoRoot, `tests/fixtures/save/v${CURRENT_VERSION}.fsav`);
writeFileSync(out, bytes);

console.log(`wrote ${path.relative(repoRoot, out)} — ${bytes.byteLength} bytes`);
console.log('Freeze it. Do not regenerate it to make a test pass.');
