import { describe, it, expect } from 'vitest';
import { ConfigWriter } from '../../dist/index.js';
import type { InstanceRecord, InstanceSecrets } from '@mj-forge/shared';

const record: InstanceRecord = {
  id: 'abc',
  slug: 'feature-x',
  name: 'Feature X',
  branch: 'feature/x',
  worktreePath: '/tmp/wt/feature-x',
  container: { name: 'mjdev-feature-x', volume: 'mjdev-feature-x-data' },
  ports: { sql: 1443, api: 4010, explorer: 4210 },
  dbName: 'MJ_feature_x',
  secretsRef: 'feature-x',
  status: 'provisioning',
  setup: {
    configWritten: false,
    depsInstalled: false,
    migrated: false,
    codegen: false,
    built: false,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const secrets: InstanceSecrets = {
  saPassword: 'P@ssw0rd-Strong',
  dbUsername: 'sa',
  dbPassword: 'P@ssw0rd-Strong',
  codegenUsername: 'sa',
  codegenPassword: 'P@ssw0rd-Strong',
};

describe('ConfigWriter.renderEnv', () => {
  const env = ConfigWriter.renderEnv(record, secrets);
  it('points DB_PORT at the instance SQL port', () => {
    expect(env).toContain('DB_PORT=1443');
  });
  it('sets GRAPHQL_PORT to the API port', () => {
    expect(env).toContain('GRAPHQL_PORT=4010');
  });
  it('uses the per-instance database name', () => {
    expect(env).toContain('DB_DATABASE=MJ_feature_x');
  });
  it('writes credentials from secrets', () => {
    expect(env).toContain('DB_USERNAME=sa');
    expect(env).toContain('DB_PASSWORD=P@ssw0rd-Strong');
  });
  it('trusts the server certificate (truthy form mj.config.cjs accepts)', () => {
    expect(env).toContain('DB_TRUST_SERVER_CERTIFICATE=true');
  });
});

describe('ConfigWriter.renderExplorerEnv', () => {
  const ts = ConfigWriter.renderExplorerEnv(record);
  it('targets the instance API port for GraphQL', () => {
    expect(ts).toContain('http://localhost:4010/');
  });
  it('targets the instance Explorer port for redirect', () => {
    expect(ts).toContain('http://localhost:4210/');
  });
  it('exports an environment object', () => {
    expect(ts).toContain('export const environment =');
  });
});
