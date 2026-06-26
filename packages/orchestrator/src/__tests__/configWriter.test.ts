import { describe, it, expect } from 'vitest';
import dotenv from 'dotenv';
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
  it('writes least-privilege app + codegen credentials from secrets (quoted)', () => {
    expect(env).toContain('DB_USERNAME=MJ_Connect');
    expect(env).toContain('DB_PASSWORD="P@ssw0rd-Strong"');
    expect(env).toContain('CODEGEN_DB_USERNAME=MJ_CodeGen');
    expect(env).toContain('CODEGEN_DB_PASSWORD="P@ssw0rd-CodeGen"');
  });
  it('points the read-only login at the app login', () => {
    expect(env).toContain('DB_READ_ONLY_USERNAME=MJ_Connect');
  });
  it('trusts the server certificate (form mj.config.cjs accepts)', () => {
    expect(env).toContain('DB_TRUST_SERVER_CERTIFICATE=1');
  });
  it('writes the auto-generated field-level encryption key (quoted)', () => {
    expect(env).toContain(
      'MJ_BASE_ENCRYPTION_KEY="dGVzdC1lbmNyeXB0aW9uLWtleS1iYXNlNjQtMzJieXRlcw=="'
    );
  });
  it('seeds user-cache bootstrap defaults', () => {
    expect(env).toContain('UPDATE_USER_CACHE_WHEN_NOT_FOUND=1');
  });
  it('writes the system API key + magic-link signing key for local dev auth (quoted)', () => {
    expect(env).toContain('MJ_API_KEY="sys-api-key-abc123"');
    expect(env).toContain('MJ_MAGIC_LINK_PRIVATE_KEY="YmFzZTY0LXBlbS1wcml2YXRlLWtleQ=="');
  });
  it('quotes passwords so dotenv reads special chars (e.g. # ) intact — not truncated', () => {
    const hashEnv = ConfigWriter.renderEnv(record, {
      ...secrets,
      codegenPassword: 'wp%6ta6w@F_#PNqL#r%6', // contains '#': dotenv comment char
    });
    // The raw line is quoted...
    expect(hashEnv).toContain('CODEGEN_DB_PASSWORD="wp%6ta6w@F_#PNqL#r%6"');
    // ...and dotenv parses the FULL value (the bug truncated it at '#').
    const line = hashEnv.split('\n').find(l => l.startsWith('CODEGEN_DB_PASSWORD='))!;
    const parsed = dotenv.parse(line);
    expect(parsed.CODEGEN_DB_PASSWORD).toBe('wp%6ta6w@F_#PNqL#r%6');
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

describe('ConfigWriter overlay placement', () => {
  it('writes the overlay into packages/MJAPI (MJServer cwd), not the worktree root', () => {
    // cosmiconfig (searchStrategy global) stops at packages/MJAPI/mj.config.cjs
    // when MJServer searches upward, so a root-level .mjrc.cjs is never reached.
    expect(ConfigWriter.MJ_OVERLAY_FILE).toBe('packages/MJAPI/.mjrc.cjs');
  });
});

describe('ConfigWriter.renderConfigOverlay', () => {
  const cfg = ConfigWriter.renderConfigOverlay(record);
  it('spreads the untouched tracked mj.config.cjs (no clobber, no base copy)', () => {
    expect(cfg).toContain("require('./mj.config.cjs')");
    expect(cfg).toContain('...base');
    expect(cfg).not.toContain('mjdev-base');
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

describe('ConfigWriter.renderCodegenOverlay (AI-off, ADR-009)', () => {
  it('disables AI Advanced Generation by default (token-free codegen)', () => {
    const o = ConfigWriter.renderCodegenOverlay();
    expect(o).toContain("const base = require('./mj.config.cjs');");
    expect(o).toContain('...base,');
    expect(o).toContain('advancedGeneration:');
    expect(o).toContain('enableAdvancedGeneration: false');
    expect(o).not.toContain('enableAdvancedGeneration: true');
  });

  it('enables AI when explicitly opted in (the --ai path)', () => {
    const o = ConfigWriter.renderCodegenOverlay(true);
    expect(o).toContain('enableAdvancedGeneration: true');
    expect(o).not.toContain('enableAdvancedGeneration: false');
  });

  it('spreads the base config so only advancedGeneration is overridden', () => {
    const o = ConfigWriter.renderCodegenOverlay(false);
    // require('./mj.config.cjs') resolves relative to wherever the overlay lives
    // (worktree root for instance codegen, member dir for app codegen).
    expect(o).toContain("require('./mj.config.cjs')");
    expect(o).toContain('...(base.advancedGeneration || {})');
  });

  it('targets a root-level overlay filename distinct from the magic-link overlay', () => {
    expect(ConfigWriter.ROOT_OVERLAY_FILE).toBe('.mjrc.cjs');
    expect(ConfigWriter.MJ_OVERLAY_FILE).toBe('packages/MJAPI/.mjrc.cjs');
  });
});
