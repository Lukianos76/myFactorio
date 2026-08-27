import { type Result, ok } from './result.js';
import { type ContentId, type IdError, parseContentId } from './id.js';

/**
 * A runtime handle. Process-local and load-order dependent, which is exactly why it must never
 * reach disk or cross a version boundary. Saves carry qualified names; see ADR-0008.
 */
export type Handle = number;

export class Registry {
  readonly #byId = new Map<ContentId, Handle>();
  readonly #byHandle: ContentId[] = [];

  /** Registering the same id twice is idempotent: content declared by two packs is one thing. */
  register(raw: string): Result<Handle, IdError> {
    const parsed = parseContentId(raw);
    if (!parsed.ok) return parsed;

    const existing = this.#byId.get(parsed.value);
    if (existing !== undefined) return ok(existing);

    const handle: Handle = this.#byHandle.length;
    this.#byHandle.push(parsed.value);
    this.#byId.set(parsed.value, handle);
    return ok(handle);
  }

  handleOf(id: ContentId): Handle | undefined {
    return this.#byId.get(id);
  }

  idOf(handle: Handle): ContentId | undefined {
    return this.#byHandle[handle];
  }

  has(id: ContentId): boolean {
    return this.#byId.has(id);
  }

  /** In handle order, which is registration order, which the loader makes deterministic. */
  ids(): readonly ContentId[] {
    return [...this.#byHandle];
  }

  get size(): number {
    return this.#byHandle.length;
  }
}
