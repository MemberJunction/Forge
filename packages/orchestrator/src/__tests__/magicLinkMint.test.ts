import { describe, it, expect } from 'vitest';
import { createPublicKey, createVerify, createHash } from 'node:crypto';
import { mintMagicLinkSessionToken, computeKid } from '../../dist/index.js';

// A deterministic RSA-2048 key (base64 PKCS8 PEM, the form secrets store) so the
// tests don't depend on key generation. Generated once for this suite.
import { generateKeyPairSync } from 'node:crypto';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const keyB64 = Buffer.from(privateKey as string).toString('base64');

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('mintMagicLinkSessionToken', () => {
  const token = mintMagicLinkSessionToken({
    privateKey: keyB64,
    issuer: 'http://localhost:4030/',
    audience: 'mj-magic-link',
    email: 'viewer@mjdev.local',
    firstName: 'Guest',
    nowSeconds: 1_000_000,
    ttlSeconds: 28_800,
  });
  const [headerB64, payloadB64, sigB64] = token.split('.');
  const header = decode(headerB64);
  const payload = decode(payloadB64);

  it('produces a three-part compact JWT', () => {
    expect(token.split('.')).toHaveLength(3);
  });

  it('OMITS mj_app_id and mj_scopes so the shell does not lock to one app', () => {
    expect(payload).not.toHaveProperty('mj_app_id');
    expect(payload).not.toHaveProperty('mj_scopes');
  });

  it('marks it a magic-link session with the persona email and timing', () => {
    expect(payload.mj_magic_link).toBe(true);
    expect(payload.email).toBe('viewer@mjdev.local');
    expect(payload.iss).toBe('http://localhost:4030/');
    expect(payload.aud).toBe('mj-magic-link');
    expect(payload.iat).toBe(1_000_000);
    expect(payload.exp).toBe(1_028_800);
  });

  it('signs RS256 with the kid the server derives from the key', () => {
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
    expect(header.kid).toBe(computeKid(keyB64));
  });

  it('produces a signature that verifies against the public half of the key', () => {
    const pub = createPublicKey({ key: privateKey as string });
    const ok = createVerify('RSA-SHA256')
      .update(`${headerB64}.${payloadB64}`)
      .verify(pub, Buffer.from(sigB64, 'base64url'));
    expect(ok).toBe(true);
  });

  it('computeKid matches MagicLinkKeys: sha256(spki-pem).base64url.slice(0,16)', () => {
    const spki = createPublicKey({ key: privateKey as string }).export({
      type: 'spki',
      format: 'pem',
    }) as string;
    const expected = createHash('sha256').update(spki).digest('base64url').slice(0, 16);
    expect(computeKid(keyB64)).toBe(expected);
  });

  it('accepts raw PEM as well as base64-of-PEM', () => {
    const fromRaw = mintMagicLinkSessionToken({
      privateKey: privateKey as string,
      issuer: 'http://localhost:4030/',
      audience: 'mj-magic-link',
      email: 'viewer@mjdev.local',
      firstName: 'Guest',
      nowSeconds: 1_000_000,
      ttlSeconds: 28_800,
    });
    // Same key + same claims + same time → identical token regardless of input encoding.
    expect(fromRaw).toBe(token);
  });
});
