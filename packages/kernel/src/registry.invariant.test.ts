import { describe, expect, it } from 'vitest';
import { parseContentId, contentIdNamespace, contentIdPath } from './id.js';
import { Registry } from './registry.js';

describe('invariant: every content id is namespaced', () => {
  const rejected: ReadonlyArray<readonly [input: string, code: string]> = [
    ['sand', 'missing-namespace'],
    ['Core:Sand', 'not-lowercase'],
    ['core:', 'empty-path'],
    [':sand', 'empty-namespace'],
    ['core:a:b', 'too-many-separators'],
    ['my mod:x', 'invalid-characters'],
    ['', 'missing-namespace'],
    ['core:sand!', 'invalid-characters'],
  ];

  it.each(rejected)('rejects %o with code %s', (input, code) => {
    const result = parseContentId(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    // The message has to be useful to a mod author staring at a manifest.
    expect(result.error.message).toContain(input === '' ? 'empty' : input);
  });

  const accepted = ['core:sand', 'my_mod:ore/iron', 'a1:b2', 'core:machines/inserter/fast'];

  it.each(accepted)('accepts %s', (input) => {
    const result = parseContentId(input);
    expect(result.ok).toBe(true);
  });

  it('exposes namespace and path', () => {
    const result = parseContentId('my_mod:ore/iron');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(contentIdNamespace(result.value)).toBe('my_mod');
    expect(contentIdPath(result.value)).toBe('ore/iron');
  });

  it('a raw string is not assignable to ContentId', () => {
    const result = parseContentId('core:sand');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // @ts-expect-error a bare string must never satisfy ContentId; only parseContentId mints one.
    const forged: typeof result.value = 'core:sand';
    expect(forged).toBe('core:sand');
  });
});

describe('invariant: the registry refuses unqualified ids', () => {
  it('refuses to register an unqualified id', () => {
    const registry = new Registry();
    const result = registry.register('sand');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('missing-namespace');
    expect(registry.size).toBe(0);
  });

  it('assigns handles to qualified ids and round-trips them', () => {
    const registry = new Registry();
    const sand = registry.register('core:sand');
    const water = registry.register('core:water');
    expect(sand.ok && water.ok).toBe(true);
    if (!sand.ok || !water.ok) return;

    expect(sand.value).not.toBe(water.value);
    expect(registry.idOf(sand.value)).toBe('core:sand');
    expect(registry.handleOf(registry.idOf(sand.value)!)).toBe(sand.value);
    expect(registry.size).toBe(2);
  });

  it('is idempotent: registering the same id twice yields the same handle', () => {
    const registry = new Registry();
    const first = registry.register('core:sand');
    const second = registry.register('core:sand');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toBe(second.value);
    expect(registry.size).toBe(1);
  });
});
