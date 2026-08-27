/**
 * A Result carried by value rather than thrown.
 *
 * The loader in particular must never throw: the shell has to be able to open a window and show
 * a readable message instead of dying before it draws anything. Making that the shape of every
 * fallible call, rather than a convention, is what keeps it true.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
