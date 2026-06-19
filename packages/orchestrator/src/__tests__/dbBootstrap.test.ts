import { describe, it, expect } from 'vitest';
import { buildSetupScript } from '../../dist/index.js';

const sql = buildSetupScript({
  dbName: 'MJ_feature_x',
  codeGenUser: 'MJ_CodeGen',
  codeGenPassword: 'CgP@ss1',
  apiUser: 'MJ_Connect',
  apiPassword: 'ApP@ss1',
});

describe('buildSetupScript', () => {
  it('creates the database and __mj schema', () => {
    expect(sql).toContain('CREATE DATABASE [MJ_feature_x]');
    expect(sql).toContain('CREATE SCHEMA [__mj]');
  });

  it('creates distinct logins for CodeGen and API users — never sa', () => {
    expect(sql).toContain("CREATE LOGIN [MJ_CodeGen] WITH PASSWORD = 'CgP@ss1'");
    expect(sql).toContain("CREATE LOGIN [MJ_Connect] WITH PASSWORD = 'ApP@ss1'");
  });

  it('grants db_owner to CodeGen and read/write+execute to the API user', () => {
    expect(sql).toContain('ALTER ROLE db_owner ADD MEMBER [MJ_CodeGen]');
    expect(sql).toContain('ALTER ROLE db_datareader ADD MEMBER [MJ_Connect]');
    expect(sql).toContain('ALTER ROLE db_datawriter ADD MEMBER [MJ_Connect]');
    expect(sql).toContain('GRANT EXECUTE TO [MJ_Connect]');
  });

  it('is guarded for idempotency', () => {
    expect(sql).toContain('IF NOT EXISTS');
  });
});
