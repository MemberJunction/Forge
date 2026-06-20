import type { DevPersona, InstanceRecord, InstanceSecrets } from '@mj-forge/shared';
import type { InstanceStore } from './InstanceStore.js';
import type { PersonaStore } from './PersonaStore.js';
import type { DockerManager } from './DockerManager.js';
import { MagicLinkClient } from './magicLinkClient.js';
import {
  buildUserUpsertSql,
  buildApiKeyInsertSql,
  generateUserApiKey,
  newApiKeyId,
} from './apiKeyMint.js';
import { emit, type EventSink, noopSink } from './util.js';

/**
 * Turns a developer persona into a usable MJ identity on a given instance:
 *   - {@link mintApiKey} provisions the persona's `__mj.User` + a `mj_sk_*` key
 *     for non-interactive CLI/agent access (works against the DB directly).
 *   - {@link openExplorerAs} mints a magic-link session and returns a browser
 *     URL that lands logged in (requires MJAPI to be running).
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

  /** Ensure the persona's MJ user exists with its role grants (idempotent). */
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
    await this.ensureUser(record, persona, sink);
    const secrets = await this.requireSecrets(record);
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
   * Mint a magic-link session for the persona and return an Explorer URL that
   * lands logged in (`#token=<jwt>`). Requires MJAPI to be running on the
   * instance's API port and the instance config to carry `MJ_API_KEY`.
   */
  async openExplorerAs(
    record: InstanceRecord,
    persona: DevPersona,
    sink: EventSink = noopSink
  ): Promise<string> {
    await this.ensureUser(record, persona, sink);
    const secrets = await this.requireSecrets(record);
    if (!secrets.systemApiKey) {
      throw new Error(
        'Instance has no MJ_API_KEY (system key). Regenerate its config so magic-link can be issued.'
      );
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

    emit(
      sink,
      record.slug,
      'identity',
      'progress',
      `Issuing magic-link session for ${persona.email}…`
    );
    const client = new MagicLinkClient(`http://localhost:${record.ports.api}`);
    const role = persona.roles.find(r => r !== 'Owner') ?? 'Developer';
    const rawToken = await client.createInvite(secrets.systemApiKey, {
      email: persona.email,
      applicationId: appId,
      role,
      firstName: persona.firstName,
      lastName: persona.lastName,
    });
    const { token } = await client.redeem(rawToken);
    emit(sink, record.slug, 'identity', 'success', `Magic-link session ready for ${persona.email}`);
    return `http://localhost:${record.ports.explorer}/#token=${token}`;
  }

  private async requireSecrets(record: InstanceRecord): Promise<InstanceSecrets> {
    const secrets = await this.store.getSecrets(record.secretsRef);
    if (!secrets) throw new Error(`No secrets found for instance "${record.slug}"`);
    return secrets;
  }
}
