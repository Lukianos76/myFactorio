import { describe, expect, it } from 'vitest';
import { MAX_CONTENT_ID_LENGTH, parseContentId } from '@myfactorio/kernel';
import { CONTENT_ID_PATTERN, contentIdSchema } from '@myfactorio/rules-schema';

/**
 * The parser a mod hits at load time and the schema its editor validates against must agree.
 *
 * They did not. `kernel` owned `PATH_PATTERN` and `rules-schema` had a hand-written
 * `CONTENT_ID_PATTERN` saying the same thing in different characters, with nothing comparing them:
 * adding a hyphen to one made `parseContentId('core:a-b')` succeed while the published schema
 * rejected it, and `pnpm check` stayed green. Two definitions of one truth is a divergence waiting
 * for someone to edit either side.
 *
 * `rules-schema` now derives its pattern from `kernel`, so they cannot differ by construction. This
 * runs a corpus through both anyway - derivation is a claim about the code, and the corpus is a
 * claim about behaviour, including the length limit the regex does not express.
 */
const CORPUS: readonly (readonly [id: string, valid: boolean, why: string])[] = [
  ['core:sand', true, 'the ordinary case'],
  ['my_mod:ore/iron', true, 'nested path'],
  ['a:b', true, 'shortest legal id'],
  ['core:machines/inserter/fast', true, 'deep path'],
  ['mod_2:thing_3', true, 'digits and underscores after the first letter'],

  ['sand', false, 'no namespace'],
  ['Core:Sand', false, 'uppercase'],
  ['core:', false, 'empty path'],
  [':sand', false, 'empty namespace'],
  ['core:a:b', false, 'two separators'],
  ['my mod:x', false, 'space in the namespace'],
  ['core:a-b', false, 'hyphen - the exact character the two definitions disagreed about'],

  // Degenerate paths. All of these parsed before the grammar was tightened, and every one of them
  // is a trap once ids become hierarchical.
  ['core:/', false, 'path is a bare slash'],
  ['core://a', false, 'doubled slash'],
  ['core:a/', false, 'trailing slash'],
  ['core:/a', false, 'leading slash'],
  ['0:0', false, 'namespace starting with a digit'],
  ['_x:y', false, 'namespace starting with an underscore'],
];

describe('invariant: one grammar, two consumers, same verdict', () => {
  it.each(CORPUS)('%s -> %s (%s)', (id, valid) => {
    const parsed = parseContentId(id);
    const schema = contentIdSchema.safeParse(id);

    expect(parsed.ok, `parseContentId disagreed on ${id}`).toBe(valid);
    expect(schema.success, `the published schema disagreed on ${id}`).toBe(valid);
  });

  it('the published pattern is the one the parser uses', () => {
    const pattern = new RegExp(CONTENT_ID_PATTERN);
    for (const [id, valid] of CORPUS) {
      // Not for ids rejected on length: a regex cannot express that, which is exactly why the
      // corpus tests behaviour and not just the string.
      if (id.length > MAX_CONTENT_ID_LENGTH) continue;
      expect(pattern.test(id), `${CONTENT_ID_PATTERN} disagreed on ${id}`).toBe(valid);
    }
  });

  it('refuses an id long enough to stop being a key', () => {
    const long = `core:${'a'.repeat(MAX_CONTENT_ID_LENGTH)}`;
    const parsed = parseContentId(long);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('too-long');
    expect(contentIdSchema.safeParse(long).success).toBe(false);
  });
});
