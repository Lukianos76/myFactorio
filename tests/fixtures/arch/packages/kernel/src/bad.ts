/**
 * FIXTURE — deliberately broken. Excluded from tsconfig, ESLint and the main cruise.
 *
 * kernel sits at rank 0 and sim at rank 4, so this import runs upward against the dependency
 * flow. The path here mirrors the real layout (packages/kernel/src/...) so that it matches the
 * same generated `no-import-below:kernel` rule that guards the real tree.
 *
 * tests/arch.invariant.test.ts asserts that dependency-cruiser rejects this file. If it ever
 * stops being rejected, the guardrail is broken, not the fixture.
 */
import { WORLD_STRIDE } from '@myfactorio/sim';

export const leaked: number = WORLD_STRIDE;
