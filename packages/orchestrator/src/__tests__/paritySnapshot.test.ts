import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenAppManager, resolvePaths } from '../../dist/index.js';

/**
 * Locks the parity-oracle extraction (the normalized snapshot Slice 5 diffs against
 * a real `mj app install` golden). Builds a fake worktree with the exact files the
 * install footprint touches and asserts each artifact is captured + normalized.
 */
let tmp: string;
let wt: string;
const APP = 'sample';

async function writeFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-snap-'));
  wt = path.join(tmp, 'mj');
  // Member manifest: declares server + shared(entities) + client packages.
  await writeFile(
    path.join(wt, 'packages', 'dev-apps', APP, 'mj-app.json'),
    JSON.stringify({
      name: 'sample-app',
      version: '2.1.0',
      schema: { name: 'sample_app' },
      packages: {
        server: [{ name: '@s/server', role: 'engine' }],
        shared: [{ name: '@s/entities', role: 'library' }],
        client: [{ name: '@s/ng', role: 'module' }],
      },
    })
  );
  await writeFile(
    path.join(wt, 'mj.config.cjs'),
    `module.exports = {
  dbHost: 'localhost',
  entityPackageName: {
    'sample_app': '@s/entities',
    'other': '@x/entities',
  },
  dynamicPackages: {
    server: [
      { PackageName: '@s/server', StartupExport: 'reg', AppName: 'sample-app', Enabled: true },
      { PackageName: '@other/p', StartupExport: 'r2', AppName: 'other-app', Enabled: true },
    ],
  },
};
`
  );
  await writeFile(
    path.join(wt, 'packages', 'MJAPI', 'package.json'),
    JSON.stringify({
      name: 'mjapi',
      dependencies: { zzz: '1.0.0', '@s/server': '^2.1.0', '@s/entities': '^2.1.0' },
    })
  );
  await writeFile(
    path.join(wt, 'packages', 'MJExplorer', 'package.json'),
    JSON.stringify({
      name: 'mjexplorer',
      dependencies: { '@s/ng': '^2.1.0', '@s/entities': '^2.1.0' },
    })
  );
  await writeFile(
    path.join(wt, 'packages', 'MJExplorer', 'angular.json'),
    JSON.stringify({
      projects: {
        app: {
          architect: {
            serve: { options: { prebundle: { exclude: ['@memberjunction/*', '@s/*'] } } },
          },
        },
      },
    })
  );
  await writeFile(
    path.join(
      wt,
      'packages',
      'MJExplorer',
      'src',
      'app',
      'generated',
      'open-app-bootstrap.generated.ts'
    ),
    `// generated\nimport '@s/ng';\n// import '@disabled/x'; // [DISABLED]\n`
  );
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('OpenAppManager.captureParitySnapshot', () => {
  it('captures + normalizes each install-footprint artifact for the target app only', async () => {
    const mgr = new OpenAppManager(resolvePaths());
    const snap = await mgr.captureParitySnapshot(wt, APP);

    expect(snap.schema).toBe('sample_app');
    // Only THIS app's dynamic entry (by manifest name 'sample-app'), normalized.
    expect(snap.dynamicServerLines).toEqual(['@s/server|reg|true']);
    // Only this schema's entityPackageName entry.
    expect(snap.entityPackageEntries).toEqual(['sample_app=@s/entities']);
    // Declared deps in key order, filtered to the app's packages.
    expect(snap.serverDeps).toEqual(['@s/server@^2.1.0', '@s/entities@^2.1.0']);
    expect(snap.clientDeps).toEqual(['@s/ng@^2.1.0', '@s/entities@^2.1.0']);
    expect(snap.prebundleExcludes).toEqual(['@memberjunction/*', '@s/*']);
    expect(snap.clientBootstrapImports).toEqual(['@s/ng']);
  });
});
