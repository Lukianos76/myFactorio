import { CTRL_BYTES } from './boundary.js';

/**
 * World storage: a control block followed by a flat cell grid, both inside one SharedArrayBuffer.
 *
 * DataOnly is applied to every public parameter (invariant 4). A mod contributes numbers; it can
 * never hand the simulation a callback to run.
 */

/** Bytes per cell. One Uint16 palette index for now. */
export const WORLD_STRIDE = Uint16Array.BYTES_PER_ELEMENT;

type BinaryPayload = SharedArrayBuffer | ArrayBuffer | ArrayBufferView;

/**
 * Strips anything callable from a public parameter type. A function-typed field resolves to
 * never, so a caller supplying one has nothing they can pass.
 */
export type DataOnly<T> = T extends BinaryPayload
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer E)[]
      ? readonly DataOnly<E>[]
      : T extends object
        ? { readonly [K in keyof T]: DataOnly<T[K]> }
        : T;

export interface WorldSpec {
  readonly width: number;
  readonly height: number;
}

export interface World {
  readonly width: number;
  readonly height: number;
  readonly control: Int32Array;
  readonly cells: Uint16Array;
}

export function worldByteLength(spec: DataOnly<WorldSpec>): number {
  return CTRL_BYTES + spec.width * spec.height * WORLD_STRIDE;
}

/** Views onto an existing shared buffer. Allocates no storage: the buffer is the storage. */
export function viewWorld(buffer: SharedArrayBuffer, spec: DataOnly<WorldSpec>): World {
  return {
    width: spec.width,
    height: spec.height,
    control: new Int32Array(buffer, 0, CTRL_BYTES / Int32Array.BYTES_PER_ELEMENT),
    cells: new Uint16Array(buffer, CTRL_BYTES, spec.width * spec.height),
  };
}
