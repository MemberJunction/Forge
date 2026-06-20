import { randomBytes, generateKeyPairSync } from 'node:crypto';
import type { InstanceEvent, InstanceEventLevel } from '@mj-forge/shared';

/** A sink for streamed progress events. The GUI forwards these over IPC; the
 *  CLI prints them. Synchronous and best-effort — never throws into callers. */
export type EventSink = (event: InstanceEvent) => void;

/** No-op sink for callers that don't care about progress. */
export const noopSink: EventSink = () => {};

/** Build and emit an event to a sink, stamping the time. */
export function emit(
  sink: EventSink,
  slug: string,
  op: string,
  level: InstanceEventLevel,
  message: string
): void {
  try {
    sink({ slug, op, level, message, at: new Date().toISOString() });
  } catch {
    /* never let a misbehaving sink break orchestration */
  }
}

/** Lowercase, hyphenated, filesystem-safe slug derived from a display name. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'instance';
}

/** Short, collision-resistant id (hex). */
export function newId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Generate a base64-encoded 256-bit key for MJ field-level encryption
 * (`MJ_BASE_ENCRYPTION_KEY`). Equivalent to `openssl rand -base64 32`, the
 * command MJ's own startup validator suggests when the key is missing.
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Generate a high-entropy opaque token for the instance's system API key
 * (`MJ_API_KEY`). URL/header-safe (base64url, no padding) so it drops cleanly
 * into an `x-mj-api-key` header and a `.env` value.
 */
export function generateApiToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate an RSA-2048 key pair for signing magic-link session JWTs and return
 * the PEM private key base64-encoded, the form MJAPI expects in
 * `MJ_MAGIC_LINK_PRIVATE_KEY`. Generating it per instance keeps issued sessions
 * valid across MJAPI restarts (an unset key makes MJAPI mint an ephemeral one).
 */
export function generateRsaKeyPair(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return Buffer.from(privateKey).toString('base64');
}

/**
 * Generate a SQL-Server-acceptable strong password (>= 8 chars, 3 of 4
 * character classes). Avoids characters that are awkward in shell/.env.
 */
export function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '_-.@#%+=';
  const all = upper + lower + digits + symbols;
  const pick = (set: string, n: number) => {
    const bytes = randomBytes(n);
    let out = '';
    for (let i = 0; i < n; i++) out += set[bytes[i] % set.length];
    return out;
  };
  // Guarantee one of each class, then fill to 20 chars, then shuffle.
  const base = pick(upper, 2) + pick(lower, 2) + pick(digits, 2) + pick(symbols, 2) + pick(all, 12);
  const arr = base.split('');
  const shuffle = randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}
