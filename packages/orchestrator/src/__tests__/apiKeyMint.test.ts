import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  API_KEY_PREFIX,
  MJ_SYSTEM_USER_ID,
  generateUserApiKey,
  hashApiKey,
  buildUserUpsertSql,
  buildApiKeyInsertSql,
  newApiKeyId,
} from '../../dist/index.js';

describe('generateUserApiKey', () => {
  it('produces a key MJ would accept (mj_sk_ + 64 hex)', () => {
    const { raw } = generateUserApiKey();
    expect(raw).toMatch(/^mj_sk_[a-f0-9]{64}$/);
    expect(raw.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it('hashes the raw key with SHA-256 (hex) the way MJAPI looks it up', () => {
    const { raw, hash } = generateUserApiKey();
    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hashApiKey(raw)).toBe(hash);
  });

  it('derives a display prefix of mj_sk_ + 4 body chars', () => {
    const { raw, keyPrefix } = generateUserApiKey();
    expect(keyPrefix).toBe(raw.slice(0, API_KEY_PREFIX.length + 4));
    expect(keyPrefix).toHaveLength(API_KEY_PREFIX.length + 4);
  });

  it('generates distinct keys each call', () => {
    expect(generateUserApiKey().raw).not.toBe(generateUserApiKey().raw);
  });
});

describe('buildUserUpsertSql', () => {
  const sql = buildUserUpsertSql({
    dbName: 'MJ_feature_x',
    email: 'admin@mjdev.local',
    name: 'Admin',
    firstName: 'Ada',
    lastName: 'Min',
    roleNames: ['Developer', 'UI'],
  });

  it('targets the instance database', () => {
    expect(sql).toContain('USE [MJ_feature_x]');
  });

  it('only inserts the user when the email is absent (idempotent)', () => {
    expect(sql).toContain(
      "IF NOT EXISTS (SELECT 1 FROM [__mj].[User] WHERE [Email] = N'admin@mjdev.local')"
    );
    expect(sql).toContain('INSERT INTO [__mj].[User]');
  });

  it("defaults the user Type to 'User' without the Owner pseudo-role", () => {
    expect(sql).toContain("N'User'");
    expect(sql).not.toContain("N'Owner'");
  });

  it('grants the named roles by name, skipping already-granted ones', () => {
    expect(sql).toContain('INSERT INTO [__mj].[UserRole]');
    expect(sql).toContain("r.[Name] IN (N'Developer', N'UI')");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM [__mj].[UserRole]');
  });

  it("maps the 'Owner' pseudo-role to Type=Owner and excludes it from role grants", () => {
    const owner = buildUserUpsertSql({
      dbName: 'MJ_x',
      email: 'root@mjdev.local',
      name: 'Root',
      roleNames: ['Owner'],
    });
    expect(owner).toContain("N'Owner'");
    expect(owner).toContain('-- (no MJ role grants requested)');
  });

  it('escapes single quotes in user-supplied values', () => {
    const sql2 = buildUserUpsertSql({
      dbName: 'MJ_x',
      email: "o'brien@mjdev.local",
      name: "O'Brien",
      roleNames: [],
    });
    expect(sql2).toContain("N'o''brien@mjdev.local'");
    expect(sql2).toContain("N'O''Brien'");
  });
});

describe('buildApiKeyInsertSql', () => {
  const id = newApiKeyId();
  const sql = buildApiKeyInsertSql({
    dbName: 'MJ_feature_x',
    apiKeyId: id,
    email: 'admin@mjdev.local',
    hash: 'a'.repeat(64),
    keyPrefix: 'mj_sk_abcd',
    label: 'mjdev: admin',
  });

  it('inserts an Active key bound to the persona user, created by the system user', () => {
    expect(sql).toContain('INSERT INTO [__mj].[APIKey]');
    expect(sql).toContain(`'${id}'`);
    expect(sql).toContain("N'Active'");
    expect(sql).toContain(`'${MJ_SYSTEM_USER_ID}'`);
    expect(sql).toContain("WHERE [Email] = N'admin@mjdev.local'");
  });

  it('grants every active scope as an Include rule (keys with no scope are denied)', () => {
    expect(sql).toContain('INSERT INTO [__mj].[APIKeyScope]');
    expect(sql).toContain('FROM [__mj].[APIScope] s');
    expect(sql).toContain('WHERE s.[IsActive] = 1');
    expect(sql).toContain("N'Include'");
  });

  it('fails loudly if the persona user is missing', () => {
    expect(sql).toContain('IF @uid IS NULL THROW');
  });

  it('generates unique key ids', () => {
    expect(newApiKeyId()).not.toBe(newApiKeyId());
  });
});
