import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type ContentId,
  type Result,
  Registry,
  ok,
  err,
  compareCodeUnits,
  contentIdNamespace,
  parseContentId,
  stableTopologicalSort,
} from '@myfactorio/kernel';
import { INSTRUCTION_BYTES } from '@myfactorio/isa';
import { type CompiledRules, compileRules } from '@myfactorio/rules-compiler';
import { type PackManifest, formatIssues, packManifestSchema } from '@myfactorio/rules-schema';

/**
 * The one and only path by which content enters the game.
 *
 * There is no branch in this file for "the base pack". The shipped content pack is discovered,
 * validated, ordered and registered exactly like a third-party mod, and loadPacks takes no
 * argument naming a privileged one. That is what invariant 6 means, and loader.invariant.test.ts
 * proves it by pointing this function at an empty directory.
 *
 * Nothing here throws. The shell has to be able to open a window and show a readable message.
 */

export const PACK_MANIFEST_FILE = 'pack.json';

export interface LoadOptions {
  readonly packsDir: string;
  /**
   * Directory names to consider, instead of enumerating packsDir. Used by the determinism test to
   * stand in for the filesystem returning entries in a different order on a different machine.
   */
  readonly entries?: readonly string[];
}

export interface LoadedPack {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  readonly rules: readonly ContentId[];
  /** Instructions in the compiled program. Metadata, not the bytes. */
  readonly programLength: number;
}

/**
 * The compiled programs, deliberately NOT on LoadedPack.
 *
 * `save-no-isa`, `save-no-sim` and `modding-api-no-isa` closed every IMPORT path by which bytecode
 * could reach the save container, and the data path stayed wide open: `apps` may import anything,
 * `LoadedPack.compiled.program` was a public `Uint8Array`, and `SaveDoc.payload` is an opaque
 * `Uint8Array` by design (ADR-0014). Two correct decisions, and between them a five-line function
 * that writes bytecode into a `.fsav` without any package ever seeing an opcode. ADR-0006 claimed
 * "never written to disk" and it was false the whole time.
 *
 * So the bytes are not handed out. They live here, and when the simulation eventually needs them
 * they cross into the worker as a SharedArrayBuffer through the boundary in ADR-0034 — which is
 * where they were always going, and which is not a value anyone can pass to `writeSave`.
 *
 * Honest about what this does not do: `apps` can still build a Uint8Array of anything and persist
 * it. What is gone is the convenient path, where the loader hands you compiled bytecode already
 * shaped like a save payload. See ADR-0048.
 */
const programs = new WeakMap<LoadedPacks, ReadonlyMap<string, CompiledRules>>();

/** For the future worker hand-off. Returns nothing a caller can serialise by accident. */
export function programInstructionCount(loaded: LoadedPacks, packId: string): number {
  return programs.get(loaded)?.get(packId)?.program.byteLength ?? 0;
}

export interface LoadedPacks {
  readonly packs: readonly LoadedPack[];
  readonly order: readonly string[];
  readonly registry: Registry;
}

export type LoadErrorCode =
  | 'packs-dir-missing'
  | 'no-packs-found'
  | 'invalid-manifest'
  | 'duplicate-namespace'
  | 'namespace-mismatch'
  | 'missing-dependency'
  | 'dependency-cycle'
  | 'dependency-version-mismatch'
  | 'compile-failed'
  | 'unreadable-manifest'
  | 'unexpected-error';

export interface LoadError {
  readonly code: LoadErrorCode;
  readonly message: string;
}

/**
 * Numeric major.minor.patch comparison. The schema guarantees the shape, so there is nothing to
 * parse defensively here — and nothing locale-dependent either, which a string comparison would be.
 */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

interface DiscoveredPack {
  readonly dir: string;
  readonly dirName: string;
  readonly manifest: PackManifest;
}

async function enumerate(options: LoadOptions): Promise<Result<readonly string[], LoadError>> {
  if (options.entries !== undefined) return ok(options.entries);

  try {
    const dirents = await readdir(options.packsDir, { withFileTypes: true });
    const names: string[] = [];
    for (const dirent of dirents) {
      if (dirent.isDirectory()) names.push(dirent.name);
    }
    return ok(names);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return err({
        code: 'packs-dir-missing',
        message:
          `No content directory at ${options.packsDir}. ` +
          `The game expects a directory holding one subdirectory per pack, each with a ${PACK_MANIFEST_FILE}.`,
      });
    }
    return err({ code: 'packs-dir-missing', message: `Cannot read ${options.packsDir}: ${String(cause)}.` });
  }
}

async function listCandidateDirs(options: LoadOptions): Promise<Result<readonly string[], LoadError>> {
  const found = await enumerate(options);
  if (!found.ok) return found;

  // ONE sort site, deliberately. readdir order depends on the filesystem, so it differs between
  // this machine and a player's, and that difference would reach handle assignment through the
  // topological sort's tie-breaks (ADR-0011). Sorting here rather than inside each branch is what
  // lets the determinism test cover the readdir path: the test injects `entries`, so a second sort
  // hidden in the readdir branch would go untested while looking perfectly correct.
  return ok([...found.value].sort(compareCodeUnits));
}

async function readManifest(packsDir: string, dirName: string): Promise<Result<DiscoveredPack | null, LoadError>> {
  const dir = path.join(packsDir, dirName);
  const manifestPath = path.join(dir, PACK_MANIFEST_FILE);

  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (cause) {
    // Only "there is no manifest here" means "this directory is not a pack". The catch used to
    // swallow everything, so a manifest that existed but could not be read - a directory named
    // pack.json, a permission problem, a bad symlink - turned the pack into one that was simply not
    // there. A player whose mod silently vanished has no way to find out why.
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return ok(null);
    return err({
      code: 'unreadable-manifest',
      message: `${manifestPath} exists but cannot be read: ${String(cause)}.`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return err({ code: 'invalid-manifest', message: `${manifestPath} is not valid JSON: ${String(cause)}.` });
  }

  const validated = packManifestSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = formatIssues(validated.error)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    return err({ code: 'invalid-manifest', message: `${manifestPath} is not a valid pack manifest. ${issues}` });
  }

  return ok({ dir, dirName, manifest: validated.data });
}

/**
 * "This never throws" was asserted everywhere and tested on one happy path: an empty directory.
 *
 * Every individual failure below is handled and returned, and that is worth doing because it is
 * what produces a message a player can act on. But auditing each line is not a mechanism — one
 * unguarded `JSON.parse` on a sidecar file, added later by someone who read the doc comment and
 * believed it, sends a SyntaxError all the way to the shell's main(), which writes `fatal` and
 * exits before the window that would have explained the problem ever opens.
 *
 * So the promise is kept structurally as well: anything unexpected becomes a Result here. The
 * message carries the original error, so this converts a crash into a legible failure rather than
 * hiding a bug. See ADR-0044.
 */
export async function loadPacks(options: LoadOptions): Promise<Result<LoadedPacks, LoadError>> {
  try {
    return await loadPacksOrThrow(options);
  } catch (cause) {
    // Read defensively: the first version interpolated options.packsDir straight into the message,
    // and a hostile options object threw again from inside the catch - a safety net that fails the
    // same way as what it was catching. The error path has to be at least as robust as the happy
    // one, and the test that found this passes a getter that explodes.
    let where = '(unknown directory)';
    try {
      where = String(options.packsDir);
    } catch {
      /* keep the placeholder */
    }

    return err({
      code: 'unexpected-error',
      message:
        `Loading content from ${where} failed in a way the loader did not anticipate: ` +
        `${String(cause)}. This is a bug; the game continues without content.`,
    });
  }
}

async function loadPacksOrThrow(options: LoadOptions): Promise<Result<LoadedPacks, LoadError>> {
  const candidates = await listCandidateDirs(options);
  if (!candidates.ok) return candidates;

  const discovered: DiscoveredPack[] = [];
  for (const dirName of candidates.value) {
    const found = await readManifest(options.packsDir, dirName);
    if (!found.ok) return found;
    if (found.value !== null) discovered.push(found.value);
  }

  if (discovered.length === 0) {
    return err({
      code: 'no-packs-found',
      message:
        `No content pack found in ${options.packsDir}. ` +
        `At least one subdirectory containing a ${PACK_MANIFEST_FILE} manifest is required, ` +
        'including the base content. Reinstalling the game restores it.',
    });
  }

  const byNamespace = new Map<string, DiscoveredPack>();
  for (const pack of discovered) {
    const namespace = pack.manifest.id;

    // No special case for the base pack's namespace. `core` used to be reserved and the token was a
    // directory name, so a third-party pack in a folder called `core-empty` simply got it. A
    // collision is now caught here like any other, and this message is better than the one it
    // replaces because it names both directories. See ADR-0046.
    const existing = byNamespace.get(namespace);
    if (existing !== undefined) {
      return err({
        code: 'duplicate-namespace',
        message:
          `Namespace ${JSON.stringify(namespace)} is claimed by both ${existing.dir} and ${pack.dir}. ` +
          'Each pack needs a namespace of its own; that is what keeps content from colliding.',
      });
    }
    byNamespace.set(namespace, pack);
  }

  // Declared dependency versions used to be validated by the schema and then thrown away: a pack
  // asking for base@42.0.0 loaded happily against base@1.0.0, while PackRef.version was written
  // into every save. Information collected, carried and never used is worse than absent - it reads
  // like a guarantee.
  for (const pack of discovered) {
    for (const [dependency, required] of Object.entries(pack.manifest.dependencies)) {
      const provider = byNamespace.get(dependency);
      if (provider === undefined) continue; // reported as a missing dependency below
      if (compareVersions(provider.manifest.version, required) < 0) {
        return err({
          code: 'dependency-version-mismatch',
          message:
            `${pack.dir} requires ${dependency} ${required}, but ${provider.dir} provides ` +
            `${provider.manifest.version}. Update the dependency or relax the requirement.`,
        });
      }
    }
  }

  const sorted = stableTopologicalSort(
    discovered.map((pack) => ({
      id: pack.manifest.id,
      dependsOn: Object.keys(pack.manifest.dependencies).sort(compareCodeUnits),
    })),
  );
  if (!sorted.ok) {
    const code: LoadErrorCode =
      sorted.error.code === 'dependency-cycle' ? 'dependency-cycle' : 'missing-dependency';
    return err({ code, message: sorted.error.message });
  }

  const registry = new Registry();
  const packs: LoadedPack[] = [];
  const compiledByPack = new Map<string, CompiledRules>();

  for (const namespace of sorted.value) {
    const pack = byNamespace.get(namespace)!;

    for (const rule of pack.manifest.rules) {
      const parsed = parseContentId(rule.id);
      if (!parsed.ok) {
        return err({ code: 'invalid-manifest', message: `${pack.dir}: ${parsed.error.message}` });
      }
      if (contentIdNamespace(parsed.value) !== namespace) {
        return err({
          code: 'namespace-mismatch',
          message:
            `${pack.dir} declares ${parsed.value}, which belongs to another namespace. ` +
            `A pack may only declare ids under ${JSON.stringify(namespace)}.`,
        });
      }
    }

    const compiled = compileRules(pack.manifest.rules);
    if (!compiled.ok) {
      return err({ code: 'compile-failed', message: `${pack.dir}: ${compiled.error.message}` });
    }

    // Registration order follows the deterministic load order, so handles are reproducible.
    // The Result is handled rather than dropped: these ids were parsed a few lines above, so a
    // failure here means the parser and the registry disagree, and swallowing it in the one file
    // whose package defines Result was not defensible.
    for (const id of compiled.value.ruleIds) {
      const registered = registry.register(id);
      if (!registered.ok) {
        return err({ code: 'invalid-manifest', message: `${pack.dir}: ${registered.error.message}` });
      }
    }

    compiledByPack.set(namespace, compiled.value);
    packs.push({
      id: namespace,
      name: pack.manifest.name,
      version: pack.manifest.version,
      dir: pack.dir,
      rules: compiled.value.ruleIds,
      programLength: compiled.value.program.byteLength / INSTRUCTION_BYTES,
    });
  }

  const loaded: LoadedPacks = { packs, order: sorted.value, registry };
  programs.set(loaded, compiledByPack);
  return ok(loaded);
}
