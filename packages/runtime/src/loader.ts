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
  isReservedNamespace,
  parseContentId,
  stableTopologicalSort,
} from '@myfactorio/kernel';
import { type CompiledRules, compileRules } from '@myfactorio/rules-compiler';
import { type PackManifest, formatIssues, packManifestSchema } from '@myfactorio/rules-schema';

/**
 * The one and only path by which content enters the game.
 *
 * There is no branch in this file for "the base pack". The shipped content pack is discovered,
 * validated, ordered and registered exactly like a third-party mod; the host merely names which
 * directory is allowed to claim the reserved namespace. That is what invariant 6 means, and
 * loader.invariant.test.ts proves it by pointing this function at an empty directory.
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
  /** Directory name permitted to declare the reserved namespace. Nobody may, if unset. */
  readonly reservedNamespaceOwner?: string;
}

export interface LoadedPack {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  readonly rules: readonly ContentId[];
  readonly compiled: CompiledRules;
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
  | 'reserved-namespace'
  | 'duplicate-namespace'
  | 'namespace-mismatch'
  | 'missing-dependency'
  | 'dependency-cycle'
  | 'dependency-version-mismatch'
  | 'compile-failed';

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
  } catch {
    return ok(null);
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

export async function loadPacks(options: LoadOptions): Promise<Result<LoadedPacks, LoadError>> {
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

    if (isReservedNamespace(namespace) && pack.dirName !== options.reservedNamespaceOwner) {
      return err({
        code: 'reserved-namespace',
        message:
          `Pack in ${pack.dir} declares the reserved namespace ${JSON.stringify(namespace)}. ` +
          'Choose a namespace of your own; it is what keeps your content from colliding with everyone else\'s.',
      });
    }

    const existing = byNamespace.get(namespace);
    if (existing !== undefined) {
      return err({
        code: 'duplicate-namespace',
        message: `Namespace ${JSON.stringify(namespace)} is claimed by both ${existing.dir} and ${pack.dir}.`,
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

    packs.push({
      id: namespace,
      name: pack.manifest.name,
      version: pack.manifest.version,
      dir: pack.dir,
      rules: compiled.value.ruleIds,
      compiled: compiled.value,
    });
  }

  return ok({ packs, order: sorted.value, registry });
}
