import { createPrivateKey, createPublicKey, createHash, createSign } from 'node:crypto';

/**
 * Pure, self-contained minter for an **unrestricted** MJ magic-link session JWT.
 *
 * MJ's HTTP `/magic-link/create` endpoint always stamps a single `mj_app_id`
 * (and `mj_scopes`) into the token, and the Explorer shell treats that claim as
 * a hard lock: `GetSessionScope()` returns `restrictedToApplicationId` and the
 * shell hides app-switching, dropping the user *inside* that one application
 * (see `mjexplorer-magic-link-provider.service.ts` and `shell.component.ts`).
 * That makes it impossible for a persona to see all the applications we grant
 * them — they're stuck in whichever single app the invite picked.
 *
 * Since we generate and hold the instance's magic-link signing key
 * (`MJ_MAGIC_LINK_PRIVATE_KEY`, the exact key MJServer loads), we can mint a
 * session JWT ourselves that omits `mj_app_id`/`mj_scopes`. MJServer validates
 * it through the same issuer/JWKS path (same key → same `kid`), and because the
 * token is a *named* (non-anon, no-resource-scope) magic-link, `buildMagicLink-
 * SessionUser` returns the real DB user **unchanged** — full roles, no app
 * restriction. The client then sees no `mj_app_id` and shows the full app
 * switcher. It remains a legitimately-signed magic-link session the server
 * fully accepts; it's just not artificially locked to one app.
 *
 * The signing matches `MagicLinkKeys.Sign` exactly: RS256, `kid` =
 * `sha256(spki-pem).base64url.slice(0,16)`.
 */
export interface MintSessionParams {
  /** Magic-link signing key — base64-encoded PKCS8 PEM (as stored in secrets) or raw PEM. */
  privateKey: string;
  /** Token issuer — must equal MJServer's magic-link publicUrl, e.g. `http://localhost:4030/`. */
  issuer: string;
  /** Audience — the configured magic-link audience (default `mj-magic-link`). */
  audience: string;
  /** Persona email; MJServer resolves the DB user from this claim. */
  email: string;
  firstName?: string;
  lastName?: string;
  /** Current time in epoch seconds (injected so the function stays pure/testable). */
  nowSeconds: number;
  /** Session lifetime in seconds (MJ default magic-link TTL is 8h = 28800). */
  ttlSeconds: number;
}

/** Accept either a raw PEM or the base64-of-PEM form we persist in secrets. */
function toPem(value: string): string {
  const v = value.trim();
  return v.includes('-----BEGIN') ? v : Buffer.from(v, 'base64').toString('utf8');
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/**
 * Derive the JWKS `kid` MJServer publishes for this key, so the signed token's
 * header matches the key the server will look up. Mirrors `MagicLinkKeys.computeKid`.
 */
export function computeKid(privateKey: string): string {
  const pub = createPublicKey(toPem(privateKey));
  const spki = pub.export({ type: 'spki', format: 'pem' }) as string;
  return createHash('sha256').update(spki).digest('base64url').slice(0, 16);
}

/**
 * Mint an unrestricted magic-link session JWT for a persona. Deliberately omits
 * `mj_app_id` and `mj_scopes` so the Explorer shell does not lock the session to
 * a single application.
 */
export function mintMagicLinkSessionToken(params: MintSessionParams): string {
  const pem = toPem(params.privateKey);
  const key = createPrivateKey(pem);
  const kid = computeKid(pem);
  const name = [params.firstName, params.lastName].filter(Boolean).join(' ') || undefined;

  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload: Record<string, unknown> = {
    iss: params.issuer,
    aud: params.audience,
    // Synthetic, stable subject — there is no invite row for a self-minted dev
    // session. The `magic-link|` prefix mirrors the server's `sub` shape.
    sub: `magic-link|mjdev-${params.email}`,
    iat: params.nowSeconds,
    exp: params.nowSeconds + params.ttlSeconds,
    email: params.email,
    given_name: params.firstName,
    family_name: params.lastName,
    name,
    mj_magic_link: true,
    // NO mj_app_id, NO mj_scopes -> named, unrestricted, full multi-app session.
  };

  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .end()
    .sign(key)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}
