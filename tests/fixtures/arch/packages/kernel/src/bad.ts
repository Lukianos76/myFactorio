/**
 * FIXTURE — deliberately broken. Excluded from tsconfig, ESLint and the main cruise.
 *
 * kernel sits at rank 0 and sim at rank 4, so this import runs upward against the dependency
 * flow. The path here mirrors the real layout (packages/kernel/src/...) so that it matches the
 * same generated `no-import-below:kernel` rule that guards the real tree.
 *
 * The import is relative rather than by package name for a boring reason: this directory is not a
 * workspace package, so it has no node_modules and `@myfactorio/sim` would simply fail to resolve
 * — and an unresolved import triggers no layer rule at all, which would make the fixture prove
 * nothing. Reaching across by path is also the more honest reproduction of how someone actually
 * breaks this rule.
 *
 * tests/arch.invariant.test.ts asserts that dependency-cruiser rejects this file. If it ever stops
 * being rejected, the guardrail is broken, not the fixture.
 */
import { WORLD_STRIDE } from '../../../../../../packages/sim/src/index.js';

export const leaked: number = WORLD_STRIDE;
