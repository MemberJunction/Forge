/**
 * Builds the idempotent SQL that provisions an instance's database, logins,
 * users, and role grants — mirroring MJ's own installer
 * (MJInstaller `DatabaseProvisionPhase`). Run once as `sa` against a freshly
 * created container; safe to re-run.
 *
 * Credential model (NEVER point app credentials at `sa`):
 *   - CodeGen user → its own login + `db_owner` (DDL for migrate/codegen)
 *   - API/Connect user → its own login + `db_datareader` + `db_datawriter` + EXECUTE
 */
export interface DbSetupParams {
  dbName: string;
  codeGenUser: string;
  codeGenPassword: string;
  apiUser: string;
  apiPassword: string;
}

export function buildSetupScript(p: DbSetupParams): string {
  const { dbName, codeGenUser, codeGenPassword, apiUser, apiPassword } = p;
  return `-- MJ Dev Manager database setup (idempotent)
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = '${dbName}')
BEGIN
    CREATE DATABASE [${dbName}];
    PRINT 'Created database: ${dbName}';
END
GO

USE [${dbName}];
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '__mj')
BEGIN
    EXEC('CREATE SCHEMA [__mj]');
    PRINT 'Created schema: __mj';
END
GO

USE [master];
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '${codeGenUser}')
BEGIN
    CREATE LOGIN [${codeGenUser}] WITH PASSWORD = '${codeGenPassword}';
    PRINT 'Created login: ${codeGenUser}';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '${apiUser}')
BEGIN
    CREATE LOGIN [${apiUser}] WITH PASSWORD = '${apiPassword}';
    PRINT 'Created login: ${apiUser}';
END
GO

USE [${dbName}];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${codeGenUser}')
BEGIN
    CREATE USER [${codeGenUser}] FOR LOGIN [${codeGenUser}];
    PRINT 'Created user: ${codeGenUser}';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${apiUser}')
BEGIN
    CREATE USER [${apiUser}] FOR LOGIN [${apiUser}];
    PRINT 'Created user: ${apiUser}';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_role_members rm
    JOIN sys.database_principals rp ON rm.role_principal_id = rp.principal_id
    JOIN sys.database_principals mp ON rm.member_principal_id = mp.principal_id
    WHERE rp.name = 'db_owner' AND mp.name = '${codeGenUser}')
BEGIN
    ALTER ROLE db_owner ADD MEMBER [${codeGenUser}];
    PRINT 'Granted db_owner to ${codeGenUser}';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_role_members rm
    JOIN sys.database_principals rp ON rm.role_principal_id = rp.principal_id
    JOIN sys.database_principals mp ON rm.member_principal_id = mp.principal_id
    WHERE rp.name = 'db_datareader' AND mp.name = '${apiUser}')
BEGIN
    ALTER ROLE db_datareader ADD MEMBER [${apiUser}];
    PRINT 'Granted db_datareader to ${apiUser}';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_role_members rm
    JOIN sys.database_principals rp ON rm.role_principal_id = rp.principal_id
    JOIN sys.database_principals mp ON rm.member_principal_id = mp.principal_id
    WHERE rp.name = 'db_datawriter' AND mp.name = '${apiUser}')
BEGIN
    ALTER ROLE db_datawriter ADD MEMBER [${apiUser}];
    PRINT 'Granted db_datawriter to ${apiUser}';
END
GO

GRANT EXECUTE TO [${apiUser}];
GO

PRINT '=== MJ Dev Manager database setup complete: ${dbName} ===';
`;
}

/**
 * Builds the SQL to drop a single instance's database from the shared server —
 * used on instance delete and on create-rollback. Forces SINGLE_USER first to
 * kill any lingering connections (the API/Explorer may have open pools), then
 * drops. The shared least-privilege LOGINS are intentionally left in place:
 * they are server-level and shared by every other instance's database. The
 * per-database USERS vanish with the database. Idempotent (guarded by EXISTS).
 */
export function buildDropDatabaseScript(dbName: string): string {
  return `-- MJ Dev Manager database teardown (idempotent)
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = '${dbName}')
BEGIN
    ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${dbName}];
    PRINT 'Dropped database: ${dbName}';
END
GO
`;
}
