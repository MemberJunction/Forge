import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Dev-link-only mutation that makes the instance's core MJAPI serve a dev-linked
 * open app's GraphQL resolvers.
 *
 * WHY: `MJAPI/src/index.ts` calls `createMJServer({ resolverPaths })`, and
 * `@memberjunction/server`'s `serve()` builds the GraphQL schema PURELY from the
 * file globs in `resolverPaths` (+ a few cwd-relative defaults) — it does NOT read
 * `mj.config.cjs` / `codeGeneration.packages` for resolvers. The shipped MJAPI only
 * lists its OWN `generated/generated.{js,ts}`, so a dev-linked app's resolvers
 * (`@mj-biz-apps/*-server` → `dist/generated/generated.js`, the only sub-package
 * that emits a `generated/generated.js` resolver aggregate) never reach the schema.
 * In MJ 5.40.2 the `dynamicPackages.server`/StartupExport consumer is a no-op, so
 * there is no install-path mechanism to reuse — this is a dev-link enhancement (the
 * design's open "Slice 7"), NOT a parity reproduction.
 *
 * WHAT: append ONE glob to MJAPI's `resolverPaths` array covering every dev-app's
 * server-generated resolvers. The glob is app-agnostic, so linking/unlinking
 * individual apps needs no further edits — it lights up whatever is present under
 * `packages/dev-apps/`. The edit is marked, idempotent, and reversed when the last
 * dev-app is unlinked. This is a tracked edit confined to the disposable worktree
 * (like the `mj.config.cjs`/`angular.json` mutations); round-trips clean.
 *
 * If MJAPI's `resolverPaths` declaration can't be found (a future MJ restructure),
 * the caller is told so it can be re-verified per MJ branch (see the maintenance doc).
 */

/** Subpath of the MJAPI entry within an MJ worktree. */
const MJAPI_INDEX_SUBPATH = path.join('packages', 'MJAPI', 'src', 'index.ts');
/** Marker that makes the injected line idempotent + reversible. */
const MARKER = 'mjdev:dev-app-resolvers';
/**
 * Glob (relative to MJAPI's `__dirname` = `packages/MJAPI/src`) matching every
 * dev-app server package's COMPILED resolver aggregate. Only the server sub-package
 * emits `generated/generated.js` (Entities emits `entity_subclasses.js`), so this
 * never picks up non-resolver files. Points at `dist` because dev-app packages are
 * consumed as built output (MJAPI only ts-node-transpiles its own `src`).
 */
const DEV_APP_RESOLVER_GLOB = '../../dev-apps/*/packages/*/dist/generated/generated.{js,ts}';
/**
 * Anchors on the resolverPaths array literal, capturing everything up to (but not
 * including) its closing `]`. The inner content never contains a `]` (entries use
 * `resolve(...)` + brace globs), so the non-greedy match stops at the array close.
 */
const RESOLVER_PATHS_ARRAY = /(const\s+resolverPaths\s*=\s*\[[\s\S]*?)\]/;
/**
 * Matches the appended element on removal. Uses a BLOCK comment so the element can
 * sit inline on a single-line array (`[a, b /* marker *\/]`) without commenting out
 * the array close — and `'[^']*'` tolerantly matches the brace-glob string.
 */
const APPENDED_ELEMENT =
  /,\s*resolve\(__dirname,\s*'[^']*'\)\s*\/\*\s*mjdev:dev-app-resolvers\s*\*\//g;

export interface ResolverPathsMutationResult {
  success: boolean;
  /** True when the file content changed. */
  changed: boolean;
  error?: string;
}

/** The element appended to the resolverPaths array (block comment → inline-safe). */
function appendedElement(): string {
  return `, resolve(__dirname, '${DEV_APP_RESOLVER_GLOB}') /* ${MARKER} */`;
}

/** Pure: append the dev-app resolver glob as the last resolverPaths entry (no-op if present). */
export function applyAddDevAppResolverGlob(content: string): string {
  if (content.includes(MARKER)) return content;
  if (!RESOLVER_PATHS_ARRAY.test(content)) return content;
  return content.replace(RESOLVER_PATHS_ARRAY, `$1${appendedElement()}]`);
}

/** Pure: remove the appended dev-app resolver glob element (no-op if absent). */
export function applyRemoveDevAppResolverGlob(content: string): string {
  return content.replace(APPENDED_ELEMENT, '');
}

/**
 * File-level: ensure the instance MJAPI serves dev-linked apps' GraphQL resolvers.
 * Idempotent. Returns `success:false` (without throwing) if the resolverPaths anchor
 * isn't found, so the caller can warn + flag a per-branch re-verification.
 */
export async function addMjapiDevAppResolverGlob(
  mjWorktreePath: string
): Promise<ResolverPathsMutationResult> {
  const file = path.join(mjWorktreePath, MJAPI_INDEX_SUBPATH);
  try {
    const before = await fs.readFile(file, 'utf-8');
    if (before.includes(MARKER)) return { success: true, changed: false };
    const after = applyAddDevAppResolverGlob(before);
    if (after === before) {
      return {
        success: false,
        changed: false,
        error: `Could not find the resolverPaths array in ${MJAPI_INDEX_SUBPATH} — MJAPI may have changed shape; re-verify the dev-app resolver wiring for this MJ version.`,
      };
    }
    await fs.writeFile(file, after, 'utf-8');
    return { success: true, changed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, changed: false, error: `Failed to wire app resolvers: ${message}` };
  }
}

/** Whether the instance MJAPI currently serves dev-app resolvers (wiring status). */
export async function hasMjapiDevAppResolverGlob(mjWorktreePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(path.join(mjWorktreePath, MJAPI_INDEX_SUBPATH), 'utf-8');
    return content.includes(MARKER);
  } catch {
    return false;
  }
}

/** File-level reversal: remove the dev-app resolver glob from MJAPI's index. */
export async function removeMjapiDevAppResolverGlob(
  mjWorktreePath: string
): Promise<ResolverPathsMutationResult> {
  const file = path.join(mjWorktreePath, MJAPI_INDEX_SUBPATH);
  try {
    const before = await fs.readFile(file, 'utf-8');
    const after = applyRemoveDevAppResolverGlob(before);
    if (after !== before) await fs.writeFile(file, after, 'utf-8');
    return { success: true, changed: after !== before };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, changed: false, error: `Failed to unwire app resolvers: ${message}` };
  }
}
