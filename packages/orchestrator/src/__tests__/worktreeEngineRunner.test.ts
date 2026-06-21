import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  WorktreeEngineRunner,
  ENGINE_ENTRY_SOURCE,
  ENGINE_EVENT_SENTINEL,
} from '../../dist/index.js';
import type { InstanceEvent } from '@mj-forge/shared';

/**
 * Exercises the spawn + sentinel-NDJSON parsing protocol of WorktreeEngineRunner
 * WITHOUT a database, by injecting a DB-free fake entrypoint that echoes the job
 * spec back through the real `@@MJDEV-ENGINE@@` protocol. The real engine is
 * proven separately by the live integration run (it needs SQL Server).
 */
let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-engrun-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// A fake entry that reads the spec, emits a progress line per step, then a result.
const FAKE_ENTRY = `import { readFileSync } from 'node:fs';
const S = '${ENGINE_EVENT_SENTINEL}';
const spec = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
const send = (k, p, m, d) => process.stdout.write(S + JSON.stringify({ kind: k, phase: p, message: m || '', data: d || null }) + '\\n');
console.log('noise: provider booting');
const results = {};
for (const step of spec.steps) { send('progress', step, 'running ' + step); results[step] = { step, ok: true }; }
send('result', 'Done', 'done', { results, mjVersion: '5.40.2' });
process.exit(0);
`;

describe('WorktreeEngineRunner — spawn + protocol parsing', () => {
  it('streams progress events and captures the final result (DB-free fake entry)', async () => {
    const events: InstanceEvent[] = [];
    const runner = new WorktreeEngineRunner(tmp, FAKE_ENTRY);
    const result = await runner.run(
      'demo',
      {
        steps: ['ensureSchema', 'migrate'],
        dbConfig: { host: 'h', port: 1, database: 'd', user: 'u', password: 'p' },
      },
      process.env,
      ev => events.push(ev)
    );

    expect(result.ok).toBe(true);
    expect(result.mjVersion).toBe('5.40.2');
    expect(result.results).toEqual({
      ensureSchema: { step: 'ensureSchema', ok: true },
      migrate: { step: 'migrate', ok: true },
    });
    // Progress for each step was forwarded, plus the noise line as info.
    expect(events.some(e => e.message.includes('ensureSchema'))).toBe(true);
    expect(events.some(e => e.message.includes('migrate'))).toBe(true);
    expect(events.some(e => e.level === 'info' && e.message.includes('provider booting'))).toBe(
      true
    );
  });

  it('passes install source/version through the job spec and captures the result', async () => {
    // The install step is driven by spec.source/spec.version (no member/manifest).
    const INSTALL_FAKE = `import { readFileSync } from 'node:fs';
const S = '${ENGINE_EVENT_SENTINEL}';
const spec = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
const send = (k, p, m, d) => process.stdout.write(S + JSON.stringify({ kind: k, phase: p, message: m || '', data: d || null }) + '\\n');
const results = { install: { appName: 'bizapps-common', version: spec.version || 'HEAD', source: spec.source } };
send('result', 'Done', 'done', { results, mjVersion: '5.40.2' });
process.exit(0);
`;
    const runner = new WorktreeEngineRunner(tmp, INSTALL_FAKE);
    const result = await runner.run('demo', {
      steps: ['install'],
      source: 'https://github.com/MemberJunction/bizapps-common',
      version: '1.2.0',
      dbConfig: { host: 'h', port: 1, database: 'd', user: 'u', password: 'p' },
    });
    expect(result.ok).toBe(true);
    expect(result.results?.install).toEqual({
      appName: 'bizapps-common',
      version: '1.2.0',
      source: 'https://github.com/MemberJunction/bizapps-common',
    });
  });

  it('surfaces an engine error (non-zero exit) as ok:false with the message', async () => {
    const FAIL_ENTRY = `const S = '${ENGINE_EVENT_SENTINEL}';
const send = (k, p, m) => process.stdout.write(S + JSON.stringify({ kind: k, phase: p, message: m, data: null }) + '\\n');
send('error', 'Fatal', 'boom: schema collision');
process.exit(1);
`;
    const runner = new WorktreeEngineRunner(tmp, FAIL_ENTRY);
    const result = await runner.run('demo', {
      steps: ['ensureSchema'],
      dbConfig: { host: 'h', port: 1, database: 'd', user: 'u', password: 'p' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom: schema collision');
  });
});

describe('ENGINE_ENTRY_SOURCE — generated-script contract', () => {
  it('drives the worktree provider + engine handlers via the parity path', () => {
    // Guards against a refactor silently breaking the in-worktree entrypoint.
    for (const token of [
      'setupSQLServerClient',
      'SQLServerProviderConfigData',
      'UserCache',
      'SchemaExists',
      'CreateAppSchema',
      'RunAppMigrations',
      'LoadManifestFromFile',
      'flyway_schema_history',
      // Slice 2 mutation set
      'RecordAppInstallation',
      'AddAppPackages',
      'AddServerDynamicPackages',
      'AngularConfigManager',
      'SetAppStatus',
      'RegenerateClientBootstrap',
      'ListInstalledApps',
      // Slice 3 reversal
      'RemoveServerDynamicPackages',
      'RemoveAppPackages',
      'RemovePrebundleExcludes',
      'DropAppSchema',
      // Slice 4 recovery + version override
      'CheckMJVersionCompatibility',
      'Validate',
      'Clean',
      'Repair',
      'cleanAppMetadata',
      // Plain-install path (the real `mj app install`)
      'InstallApp',
      'GitHubOptions',
      '@memberjunction/skyway-core',
      '@memberjunction/open-app-engine',
      '@memberjunction/sqlserver-dataprovider',
      ENGINE_EVENT_SENTINEL,
    ]) {
      expect(ENGINE_ENTRY_SOURCE).toContain(token);
    }
  });
});
