import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Reproduction of the Open App Engine's `entityPackageName` config mutation, which
 * is the ONE install step not exported by `@memberjunction/open-app-engine`
 * (`AddEntityPackageMapping`/`RemoveEntityPackageMapping` are module-private). It is
 * pure text manipulation of `mj.config.cjs`, so reproducing it Forge-side — rather
 * than inside the worktree entrypoint — keeps it unit-testable (golden-file vs a real
 * `mj app install`) while producing byte-identical output. Ported VERBATIM from
 * `packages/OpenApp/Engine/src/install/config-manager.ts`; keep in lockstep with it.
 *
 * `entityPackageName` is a `Record<schemaName, entitiesPackageName>` in mj.config.cjs
 * that tells CodeGen which npm package holds an app schema's generated entity
 * subclasses. R6 (drift risk) is mitigated by the golden test on these functions.
 */
const CONFIG_FILE_NAME = 'mj.config.cjs';

export interface EntityPackageMappingResult {
  success: boolean;
  /** True when the config content changed. */
  changed: boolean;
  error?: string;
}

/** Resolve the npm entities package for an app from its manifest (explicit, else auto-detect). */
export function resolveEntityPackageFromManifest(manifest: {
  schema?: { name?: string; entityPackage?: string };
  packages?: { shared?: Array<{ name: string; role?: string }> };
}): string | undefined {
  if (manifest.schema?.entityPackage) {
    return manifest.schema.entityPackage;
  }
  const sharedPkgs = manifest.packages?.shared ?? [];
  const entitiesPkg = sharedPkgs.find(
    pkg => pkg.role === 'library' && pkg.name.toLowerCase().includes('entities')
  );
  return entitiesPkg?.name;
}

/** Escape a string for safe inclusion in a RegExp (verbatim from the engine). */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove an existing `'schema': 'pkg',` entry from the config text. */
export function removeEntityPackageEntry(content: string, schemaName: string): string {
  const pattern = new RegExp(`\\s*'${escapeRegex(schemaName)}'\\s*:\\s*'[^']*'\\s*,?`, 'g');
  return content.replace(pattern, '');
}

/** Ensure an `entityPackageName: { ... }` Record section exists, converting a legacy string form. */
export function ensureEntityPackageNameSection(content: string): string {
  const recordMatch = content.match(/entityPackageName\s*:\s*\{/);
  if (recordMatch) {
    return content;
  }
  const stringMatch = content.match(/entityPackageName\s*:\s*['"]([^'"]*)['"]\s*,?/);
  if (stringMatch) {
    const oldValue = stringMatch[1];
    const replacement = `entityPackageName: {\n    // Converted from string value '${oldValue}' by mj app install\n  },`;
    return content.replace(stringMatch[0], replacement);
  }
  const insertionPoint = content.lastIndexOf('};');
  if (insertionPoint === -1) {
    return content;
  }
  const section = `\n  entityPackageName: {\n  },\n`;
  return content.slice(0, insertionPoint) + section + content.slice(insertionPoint);
}

/** Insert a `'schema': 'pkg',` entry into the entityPackageName Record (de-duping first). */
export function addEntityPackageEntry(
  content: string,
  schemaName: string,
  packageName: string
): string {
  content = removeEntityPackageEntry(content, schemaName);
  const recordMatch = content.match(/entityPackageName\s*:\s*\{/);
  if (!recordMatch || recordMatch.index === undefined) {
    return content;
  }
  const bracePos = content.indexOf('{', recordMatch.index);
  const entryStr = `\n    '${schemaName}': '${packageName}',`;
  return content.slice(0, bracePos + 1) + entryStr + content.slice(bracePos + 1);
}

/** Apply the full add mutation to config text (pure; the testable core). */
export function applyAddEntityPackageMapping(
  content: string,
  schemaName: string,
  packageName: string
): string {
  return addEntityPackageEntry(ensureEntityPackageNameSection(content), schemaName, packageName);
}

/**
 * File-level `AddEntityPackageMapping`: resolve the entities package from the
 * manifest and, if present, mutate `<repoRoot>/mj.config.cjs`. A no-op (success)
 * when the app has no schema or no entities package — exactly the engine's behavior.
 */
export async function addEntityPackageMapping(
  repoRoot: string,
  manifest: {
    schema?: { name?: string; entityPackage?: string };
    packages?: { shared?: Array<{ name: string; role?: string }> };
  }
): Promise<EntityPackageMappingResult> {
  const schemaName = manifest.schema?.name;
  if (!schemaName) return { success: true, changed: false };
  const entityPkg = resolveEntityPackageFromManifest(manifest);
  if (!entityPkg) return { success: true, changed: false };

  const configPath = path.join(repoRoot, CONFIG_FILE_NAME);
  try {
    const before = await fs.readFile(configPath, 'utf-8');
    const after = applyAddEntityPackageMapping(before, schemaName, entityPkg);
    if (after !== before) await fs.writeFile(configPath, after, 'utf-8');
    return { success: true, changed: after !== before };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      changed: false,
      error: `Failed to update entityPackageName config: ${message}`,
    };
  }
}

/** File-level `RemoveEntityPackageMapping` (reversal). */
export async function removeEntityPackageMapping(
  repoRoot: string,
  schemaName: string
): Promise<EntityPackageMappingResult> {
  if (!schemaName) return { success: true, changed: false };
  const configPath = path.join(repoRoot, CONFIG_FILE_NAME);
  try {
    const before = await fs.readFile(configPath, 'utf-8');
    const after = removeEntityPackageEntry(before, schemaName);
    if (after !== before) await fs.writeFile(configPath, after, 'utf-8');
    return { success: true, changed: after !== before };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      changed: false,
      error: `Failed to remove entityPackageName mapping: ${message}`,
    };
  }
}
