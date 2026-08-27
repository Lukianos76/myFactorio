/**
 * Runtime denial of ambient non-determinism (invariant 7).
 *
 * The lint ban was a list of names, and an invariant is never a list of names. `Math.random` was
 * forbidden and `crypto.getRandomValues` was not — which is precisely where you go when
 * `Math.random` is closed. `const M = Math; M.random()` walked past it. `globalThis.Math.random()`
 * walked past it. A syntactic rule describes one way of writing the violation, and there is always
 * another.
 *
 * Replacing the functions themselves has no such ceiling: every alias, every computed access and
 * every re-export resolves to the same function object, and that object now throws. The lint stays
 * as a fast local signal that fails in the editor instead of at run time; this is the mechanism.
 *
 * The table below reaches the globals by string key on purpose, which the lint cannot see. That is
 * the one place in the codebase where doing so is correct, and `determinism.invariant.test.ts`
 * freezes what this file may contain so it stays the only one.
 */

export class NonDeterminismError extends Error {
  constructor(source: string) {
    super(
      `${source} is not available inside the simulation. It would make two machines running the ` +
        'same save diverge. Randomness must come from a seeded PRNG carried in simulation state, ' +
        'and time from a tick count passed in as data.',
    );
    this.name = 'NonDeterminismError';
  }
}

type Holder = Record<string, unknown>;

function holder(value: unknown): Holder | null {
  return typeof value === 'object' || typeof value === 'function' ? (value as Holder) : null;
}

/** [what it is called in an error message, the object holding it, the property name]. */
function ambientSources(): readonly (readonly [string, Holder, string])[] {
  const found: (readonly [string, Holder, string])[] = [];
  const push = (label: string, target: unknown, key: string): void => {
    const owner = holder(target);
    if (owner !== null && typeof owner[key] === 'function') found.push([label, owner, key]);
  };

  push('Math.random', Math, 'random');
  push('Date.now', Date, 'now');
  push('performance.now', (globalThis as Holder)['performance'], 'now');
  push('crypto.getRandomValues', (globalThis as Holder)['crypto'], 'getRandomValues');
  push('crypto.randomUUID', (globalThis as Holder)['crypto'], 'randomUUID');
  return found;
}

/**
 * The constructor, not only the statics.
 *
 * Sealing `Date.now` left `const D = Date; new D().getTime()` reading the wall clock — a static
 * method replaced while the class that carries the same information was untouched. Sealing the
 * global binding covers every alias, because an alias is a reference to this binding.
 *
 * `timeOrigin` is here for the neighbouring reason: it is a property read, not a call, so replacing
 * functions never reached it.
 */
function sealConstructors(): readonly string[] {
  const sealed: string[] = [];

  const denyDate = function DeniedDate(): never {
    throw new NonDeterminismError('new Date()');
  };
  // Replacing the global binding drops the statics with it, and `Date.now()` then failed with
  // "Date.now is not a function" - refused, but saying nothing about why. The denial has to carry
  // the same surface as what it replaced, or it trades a clear diagnosis for a confusing one.
  for (const staticName of ['now', 'parse', 'UTC'] as const) {
    Object.defineProperty(denyDate, staticName, {
      value: (): never => {
        throw new NonDeterminismError(`Date.${staticName}`);
      },
      writable: false,
      configurable: false,
    });
  }

  try {
    Object.defineProperty(globalThis, 'Date', {
      value: denyDate,
      writable: false,
      configurable: false,
    });
    sealed.push('Date');
  } catch {
    /* already sealed */
  }

  const performance = holder((globalThis as Holder)['performance']);
  if (performance !== null && 'timeOrigin' in performance) {
    try {
      Object.defineProperty(performance, 'timeOrigin', {
        get: (): never => {
          throw new NonDeterminismError('performance.timeOrigin');
        },
        configurable: false,
      });
      sealed.push('performance.timeOrigin');
    } catch {
      /* already sealed, or not configurable in this host */
    }
  }

  return sealed;
}

/**
 * Call once, first thing, in any context that runs simulation code. Idempotent.
 *
 * Non-writable and non-configurable, so a mod cannot put the original back.
 */
export function sealAmbientSources(): readonly string[] {
  const sealed: string[] = [];

  for (const [label, owner, key] of ambientSources()) {
    const deny = (): never => {
      throw new NonDeterminismError(label);
    };
    try {
      Object.defineProperty(owner, key, { value: deny, writable: false, configurable: false });
      sealed.push(label);
    } catch {
      // Already sealed by an earlier call, or non-configurable in this host. Either way the
      // guarantee we wanted is the one already in place.
    }
  }

  return [...sealed, ...sealConstructors()];
}
