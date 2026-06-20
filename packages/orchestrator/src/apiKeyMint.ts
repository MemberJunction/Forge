import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Pure builders for provisioning a developer persona's MJ identity inside an
 * instance database: the `__mj.User` row, its role grants, and a user API key
 * (`mj_sk_*`) the CLI/agents present via the `x-api-key` header.
 *
 * The key format and hashing mirror MJ's own `APIKeyEngine`
 * (`packages/APIKeys/Engine/src/APIKeyEngine.ts`): a `mj_sk_` prefix + 32 random
 * bytes hex, SHA-256-hashed (hex) for storage — only the hash ever touches the
 * database. SQL is emitted as idempotent scripts run as `sa` via
 * `DockerManager.execSql`, matching the style of {@link buildSetupScript}.
 */

/** Prefix MJ requires on every user API key; the validator regex is `^mj_sk_[a-f0-9]{64}$`. */
export const API_KEY_PREFIX = 'mj_sk_';

/** Random entropy for the key body, matching MJ's `DEFAULT_ENTROPY_BYTES`. */
const ENTROPY_BYTES = 32;

/** MJ's seeded system Owner user — the `CreatedByUserID` for keys we mint. */
export const MJ_SYSTEM_USER_ID = 'ECAFCCEC-6A37-EF11-86D4-000D3A4E707E';

/** A freshly generated API key: the raw secret plus its stored hash + prefix. */
export interface GeneratedApiKey {
  /** The raw `mj_sk_<64 hex>` key — shown once, never persisted server-side. */
  raw: string;
  /** SHA-256 hex of `raw`, stored in `__mj.APIKey.Hash`. */
  hash: string;
  /** `mj_sk_` + first 4 body chars, stored in `__mj.APIKey.KeyPrefix` for display. */
  keyPrefix: string;
}

/** Generate a new user API key (raw + hash + display prefix). */
export function generateUserApiKey(): GeneratedApiKey {
  const body = randomBytes(ENTROPY_BYTES).toString('hex'); // 64 hex chars
  const raw = `${API_KEY_PREFIX}${body}`;
  return { raw, hash: hashApiKey(raw), keyPrefix: raw.slice(0, API_KEY_PREFIX.length + 4) };
}

/** SHA-256 (hex) of a raw key — the value MJAPI looks up in `__mj.APIKey.Hash`. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Escape a string for safe inclusion in a single-quoted T-SQL literal. */
function sqlStr(value: string): string {
  return value.replace(/'/g, "''");
}

export interface UserUpsertParams {
  /** Target instance database (e.g. `MJ_feature_x`). */
  dbName: string;
  /** Persona email — the unique key for the `__mj.User` row. */
  email: string;
  /** Display name for the user. */
  name: string;
  firstName?: string;
  lastName?: string;
  /**
   * MJ role names to grant. The pseudo-role `Owner` is mapped to the user's
   * `Type` (a superuser) rather than a `__mj.Role` membership; all other names
   * are resolved against `__mj.Role` by name.
   */
  roleNames: string[];
}

/**
 * Idempotent SQL that ensures the persona's `__mj.User` exists (by email) and
 * has the requested role grants. Safe to re-run. Resolves `RoleID`s by name, so
 * unknown role names are silently skipped rather than failing the script.
 */
export function buildUserUpsertSql(p: UserUpsertParams): string {
  const { dbName, email } = p;
  const type = p.roleNames.includes('Owner') ? 'Owner' : 'User';
  const realRoles = p.roleNames.filter(r => r !== 'Owner');
  const nameNull = (v?: string) => (v && v.trim() ? `N'${sqlStr(v)}'` : 'NULL');
  const roleInList = realRoles.map(r => `N'${sqlStr(r)}'`).join(', ');

  return `-- MJ Dev Manager: ensure persona user + roles (idempotent)
USE [${dbName}];
GO

IF NOT EXISTS (SELECT 1 FROM [__mj].[User] WHERE [Email] = N'${sqlStr(email)}')
BEGIN
    INSERT INTO [__mj].[User]
        ([ID],[Name],[FirstName],[LastName],[Email],[Type],[IsActive],[LinkedRecordType],[__mj_CreatedAt],[__mj_UpdatedAt])
    VALUES
        (NEWID(), N'${sqlStr(p.name)}', ${nameNull(p.firstName)}, ${nameNull(p.lastName)},
         N'${sqlStr(email)}', N'${type}', 1, N'None', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());
    PRINT 'Created user: ${sqlStr(email)} (${type})';
END
ELSE
BEGIN
    UPDATE [__mj].[User] SET [Type] = N'${type}', [IsActive] = 1 WHERE [Email] = N'${sqlStr(email)}';
END
GO
${
  realRoles.length === 0
    ? '-- (no MJ role grants requested)'
    : `INSERT INTO [__mj].[UserRole] ([ID],[UserID],[RoleID],[__mj_CreatedAt],[__mj_UpdatedAt])
SELECT NEWID(), u.[ID], r.[ID], SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
FROM [__mj].[User] u
CROSS JOIN [__mj].[Role] r
WHERE u.[Email] = N'${sqlStr(email)}'
  AND r.[Name] IN (${roleInList})
  AND NOT EXISTS (SELECT 1 FROM [__mj].[UserRole] ur WHERE ur.[UserID] = u.[ID] AND ur.[RoleID] = r.[ID]);`
}
GO
`;
}

export interface ApiKeyInsertParams {
  /** Target instance database. */
  dbName: string;
  /** Pre-generated GUID for the `__mj.APIKey` row (so the caller can record it). */
  apiKeyId: string;
  /** Persona email — the key is bound to this user. */
  email: string;
  /** SHA-256 hex hash of the raw key. */
  hash: string;
  /** Display prefix (`mj_sk_xxxx`). */
  keyPrefix: string;
  /** Human label for the key. */
  label: string;
}

/**
 * SQL that inserts a user API key for the persona and grants it every active
 * API scope (`Include`, no resource pattern) so it behaves like a full
 * developer session. Keys with no scopes are denied by default, so the scope
 * grant is required. Assumes the persona user already exists (see
 * {@link buildUserUpsertSql}).
 */
export function buildApiKeyInsertSql(p: ApiKeyInsertParams): string {
  const { dbName, apiKeyId, email, hash, keyPrefix, label } = p;
  return `-- MJ Dev Manager: insert user API key + grant all active scopes
USE [${dbName}];
GO

DECLARE @uid UNIQUEIDENTIFIER = (SELECT [ID] FROM [__mj].[User] WHERE [Email] = N'${sqlStr(email)}');
IF @uid IS NULL THROW 50000, 'Persona user not found; run the user upsert first.', 1;

INSERT INTO [__mj].[APIKey]
    ([ID],[Hash],[UserID],[Label],[Status],[KeyPrefix],[CreatedByUserID],[__mj_CreatedAt],[__mj_UpdatedAt])
VALUES
    ('${apiKeyId}', N'${sqlStr(hash)}', @uid, N'${sqlStr(label)}', N'Active', N'${sqlStr(keyPrefix)}',
     '${MJ_SYSTEM_USER_ID}', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());

INSERT INTO [__mj].[APIKeyScope]
    ([ID],[APIKeyID],[ScopeID],[ResourcePattern],[PatternType],[IsDeny],[Priority],[__mj_CreatedAt],[__mj_UpdatedAt])
SELECT NEWID(), '${apiKeyId}', s.[ID], NULL, N'Include', 0, 0, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
FROM [__mj].[APIScope] s
WHERE s.[IsActive] = 1;

PRINT 'Inserted API key ${apiKeyId} for ${sqlStr(email)}';
GO
`;
}

/** Generate a GUID for a new API key row. */
export function newApiKeyId(): string {
  return randomUUID();
}
