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
  dbUsername: 'MJ_Connect',
  dbPassword: 'P@ssw0rd-Strong',
  codegenUsername: 'MJ_CodeGen',
  codegenPassword: 'P@ssw0rd-CodeGen',
  encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS1iYXNlNjQtMzJieXRlcw==',
  systemApiKey: 'sys-api-key-abc123',
  magicLinkPrivateKey: 'YmFzZTY0LXBlbS1wcml2YXRlLWtleQ==',
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
  it('writes least-privilege app + codegen credentials from secrets', () => {
    expect(env).toContain('DB_USERNAME=MJ_Connect');
    expect(env).toContain('DB_PASSWORD=P@ssw0rd-Strong');
    expect(env).toContain('CODEGEN_DB_USERNAME=MJ_CodeGen');
    expect(env).toContain('CODEGEN_DB_PASSWORD=P@ssw0rd-CodeGen');
  });
  it('points the read-only login at the app login', () => {
    expect(env).toContain('DB_READ_ONLY_USERNAME=MJ_Connect');
  });
  it('trusts the server certificate (form mj.config.cjs accepts)', () => {
    expect(env).toContain('DB_TRUST_SERVER_CERTIFICATE=1');
  });
  it('writes the auto-generated field-level encryption key', () => {
    expect(env).toContain(
      'MJ_BASE_ENCRYPTION_KEY=dGVzdC1lbmNyeXB0aW9uLWtleS1iYXNlNjQtMzJieXRlcw=='
    );
  });
  it('seeds user-cache bootstrap defaults', () => {
    expect(env).toContain('UPDATE_USER_CACHE_WHEN_NOT_FOUND=1');
  });
  it('writes the system API key + magic-link signing key for local dev auth', () => {
    expect(env).toContain('MJ_API_KEY=sys-api-key-abc123');
    expect(env).toContain('MJ_MAGIC_LINK_PRIVATE_KEY=YmFzZTY0LXBlbS1wcml2YXRlLWtleQ==');
  });
  it('leaves the external IdP block empty (deferred)', () => {
    expect(env).toContain('WEB_CLIENT_ID=\n');
    expect(env).toContain('AUTH0_DOMAIN=\n');
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
  it('selects the self-contained magic-link auth provider', () => {
    expect(ts).toContain('"AUTH_TYPE": "magic-link"');
  });
  it('exports an environment object', () => {
    expect(ts).toContain('export const environment =');
  });
});

describe('ConfigWriter.renderMjConfig', () => {
  const cfg = ConfigWriter.renderMjConfig(record);
  it('spreads the copied tracked base config', () => {
    expect(cfg).toContain("require('./mj.config.mjdev-base.cjs')");
    expect(cfg).toContain('...base');
  });
  it('enables magic-link for the instance', () => {
    expect(cfg).toContain('enabled: true');
  });
  it('points explorerUrl at the per-instance Explorer port (not the hardcoded 4201)', () => {
    expect(cfg).toContain("explorerUrl: 'http://localhost:4210'");
    expect(cfg).not.toContain('4201');
  });
  it('grants capable dev roles and relaxes the provisioning guard', () => {
    expect(cfg).toContain('grantableRoleNames');
    expect(cfg).toContain("provisioningGuard: 'warn'");
  });
});
