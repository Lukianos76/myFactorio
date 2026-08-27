export type EventHandler<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/**
 * A typed event bus for orchestration outside the simulation.
 *
 * Handlers run in subscription order, and subscription order is deterministic because the loader
 * is. Note that this is host-side plumbing: nothing here crosses the worker boundary, and no
 * simulation API takes a handler — see invariants 3 and 4.
 */
export class EventBus<Events extends Record<string, unknown>> {
  readonly #handlers = new Map<keyof Events, Set<EventHandler<never>>>();

  on<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): Unsubscribe {
    let handlers = this.#handlers.get(type);
    if (handlers === undefined) {
      handlers = new Set();
      this.#handlers.set(type, handlers);
    }
    handlers.add(handler as EventHandler<never>);
    return () => {
      handlers.delete(handler as EventHandler<never>);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const handlers = this.#handlers.get(type);
    if (handlers === undefined) return;
    for (const handler of [...handlers]) {
      (handler as EventHandler<Events[K]>)(payload);
    }
  }

  listenerCount(type: keyof Events): number {
    return this.#handlers.get(type)?.size ?? 0;
  }
}
