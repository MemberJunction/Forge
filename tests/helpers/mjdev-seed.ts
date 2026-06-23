/**
 * Deterministic seeding for MJ Dev Manager GUI specs.
 *
 * Writes fake `instances.json` / `openapps.json` into an isolated
 * `MJDEV_CONFIG_DIR` so the Instances + Open-Apps panels render without Docker,
 * a real worktree, or a live DB. Specs launch with
 * `withForge({ envOverrides: { MJDEV_CONFIG_DIR: dir } })`.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SeedInstanceOptions {
  slug?: string;
  name?: string;
  /** Mark all setup steps done (so build-gated controls are enabled). */
  built?: boolean;
  status?: 'stopped' | 'running' | 'provisioning' | 'error';
  baseRef?: string;
  /**
   * Override the worktree path. Point at a real
   * `<MJDEV_WORKSPACE_DIR>/instances/<slug>/mj` when a spec needs the engine to
   * act on a real instance dir (e.g. editor-artifact reconciliation).
   */
  worktreePath?: string;
}

/** Write a single-instance `instances.json`. Returns the seeded record. */
export function seedInstance(dir: string, opts: SeedInstanceOptions = {}) {
  const slug = opts.slug ?? 'smoke';
  const name = opts.name ?? 'Smoke';
  const done = opts.built ?? false;
  const record = {
    id: `${slug}-id`,
    slug,
    name,
    branch: `mjdev/${slug}`,
    baseRef: opts.baseRef ?? 'v5.40.2',
    worktreePath: opts.worktreePath ?? `/tmp/wt/${slug}`,
    container: { name: `mjdev-${slug}`, volume: `mjdev-${slug}-data` },
    ports: { sql: 1443, api: 4010, explorer: 4210 },
    dbName: `MJ_${slug}`,
    secretsRef: slug,
    status: opts.status ?? 'stopped',
    setup: {
      configWritten: true,
      depsInstalled: done,
      migrated: done,
      codegen: done,
      built: done,
    },
    createdAt: '2026-06-20T00:00:00.000Z',
  };
  writeFileSync(join(dir, 'instances.json'), JSON.stringify({ version: 1, instances: [record] }));
  return record;
}

export interface SeedAppOptions {
  app?: string;
  mode?: 'dev' | 'installed';
}

/**
 * Write an `openapps.json` linking one app into the given instance slug, in the
 * exact `OpenAppsFile`/`AppDevState` shape `AppDevStateStore` reads (a flat
 * `apps[]` keyed by slug+appName) so the engine's `listApps(slug)` sees it.
 */
export function seedOpenApps(dir: string, slug: string, opts: SeedAppOptions = {}) {
  const app = opts.app ?? 'bizapps-accounting';
  const mode = opts.mode ?? 'dev';
  const entry = {
    slug,
    appName: app,
    manifestName: app,
    appRef: app,
    mode,
    localDevPath: `/tmp/repos/apps/${app}`,
    materialization: mode === 'dev' ? 'nested-worktree' : 'published',
    ignoreVersionRangeUsed: false,
    linkedBranch: `mjdev/${slug}/${app}`,
    setup: { migrated: true, codegen: true, built: true, synced: true },
    createdAt: '2026-06-20T00:00:00.000Z',
  };
  writeFileSync(
    join(dir, 'openapps.json'),
    JSON.stringify({ version: 1, apps: [entry], recents: [app] }, null, 2)
  );
  return entry;
}
