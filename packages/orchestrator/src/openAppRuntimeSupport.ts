import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Read-only capability probe: does this MJ worktree NATIVELY load a dev-linked Open App at runtime?
 *
 * Newer MJ ships the two consumers a dev-link relies on, so the tool no longer patches MJ source:
 *  - server: `@memberjunction/server-bootstrap` reads `dynamicPackages.server` and serves each
 *    app's resolvers (the `discoverAndLoadDynamicServerPackages` consumer);
 *  - client: MJExplorer `app.module.ts` loads the per-app side-effect imports. Two shipped
 *    mechanisms (both count as supported): the original generated `open-app-bootstrap.generated.ts`,
 *    or the newer `class-registrations-manifest` (populated by `mj codegen manifest … --ln`,
 *    which the openapp-branch refactor moved client runtime-load to).
 *
 * `mj app install` (and our dev-link) already WRITE `dynamicPackages.server` + regenerate the
 * client bootstrap; these markers tell us whether the worktree's MJ will actually CONSUME them.
 * When a marker is missing the instance's MJ predates the fix, so the app won't load at runtime —
 * `linkApp` surfaces a clear warning rather than silently serving a broken app. (Older MJ support
 * via the retired W0-A/W0-C source patches lives in git history if ever needed.)
 */

const SERVER_BOOTSTRAP_SUBPATH = path.join('packages', 'ServerBootstrap', 'src', 'index.ts');
const EXPLORER_APP_MODULE_SUBPATH = path.join(
  'packages',
  'MJExplorer',
  'src',
  'app',
  'app.module.ts'
);
/** Server-bootstrap mentions `dynamicPackages` only once it consumes it (older versions never do). */
const SERVER_CONSUMER_MARKER = 'dynamicPackages';
/**
 * `app.module.ts` imports the generated `class-registrations-manifest` once it loads
 * dev-linked app client classes — `mj codegen manifest --ln` appends one per-app
 * side-effect import per installed app. This is MJ's current open-app client
 * runtime-load mechanism (it replaced the earlier `open-app-bootstrap` file).
 */
const CLIENT_BOOTSTRAP_MARKER = 'class-registrations-manifest';

export interface OpenAppRuntimeSupport {
  /** server-bootstrap consumes `dynamicPackages.server` → app GraphQL resolvers are served. */
  serverResolvers: boolean;
  /** MJExplorer app.module imports the generated bootstrap → app client components register. */
  clientBootstrap: boolean;
}

async function fileIncludes(file: string, marker: string): Promise<boolean> {
  try {
    return (await fs.readFile(file, 'utf-8')).includes(marker);
  } catch {
    return false;
  }
}

/** Probe the MJ worktree for native Open-App runtime support (no mutation). */
export async function detectOpenAppRuntimeSupport(
  mjWorktreePath: string
): Promise<OpenAppRuntimeSupport> {
  const [serverResolvers, clientBootstrap] = await Promise.all([
    fileIncludes(path.join(mjWorktreePath, SERVER_BOOTSTRAP_SUBPATH), SERVER_CONSUMER_MARKER),
    fileIncludes(path.join(mjWorktreePath, EXPLORER_APP_MODULE_SUBPATH), CLIENT_BOOTSTRAP_MARKER),
  ]);
  return { serverResolvers, clientBootstrap };
}
