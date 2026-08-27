import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES = [
  'kernel',
  'rules-schema',
  'isa',
  'rules-compiler',
  'sim',
  'save',
  'runtime',
  'modding-api',
];

describe('invariant: the root CLAUDE.md does not dilute', () => {
  it('stays at or under 50 lines', () => {
    const lines = readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8').split('\n');
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    // Mechanical rather than disciplinary, like everything else here. The pressure to add "just
    // one line" is constant and ends in a three-hundred-line file nobody reads. Detail belongs
    // in the per-package CLAUDE.md.
    expect(lines.length).toBeLessThanOrEqual(50);
  });

  it('every package documents what it owns and what it must never do', () => {
    for (const name of PACKAGES) {
      const file = path.join(repoRoot, 'packages', name, 'CLAUDE.md');
      const content = readFileSync(file, 'utf8');
      expect(content, `${name}/CLAUDE.md`).toContain('## Owns');
      expect(content, `${name}/CLAUDE.md`).toContain('## Must never');
    }
  });
});

describe('invariant: no sim API accepts a function', () => {
  /**
   * Type-level DataOnly<T> already makes a function-typed parameter unrepresentable in the public
   * surface. This walks the declaration file the compiler produces for that surface and checks it
   * independently, because a future `any` or an unconstrained generic would slip past the type
   * alias without anyone noticing.
   */
  it('no exported signature takes a callable parameter', () => {
    const entry = path.join(repoRoot, 'packages/sim/src/index.ts');
    const program = ts.createProgram([entry], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(entry);
    expect(source).toBeDefined();
    if (!source) return;

    const moduleSymbol = checker.getSymbolAtLocation(source);
    expect(moduleSymbol).toBeDefined();
    if (!moduleSymbol) return;

    const offenders: string[] = [];

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const declared = checker.getTypeOfSymbolAtLocation(exported, source);
      for (const signature of declared.getCallSignatures()) {
        for (const parameter of signature.getParameters()) {
          const paramType = checker.getTypeOfSymbolAtLocation(parameter, source);
          if (typeTakesCallable(checker, paramType, new Set())) {
            offenders.push(`${exported.getName()}(${parameter.getName()})`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

function typeTakesCallable(checker: ts.TypeChecker, type: ts.Type, seen: Set<ts.Type>): boolean {
  if (seen.has(type)) return false;
  seen.add(type);

  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return true;

  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => typeTakesCallable(checker, member, seen));
  }

  // Primitives carry apparent methods (Number.prototype.toFixed and friends). Those are not part
  // of what a caller supplies, so walking into them would flag every numeric parameter.
  const PRIMITIVE =
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Never |
    ts.TypeFlags.Void |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Null |
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.ESSymbolLike |
    ts.TypeFlags.EnumLike;
  if ((type.flags & PRIMITIVE) !== 0) return false;

  return type.getProperties().some((property) => {
    const declarations = property.getDeclarations();
    if (!declarations || declarations.length === 0) return false;
    const declaration = declarations[0]!;

    // Only walk shapes this repo declares. Binary payloads (SharedArrayBuffer, typed arrays) come
    // from the standard library and carry methods that are theirs, not part of our API surface.
    const file = declaration.getSourceFile().fileName;
    if (!file.includes('/packages/') || file.includes('/node_modules/')) return false;

    return typeTakesCallable(checker, checker.getTypeOfSymbolAtLocation(property, declaration), seen);
  });
}

describe('invariant: hot-path files carry no escape hatch', () => {
  it('contains no eslint-disable directive', () => {
    const hotDir = path.join(repoRoot, 'packages/sim/src/hot');
    const files = walk(hotDir).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      // noInlineConfig already makes these inert. Failing here means someone tried, which is the
      // signal that the rule is mis-calibrated - fix the calibration, not the code around it.
      expect(content, path.relative(repoRoot, file)).not.toContain('eslint-disable');
    }
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
