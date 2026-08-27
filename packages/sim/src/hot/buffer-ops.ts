/**
 * Hot path (invariant 5).
 *
 * Nothing in a function body here may allocate: no `new`, no object or array literal, no closure,
 * no template literal, no `.map`/`.filter`/`.slice`. Module-level constants are fine — they
 * allocate once at load. ESLint enforces this, and `noInlineConfig` is on for this directory, so
 * an inline suppression comment is inert here. If a rule in this directory ever becomes impossible
 * to satisfy, the calibration is wrong: fix it in eslint.config.js rather than working around it.
 *
 * These are buffer mechanics only. No element behaviour lives in this package yet.
 */

/** Returned by findFirst when nothing matches. Hoisted so the function body allocates nothing. */
export const NOT_FOUND = -1;

export function fillRegion(
  cells: Uint16Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
): void {
  for (let y = y0; y < y1; y += 1) {
    const rowStart = y * width;
    for (let x = x0; x < x1; x += 1) {
      cells[rowStart + x] = value;
    }
  }
}

export function copyRegion(
  source: Uint16Array,
  target: Uint16Array,
  width: number,
  y0: number,
  y1: number,
): void {
  for (let y = y0; y < y1; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      target[rowStart + x] = source[rowStart + x]!;
    }
  }
}

export function countValue(cells: Uint16Array, value: number): number {
  let total = 0;
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] === value) total += 1;
  }
  return total;
}

export function findFirst(cells: Uint16Array, value: number): number {
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] === value) return i;
  }
  return NOT_FOUND;
}
