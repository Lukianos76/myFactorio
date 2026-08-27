import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';
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

  it('stays under 2,600 bytes as well', () => {
    // The line cap counts newlines, and the pressure it describes acts on CONTENT: 39 lines went
    // from 2,215 bytes to 5,375 during review without adding a single line. Detail that used to
    // live in a per-package CLAUDE.md, restated here at length, is exactly the dilution the cap
    // exists to prevent, and it fits comfortably inside the line budget.
    const bytes = Buffer.byteLength(readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8'), 'utf8');
    expect(bytes, `CLAUDE.md is ${bytes} bytes`).toBeLessThanOrEqual(2_600);
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

describe('invariant: lint rules survive into every config block', () => {
  /**
   * Flat config REPLACES a rule's options instead of merging them, so a later block that sets
   * no-restricted-syntax for its own purposes silently discards whatever an earlier block put
   * there. That is not hypothetical: the ContentId cast ban read as enabled at the top of
   * eslint.config.js while being dead in every single package, because the determinism block
   * overwrote it. Nothing failed, nothing warned - it simply stopped applying.
   *
   * This asserts the EFFECTIVE config, file by file, rather than trusting the source to be read
   * the way it looks.
   */
  const CONTENT_ID_SELECTOR = "TSAsExpression > TSTypeReference > Identifier[name='ContentId']";

  const SAMPLES = [
    'packages/save/src/index.ts',
    'packages/runtime/src/loader.ts',
    'packages/sim/src/world.ts',
    'packages/sim/src/hot/buffer-ops.ts',
    'apps/desktop/src/main/index.ts',
  ];

  it.each(SAMPLES)('%s still forbids casting to ContentId', async (file) => {
    const eslint = new ESLint({ cwd: repoRoot });
    const config = await eslint.calculateConfigForFile(path.join(repoRoot, file));

    const entry = config.rules?.['no-restricted-syntax'];
    expect(entry, `${file} has no no-restricted-syntax at all`).toBeDefined();

    const selectors = (entry as unknown[])
      .slice(1)
      .map((option) => (option as { selector?: string }).selector);
    expect(selectors).toContain(CONTENT_ID_SELECTOR);
  });

  /**
   * The same check for no-restricted-properties, added after the syntax-only version watched the
   * bug happen again. A block introduced for the worker boundary matched `packages/**`, which
   * includes `packages/sim/src/hot`, and silently switched off every allocating-method ban there.
   * ADR-0021 named this failure mode; a guard covering one rule and not its neighbour did not stop
   * it recurring four ADRs later.
   */
  const EXPECTED_PROPERTIES = [
    ['packages/sim/src/hot/buffer-ops.ts', ['slice', 'map', 'filter', 'concat', 'localeCompare', 'random', 'postMessage']],
    ['packages/runtime/src/loader.ts', ['localeCompare', 'random', 'getRandomValues', 'postMessage']],
    ['packages/save/src/container.ts', ['localeCompare', 'random', 'postMessage']],
  ] as const;

  it.each(EXPECTED_PROPERTIES)('%s still restricts the properties it must', async (file, expected) => {
    const eslint = new ESLint({ cwd: repoRoot });
    const config = await eslint.calculateConfigForFile(path.join(repoRoot, file));

    const entry = config.rules?.['no-restricted-properties'];
    expect(entry, `${file} has no no-restricted-properties at all`).toBeDefined();

    const restricted = (entry as unknown[])
      .slice(1)
      .map((option) => (option as { property?: string }).property);
    for (const property of expected) expect(restricted, `${file} lost .${property}`).toContain(property);
  });

  it('kernel/src/id.ts is the one place allowed to mint the brand', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const config = await eslint.calculateConfigForFile(path.join(repoRoot, 'packages/kernel/src/id.ts'));
    const entry = config.rules?.['no-restricted-syntax'];
    const severity = Array.isArray(entry) ? entry[0] : entry;
    expect(severity).toBe(0);
  });
});

describe('invariant: a file-level lint exemption does not become a laundering service', () => {
  /**
   * `packages/kernel/src/id.ts` is the one file where casting to `ContentId` is allowed, because
   * `parseContentId` has to mint the brand somewhere. The exemption is per FILE, which means it is
   * also the one file where anyone can add:
   *
   *     /** Fast path for ids already known to be well formed. *\/
   *     export function unsafeContentId(raw: string): ContentId { return raw as ContentId; }
   *
   * Exported from kernel, that hands every other package a legal forgery, and it is the most
   * natural bypass in the whole codebase because it is written exactly where the rules permit it.
   * Freezing the export list is what makes adding it a decision rather than an edit.
   *
   * Same shape as the freeze on `packages/sim/src/determinism.ts`, which reaches globals by string
   * key for reasons the lint cannot see either.
   */
  const FROZEN = [
    [
      'packages/kernel/src/id.ts',
      [
        // Grammar sources, so rules-schema can publish this grammar instead of re-typing it
        // (ADR-0040). Strings and a number: none of them can mint a ContentId, which is the only
        // property this freeze exists to protect.
        'CONTENT_ID_SOURCE',
        'MAX_CONTENT_ID_LENGTH',
        'NAMESPACE_SOURCE',
        'PATH_SEGMENT_SOURCE',
        'PATH_SOURCE',
        // The type, the separator, the errors.
        'ContentId',
        'ID_SEPARATOR',
        'IdError',
        'IdErrorCode',
        // The only function that mints, and three that read.
        'contentIdNamespace',
        'contentIdPath',
        'parseContentId',
      ],
    ],
    ['packages/sim/src/determinism.ts', ['NonDeterminismError', 'sealAmbientSources']],
  ] as const;

  it.each(FROZEN)('%s exports exactly what it is meant to', (file, expected) => {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    const exported = [...source.matchAll(/^export (?:type|interface|const|function|class) (\w+)/gm)]
      .map((match) => match[1]!)
      .sort();
    // Both sides sorted: the list above is grouped by meaning so a reader can see what each export
    // is for, and grouping is more useful than alphabetical order in a list whose whole job is to
    // make someone think before adding to it.
    expect(exported).toEqual([...expected].sort());
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

    /**
     * ONE recursion over everything reachable, rather than a list of shapes.
     *
     * The previous version enumerated: call signatures, then construct signatures, then the members
     * of a constructor's return type. Each was added the day someone demonstrated the shape it
     * missed — a plain function, then a class, then a class's methods. An object literal with a
     * method has neither call nor construct signatures, so both loops were skipped entirely and
     * `export const hooks = { register(cb) {} }` was never visited at all.
     *
     * Adding a fourth branch would close that one form and leave the next: a nested object, an
     * array of handler records, a namespace object of namespace objects. The invariant is "no
     * callable is reachable from sim's public surface", so the walk has to be a reachability walk.
     * It descends through anything this repository declares — properties, unions, array elements —
     * and checks every signature it meets, wherever it lives. Standard-library shapes are not
     * followed, for the reason typeTakesCallable already gives.
     */
    function checkSignature(owner: string, signature: ts.Signature): void {
      for (const parameter of signature.getParameters()) {
        const paramType = checker.getTypeOfSymbolAtLocation(parameter, source!);

        // A bare `T` with no constraint accepts a function as readily as anything else. Generic
        // parameters whose type is a construction over T - TransferSafe<T> and friends - are not
        // flagged: those resolve through the type alias, which is where the constraint lives.
        if (paramType.flags & ts.TypeFlags.TypeParameter && paramType.getConstraint() === undefined) {
          offenders.push(`${owner}(${parameter.getName()}: unconstrained generic)`);
          continue;
        }
        if (typeTakesCallable(checker, paramType, new Set())) {
          offenders.push(`${owner}(${parameter.getName()})`);
        }
      }
    }

    function walkSurface(owner: string, type: ts.Type, seen: Set<ts.Type>): void {
      if (seen.has(type)) return;
      seen.add(type);

      for (const signature of type.getCallSignatures()) checkSignature(owner, signature);

      for (const construct of type.getConstructSignatures()) {
        checkSignature(`new ${owner}`, construct);
        walkSurface(`${owner}#`, construct.getReturnType(), seen);
      }

      if (type.isUnionOrIntersection()) {
        for (const member of type.types) walkSurface(owner, member, seen);
        return;
      }

      /*
       * Three ways a type exposes something, and all three are enumerators.
       *
       * Properties are one. Type arguments are the second: `{ on(cb) }[]` escaped a
       * properties-only walk, because an array's own members belong to the standard library and are
       * skipped, so the element type was never reached. Index signatures are the third:
       * `Record<string, CB>` declares no properties at all, so `getProperties()` returns nothing and
       * the descent stopped dead — while `table['x'](cb)` compiles perfectly.
       *
       * The axis differs: type arguments are how a value is WRAPPED, index signatures are how a type
       * DECLARES its members. Same class of gap, and the reason to enumerate all three at once
       * rather than adding the one that was demonstrated.
       */
      if ((type.flags & ts.TypeFlags.Object) !== 0) {
        for (const argument of checker.getTypeArguments(type as ts.TypeReference)) {
          walkContained(`${owner}[]`, argument, seen);
        }
      }
      for (const info of checker.getIndexInfosOfType(type)) {
        walkContained(`${owner}[key]`, info.type, seen);
      }

      // Named properties: methods on shapes we declare, and everything they reach in turn. This
      // loop was accidentally orphaned into walkContained by an edit that closed the function one
      // brace early, which switched off the entire property descent while the suite stayed green -
      // caught by the verifier case for the object literal, one commit after writing it.
      for (const property of type.getProperties()) {
        const declaration = property.getDeclarations()?.[0];
        if (declaration === undefined) continue;

        // Only what this repository declares. A typed array's own methods are its business.
        const file = declaration.getSourceFile().fileName;
        if (!file.includes('/packages/') || file.includes('/node_modules/')) continue;

        walkSurface(
          `${owner}${owner.endsWith('#') ? '' : '.'}${property.getName()}`,
          checker.getTypeOfSymbolAtLocation(property, declaration),
          seen,
        );
      }
    }

    /**
     * What sits INSIDE a container, where a callable is a deposit point rather than a method.
     *
     * `export const sinks: Record<string, CB> = {}` takes no function as a parameter, so the test's
     * own title — "no exported signature takes a callable parameter" — is satisfied. CLAUDE.md says
     * something wider: "No sim API accepts a function", and a mutable exported registry where a mod
     * drops a callback is precisely what DataOnly exists to prevent. The wider wording governs.
     *
     * The line is between a named property and a container slot. `SimPort.send` is a method: our
     * behaviour, on a shape we declare. A value reached through an index signature or a type
     * argument is a slot someone else fills. Flagging every callable property would flag every
     * method we export, which is not the invariant.
     */
    function walkContained(owner: string, type: ts.Type, seen: Set<ts.Type>): void {
      if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
        offenders.push(`${owner}: a container slot a mod can fill with a function`);
        return;
      }
      walkSurface(owner, type, seen);
    }

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      walkSurface(exported.getName(), checker.getTypeOfSymbolAtLocation(exported, source), new Set());
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
