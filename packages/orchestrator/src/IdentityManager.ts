import type { AppAccessEntry, DevPersona, InstanceRecord, InstanceSecrets } from '@mj-forge/shared';
import type { InstanceStore } from './InstanceStore.js';
import type { PersonaStore } from './PersonaStore.js';
import type { DockerManager } from './DockerManager.js';
import { MagicLinkClient } from './magicLinkClient.js';
import { mintMagicLinkSessionToken } from './magicLinkMint.js';
import {
  buildUserUpsertSql,
  buildApiKeyInsertSql,
  buildUserApplicationsSyncSql,
  generateUserApiKey,
  newApiKeyId,
} from './apiKeyMint.js';
import { emit, type EventSink, noopSink } from './util.js';

/**
 * Turns a developer persona into a usable MJ identity on a given instance:
 *   - {@link mintApiKey} provisions the persona's `__mj.User` + a `mj_sk_*` key
 *     for non-interactive CLI/agent access.
 *   - {@link openExplorerAs} mints a magic-link session and returns a browser
 *     URL that lands logged in (requires MJAPI to be running).
 *
 * **Why user creation goes through magic-link.** MJAPI keeps an in-memory
 * `UserCache` (loaded at boot, auto-refresh disabled by default). Magic-link's
 * own provisioning seeds that cache when it creates a user, so it can later
 * find + link the same user instead of trying to INSERT a duplicate. If we
 * created the user out-of-band via `sqlcmd` while MJAPI was running, the row
 * would be invisible to the live cache and the next magic-link redeem would
 * hit a `UQ_User_Email` violation. So both paths provision the user through
 * magic-link (cache-consistent), then upgrade its Type/roles via SQL to match
 * the full persona (API-key auth reads the DB fresh, so it sees the upgrade).
 *
 * Both honor the per-instance persona override via {@link resolvePersona}, so a
 * single instance can be driven as a different user from the global default.
 */
export class IdentityManager {
  constructor(
    private readonly store: InstanceStore,
    private readonly personas: PersonaStore,
    private readonly docker: DockerManager
  ) {}

  /**
   * The persona an instance should act as: its per-instance override
   * ({@link InstanceRecord.personaId}) when set and still present, else the
   * globally active persona. Throws when the roster is empty.
   */
  async resolvePersona(record: InstanceRecord): Promise<DevPersona> {
    if (record.personaId) {
      const override = await this.personas.get(record.personaId);
      if (override) return override;
    }
    const active = await this.personas.getActive();
    if (!active) {
      throw new Error(
        'No developer persona is configured. Create one and set it active ' +
          '(e.g. `mjdev persona add`).'
      );
    }
    return active;
  }

  /**
   * Ensure the persona's MJ user exists with its role grants, and reconcile its
   * app access — granting every active Application except the persona's
   * `disabledAppNames` (default-on). Idempotent; safe to re-run. Uses direct SQL,
   * so it works whether or not MJAPI is running.
   */
  async ensureUser(
    record: InstanceRecord,
    persona: DevPersona,
    sink: EventSink = noopSink
  ): Promise<void> {
    const secrets = await this.requireSecrets(record);
    emit(sink, record.slug, 'identity', 'progress', `Ensuring user ${persona.email}…`);
    await this.docker.execSql(
      record.container.name,
      secrets.saPassword,
      buildUserUpsertSql({
        dbName: record.dbName,
        email: persona.email,
        name: persona.name,
        firstName: persona.firstName,
        lastName: persona.lastName,
        roleNames: persona.roles,
      }),
      record.slug,
      sink
    );
    await this.docker.execSql(
      record.container.name,
      secrets.saPassword,
      buildUserApplicationsSyncSql({
        dbName: record.dbName,
        email: persona.email,
        disabledAppNames: persona.disabledAppNames ?? [],
      }),
      record.slug,
      sink
    );
  }

  /**
   * List every active MJ Application on the instance with the persona's current
   * access state. `granted` is derived from the persona's `disabledAppNames`
   * (the durable source of truth), so it is correct even before the user has
   * been provisioned into the instance DB.
   */
  async listApps(record: InstanceRecord, persona: DevPersona): Promise<AppAccessEntry[]> {
    const secrets = await this.requireSecrets(record);
    const names = await this.docker.queryColumn(
      record.container.name,
      secrets.saPassword,
      `SET NOCOUNT ON; SELECT a.[Name] FROM [${record.dbName}].[__mj].[Application] a ` +
        `WHERE a.[Status] = N'Active' ORDER BY a.[DefaultSequence], a.[Name];`
    );
    const disabled = new Set(persona.disabledAppNames ?? []);
    return names.map(name => ({ name, granted: !disabled.has(name) }));
  }

  /**
   * Toggle one app's access for the persona: update the persona's durable
   * `disabledAppNames`, then re-sync the instance DB so the change takes effect
   * immediately (flipping `__mj.UserApplication.IsActive`, the same mechanism MJ
   * uses for a user-disabled app). Returns the refreshed app list. The change is
   * persisted on the persona, so it also applies to other instances on their
   * next provision and survives re-provisioning a disposable instance DB.
   */
  async setAppAccess(
    record: InstanceRecord,
    persona: DevPersona,
    appName: string,
    granted: boolean,
    sink: EventSink = noopSink
  ): Promise<AppAccessEntry[]> {
    const disabled = new Set(persona.disabledAppNames ?? []);
    if (granted) disabled.delete(appName);
    else disabled.add(appName);
    const updated = await this.personas.save({ ...persona, disabledAppNames: [...disabled] });
    await this.ensureUser(record, updated, sink);
    return this.listApps(record, updated);
  }

  /**
   * Return a `mj_sk_*` API key for the persona on this instance, minting (and
   * persisting) one if needed. Reused across the session unless `force` is set.
   */
  async mintApiKey(
    record: InstanceRecord,
    persona: DevPersona,
    sink: EventSink = noopSink,
    force = false
  ): Promise<string> {
    if (!force) {
      const existing = await this.store.getMintedKey(record.secretsRef, persona.id);
      if (existing) return existing.rawKey;
    }
    const secrets = await this.requireSecrets(record);
    // Provision the user cache-consistently through magic-link when MJAPI is
    // reachable, so a later "Open Explorer as" won't collide on a stale cache.
    // If MJAPI isn't up, fall back to a direct SQL upsert — that's safe because
    // MJAPI will pick the row up in its boot-time cache the next time it starts.
    await this.provisionUser(record, persona, secrets, sink);
    const key = generateUserApiKey();
    const apiKeyId = newApiKeyId();
    emit(sink, record.slug, 'identity', 'progress', `Minting API key for ${persona.email}…`);
    await this.docker.execSql(
      record.container.name,
      secrets.saPassword,
      buildApiKeyInsertSql({
        dbName: record.dbName,
        apiKeyId,
        email: persona.email,
        hash: key.hash,
        keyPrefix: key.keyPrefix,
        label: `mjdev: ${persona.name}`,
      }),
      record.slug,
      sink
    );
    await this.store.setMintedKey(record.secretsRef, persona.id, {
      rawKey: key.raw,
      apiKeyId,
      mintedAt: new Date().toISOString(),
    });
    emit(sink, record.slug, 'identity', 'success', `API key ready for ${persona.email}`);
    return key.raw;
  }

  /**
   * Mint a full-access local dev session for the persona and return an Explorer
   * URL that lands logged in (`#token=<jwt>`). MJAPI must be running on the
   * instance's API port to *use* the URL (it serves the Explorer and validates
   * the token), but minting itself is offline — we sign the session with the
   * instance's own magic-link key.
   *
   * Why we sign it ourselves instead of calling MJ's `/magic-link/create`:
   * that endpoint always scopes an invite to a single Application and stamps
   * `mj_app_id` into the token, which the Explorer shell treats as a hard UI
   * lock — it hides app-switching and traps the session inside that one app, so
   * the persona can never see the other applications we grant them. MJ's only
   * self-contained local browser login is magic-link (real-IdP login is
   * deferred), and the official flow has no "all-apps" invite. Server-side a
   * named magic-link session is NOT app-restricted (`buildMagicLinkSessionUser`
   * returns the real DB user unchanged), so we mint an unrestricted session JWT
   * with the same signing key — the local-issuer equivalent of a normal full
   * IdP login. See {@link mintMagicLinkSessionToken} for the security rationale.
   */
  async openExplorerAs(
    record: InstanceRecord,
    persona: DevPersona,
    sink: EventSink = noopSink
  ): Promise<string> {
    const secrets = await this.requireSecrets(record);
    if (!secrets.magicLinkPrivateKey) {
      throw new Error(
        'Instance has no MJ_MAGIC_LINK_PRIVATE_KEY (session signing key). Regenerate its config so a session can be minted.'
      );
    }
    // Ensure the DB user exists with the full persona (Type/roles) and the
    // granted application set, so the session resolves to the right identity and
    // the Explorer loads every app we expect. Uses direct SQL (no MJAPI needed);
    // MJAPI loads the row into its cache on first request (UPDATE_USER_CACHE_*).
    await this.ensureUser(record, persona, sink);
    // Sign a full-access session locally (no mj_app_id → no single-app lock).
    const token = mintMagicLinkSessionToken({
      privateKey: secrets.magicLinkPrivateKey,
      issuer: `http://localhost:${record.ports.api}/`,
      audience: 'mj-magic-link',
      email: persona.email,
      firstName: persona.firstName,
      lastName: persona.lastName,
      nowSeconds: Math.floor(Date.now() / 1000),
      ttlSeconds: 8 * 60 * 60,
    });
    emit(
      sink,
      record.slug,
      'identity',
      'success',
      `Full-access session ready for ${persona.email}`
    );
    return `http://localhost:${record.ports.explorer}/#token=${token}`;
  }

  /**
   * Ensure the persona user exists cache-consistently. Prefers magic-link
   * provisioning (which seeds MJAPI's UserCache); on any failure — typically
   * MJAPI not running — falls back to a direct SQL upsert, which is safe because
   * MJAPI loads the row into its cache on its next boot. Always finishes with a
   * SQL upsert so the user's Type/roles match the full persona.
   */
  private async provisionUser(
    record: InstanceRecord,
    persona: DevPersona,
    secrets: InstanceSecrets,
    sink: EventSink
  ): Promise<void> {
    if (secrets.systemApiKey) {
      try {
        await this.provisionViaMagicLink(record, persona, secrets, sink);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit(
          sink,
          record.slug,
          'identity',
          'warn',
          `Magic-link provisioning unavailable (${msg}); falling back to direct DB upsert.`
        );
      }
    }
    await this.ensureUser(record, persona, sink);
  }

  /**
   * Create + redeem a magic-link invite for the persona, returning the session
   * JWT. The redeem is what provisions the user in MJAPI (creating + caching it
   * if new, linking if it already exists). Requires MJAPI to be running.
   */
  private async provisionViaMagicLink(
    record: InstanceRecord,
    persona: DevPersona,
    secrets: InstanceSecrets,
    sink: EventSink
  ): Promise<string> {
    if (!secrets.systemApiKey) {
      throw new Error('Instance has no MJ_API_KEY (system key).');
    }
    const appId = await this.docker.queryScalar(
      record.container.name,
      secrets.saPassword,
      `SET NOCOUNT ON; SELECT TOP 1 CAST([ID] AS NVARCHAR(36)) FROM [${record.dbName}].[__mj].[Application] ` +
        `ORDER BY CASE WHEN [DefaultForNewUser] = 1 THEN 0 ELSE 1 END, [Name];`
    );
    if (!appId) {
      throw new Error('No MJ Application found — has the instance been migrated?');
    }
    // The create endpoint takes a role *ID*, not a name, and the role must be
    // grantable (see ConfigWriter's generated grantableRoleNames). Map the
    // persona's first grantable role (default "Developer") to its Role ID.
    const roleId = await this.resolveGrantableRoleId(record, secrets.saPassword, persona);

    emit(
      sink,
      record.slug,
      'identity',
      'progress',
      `Issuing magic-link session for ${persona.email}…`
    );
    const client = new MagicLinkClient(`http://localhost:${record.ports.api}`);
    const rawToken = await client.createInvite(secrets.systemApiKey, {
      email: persona.email,
      applicationId: appId,
      roleId,
      firstName: persona.firstName,
      lastName: persona.lastName,
    });
    const { token } = await client.redeem(rawToken);
    return token;
  }

  /** Roles magic-link is configured to grant (mirrors ConfigWriter.renderMjConfig). */
  private static readonly GRANTABLE_ROLES = ['Developer', 'UI', 'Integration'];

  /**
   * Resolve the Role ID for the persona's first grantable role (falling back to
   * "Developer"), or undefined if it isn't seeded — in which case magic-link
   * uses its configured restricted role.
   */
  private async resolveGrantableRoleId(
    record: InstanceRecord,
    saPassword: string,
    persona: DevPersona
  ): Promise<string | undefined> {
    const roleName =
      persona.roles.find(r => IdentityManager.GRANTABLE_ROLES.includes(r)) ?? 'Developer';
    return this.docker.queryScalar(
      record.container.name,
      saPassword,
      `SET NOCOUNT ON; SELECT TOP 1 CAST([ID] AS NVARCHAR(36)) FROM [${record.dbName}].[__mj].[Role] ` +
        `WHERE [Name] = N'${roleName.replace(/'/g, "''")}';`
    );
  }

  private async requireSecrets(record: InstanceRecord): Promise<InstanceSecrets> {
    const secrets = await this.store.getSecrets(record.secretsRef);
    if (!secrets) throw new Error(`No secrets found for instance "${record.slug}"`);
    return secrets;
  }
}
