import { type Result, ok, err } from '@myfactorio/kernel';
import {
  type RawContainer,
  type SaveError,
  CURRENT_VERSION,
  OLDEST_READABLE_VERSION,
} from './container.js';

/**
 * The migration chain.
 *
 * One entry per version step, applied in sequence from whatever is on disk up to CURRENT_VERSION.
 * A migration works on the decoded container, never on bytes, so a header change stays a header
 * change. chain.invariant.test.ts fails if CURRENT_VERSION moves without a matching entry.
 */
export type Migration = (container: RawContainer) => RawContainer;

/**
 * v1 -> v2.
 *
 * v1 stored a flat `palette: string[]` and described the grid with loose `width`/`height` fields.
 * v2 wraps the palette so it can grow companions later, replaces the implicit grid with an
 * explicit chunk table, and records which packs produced the save.
 */
const v1ToV2: Migration = (container) => {
  const width = typeof container.header['width'] === 'number' ? container.header['width'] : 0;
  const height = typeof container.header['height'] === 'number' ? container.header['height'] : 0;
  const elementSize = 2;

  return {
    version: 2,
    header: {
      palette: { ids: container.header['palette'] ?? [] },
      chunkTable: [
        {
          id: 'grid',
          byteOffset: 0,
          byteLength: width * height * elementSize,
          elementSize,
        },
      ],
      packs: [],
    },
    payload: container.payload,
  };
};

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: v1ToV2,
};

export function migrateToCurrent(container: RawContainer): Result<RawContainer, SaveError> {
  if (container.version > CURRENT_VERSION) {
    return err({
      code: 'unknown-version',
      message:
        `This save is version ${container.version} and this build reads up to ${CURRENT_VERSION}. ` +
        'It was most likely written by a newer version of the game.',
    });
  }
  if (container.version < OLDEST_READABLE_VERSION) {
    return err({
      code: 'unknown-version',
      message: `Save version ${container.version} predates ${OLDEST_READABLE_VERSION} and can no longer be read.`,
    });
  }

  let current = container;
  while (current.version < CURRENT_VERSION) {
    const migration = MIGRATIONS[current.version];
    if (migration === undefined) {
      return err({
        code: 'unknown-version',
        message:
          `No migration from save version ${current.version} to ${current.version + 1}. ` +
          'CURRENT_VERSION was raised without adding the matching step to MIGRATIONS.',
      });
    }
    current = migration(current);
  }

  return ok(current);
}
