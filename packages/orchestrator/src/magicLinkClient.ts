/**
 * Thin HTTP client for MJ's self-contained magic-link endpoints. We use it to
 * turn a chosen developer persona into a logged-in browser session WITHOUT any
 * external IdP:
 *
 *   1. `POST /magic-link/create` (authenticated as the system Owner via the
 *      `x-mj-api-key` header) mints a single-use invite. With no communication
 *      provider configured, MJAPI returns the raw token directly in the body.
 *   2. `POST /magic-link/redeem` exchanges that raw token for an RS256 session
 *      JWT, which the Explorer accepts at `#token=<jwt>`.
 *
 * `fetch` is injected so the flow is unit-testable without a live server.
 */

/** Minimal fetch surface we depend on (Node 18+ global, or a test double). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface CreateInviteParams {
  /** Persona email the session will belong to. */
  email: string;
  /** MJ Application the magic-link session is scoped to. */
  applicationId: string;
  /**
   * Role ID to grant (a `__mj.Role` UUID, must be grantable per the instance's
   * `grantableRoleNames`). Omit to fall back to the configured restricted role.
   * NOTE: the endpoint takes a role *ID*, not a role name.
   */
  roleId?: string;
  firstName?: string;
  lastName?: string;
}

export interface RedeemResult {
  /** The RS256 session JWT to hand the Explorer. */
  token: string;
  /** ISO-8601 expiry, when MJAPI reports it. */
  expiresAt?: string;
}

export class MagicLinkClient {
  /**
   * @param apiBase  e.g. `http://localhost:4010`
   * @param fetchFn  defaults to the global `fetch`
   */
  constructor(
    private readonly apiBase: string,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike
  ) {}

  /** Create an invite as the system Owner and return its raw token. */
  async createInvite(systemApiKey: string, params: CreateInviteParams): Promise<string> {
    const body = await this.post(
      '/magic-link/create',
      { 'content-type': 'application/json', 'x-mj-api-key': systemApiKey },
      JSON.stringify(params)
    );
    const parsed = this.parseJson(body);
    const raw = parsed.rawToken ?? parsed.token;
    if (!raw) {
      throw new Error(
        'magic-link create returned no rawToken — is a communication provider ' +
          'configured? (dev instances must leave it unset so the token is returned).'
      );
    }
    return String(raw);
  }

  /** Redeem a raw token for a session JWT. */
  async redeem(rawToken: string): Promise<RedeemResult> {
    // Use the JSON flow explicitly: `?format=json` + an application/json body.
    // Without it the endpoint 302-redirects to the Explorer URL (the browser
    // flow), which `fetch` would silently follow and return HTML instead of JSON.
    const body = await this.post(
      '/magic-link/redeem?format=json',
      { 'content-type': 'application/json' },
      JSON.stringify({ token: rawToken })
    );
    const parsed = this.parseJson(body);
    if (!parsed.token) throw new Error(`magic-link redeem returned no session token: ${body}`);
    return { token: String(parsed.token), expiresAt: parsed.expiresAt };
  }

  private async post(
    pathName: string,
    headers: Record<string, string>,
    body: string
  ): Promise<string> {
    const res = await this.fetchFn(`${this.apiBase}${pathName}`, { method: 'POST', headers, body });
    const text = await res.text();
    if (!res.ok) throw new Error(`${pathName} failed (HTTP ${res.status}): ${text}`);
    return text;
  }

  private parseJson(text: string): Record<string, string | undefined> {
    try {
      return JSON.parse(text) as Record<string, string | undefined>;
    } catch {
      throw new Error(`Expected JSON from magic-link endpoint, got: ${text.slice(0, 200)}`);
    }
  }
}
