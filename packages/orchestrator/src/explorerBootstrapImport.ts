import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Dev-link-only mutation that makes MJExplorer actually LOAD a dev-linked open app's
 * client side (Angular components/forms).
 *
 * WHY: the engine's `RegenerateClientBootstrap` writes
 * `MJExplorer/src/app/generated/open-app-bootstrap.generated.ts` with side-effect
 * imports of each app's client packages (`@mj-biz-apps/*-ng`, etc.) that fire their
 * `@RegisterClass` registrations — but in MJ 5.40.2 the shipped MJExplorer `main.ts`
 * NEVER imports that generated file, so it's dead code and the app's UI never
 * registers. This is the client-side twin of the server resolver gap (W0-A) — the
 * design's flagged "client bootstrap has no importer today." We add a single marked,
 * idempotent, reversible import of MJ's OWN generated bootstrap (we don't reproduce
 * any of its content); reversed when the last dev-app is unlinked.
 *
 * If MJExplorer's `main.ts` isn't found or the generated bootstrap doesn't exist yet,
 * the caller is told (success:false) so it can warn + re-verify per MJ branch.
 */

/** Subpath of the MJExplorer entry within an MJ worktree. */
const MJEXPLORER_MAIN_SUBPATH = path.join('packages', 'MJExplorer', 'src', 'main.ts');
/** The generated client bootstrap, relative to the MJExplorer src dir. */
const BOOTSTRAP_SUBPATH = path.join(
  'packages',
  'MJExplorer',
  'src',
  'app',
  'generated',
  'open-app-bootstrap.generated.ts'
);
/** Import specifier (relative to `main.ts`) of the generated bootstrap. */
const BOOTSTRAP_IMPORT_SPEC = './app/generated/open-app-bootstrap.generated';
/** Marker for idempotent add + reversible remove. */
const MARKER = 'mjdev:dev-app-client-bootstrap';
/** Removal matcher for the marked import line. */
const IMPORT_LINE = new RegExp(`^.*${MARKER}.*$\\n?`, 'm');

export interface BootstrapImportResult {
  success: boolean;
  /** True when the file content changed. */
  changed: boolean;
  error?: string;
}

/** Pure: prepend the marked side-effect import (no-op if already present). */
export function applyAddBootstrapImport(content: string): string {
  if (content.includes(MARKER)) return content;
  // Prepend so the app client packages register before Angular bootstraps the module.
  return `import '${BOOTSTRAP_IMPORT_SPEC}'; // ${MARKER}\n${content}`;
}

/** Pure: remove the marked side-effect import line (no-op if absent). */
export function applyRemoveBootstrapImport(content: string): string {
  return content.replace(IMPORT_LINE, '');
}

/**
 * File-level: ensure MJExplorer imports the generated open-app client bootstrap.
 * Idempotent. Returns success:false (without throwing) if `main.ts` or the generated
 * bootstrap is missing, so the caller can warn rather than break the Angular build.
 */
export async function addExplorerBootstrapImport(
  mjWorktreePath: string
): Promise<BootstrapImportResult> {
  const mainFile = path.join(mjWorktreePath, MJEXPLORER_MAIN_SUBPATH);
  const bootstrapFile = path.join(mjWorktreePath, BOOTSTRAP_SUBPATH);
  try {
    // Don't import a file that doesn't exist yet — that would break the Angular build.
    await fs.access(bootstrapFile);
  } catch {
    return {
      success: false,
      changed: false,
      error: 'Generated client bootstrap not found yet (RegenerateClientBootstrap must run first).',
    };
  }
  try {
    const before = await fs.readFile(mainFile, 'utf-8');
    if (before.includes(MARKER)) return { success: true, changed: false };
    const after = applyAddBootstrapImport(before);
    await fs.writeFile(mainFile, after, 'utf-8');
    return { success: true, changed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, changed: false, error: `Failed to wire client bootstrap: ${message}` };
  }
}

/** File-level reversal: remove the client-bootstrap import from MJExplorer's main.ts. */
export async function removeExplorerBootstrapImport(
  mjWorktreePath: string
): Promise<BootstrapImportResult> {
  const mainFile = path.join(mjWorktreePath, MJEXPLORER_MAIN_SUBPATH);
  try {
    const before = await fs.readFile(mainFile, 'utf-8');
    const after = applyRemoveBootstrapImport(before);
    if (after !== before) await fs.writeFile(mainFile, after, 'utf-8');
    return { success: true, changed: after !== before };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      changed: false,
      error: `Failed to unwire client bootstrap: ${message}`,
    };
  }
}

/** Whether MJExplorer currently imports the dev-app client bootstrap (wiring status). */
export async function hasExplorerBootstrapImport(mjWorktreePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(path.join(mjWorktreePath, MJEXPLORER_MAIN_SUBPATH), 'utf-8');
    return content.includes(MARKER);
  } catch {
    return false;
  }
}
