import { describe, it, expect } from 'vitest';
import { MagicLinkClient } from '../../dist/index.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Build a fetch double that records calls and returns scripted responses. */
function stubFetch(responses: Record<string, { ok?: boolean; status?: number; body: string }>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: Call) => {
    calls.push({ url, ...init });
    const pathName = new URL(url).pathname;
    const r = responses[pathName];
    if (!r) throw new Error(`no stub for ${pathName}`);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => r.body,
    };
  };
  return { fetchFn, calls };
}

describe('MagicLinkClient.createInvite', () => {
  it('posts the invite as the system Owner and returns the raw token', async () => {
    const { fetchFn, calls } = stubFetch({
      '/magic-link/create': { body: JSON.stringify({ success: true, rawToken: 'mj_ml_raw' }) },
    });
    const client = new MagicLinkClient('http://localhost:4010', fetchFn as never);
    const token = await client.createInvite('sys-key', {
      email: 'admin@mjdev.local',
      applicationId: 'app-1',
      role: 'Developer',
    });
    expect(token).toBe('mj_ml_raw');
    expect(calls[0].url).toBe('http://localhost:4010/magic-link/create');
    expect(calls[0].headers['x-mj-api-key']).toBe('sys-key');
    expect(JSON.parse(calls[0].body)).toMatchObject({
      email: 'admin@mjdev.local',
      applicationId: 'app-1',
      role: 'Developer',
    });
  });

  it('errors clearly when no rawToken is returned (email provider misconfigured)', async () => {
    const { fetchFn } = stubFetch({
      '/magic-link/create': { body: JSON.stringify({ success: true, emailSent: true }) },
    });
    const client = new MagicLinkClient('http://localhost:4010', fetchFn as never);
    await expect(
      client.createInvite('sys-key', { email: 'a@b.c', applicationId: 'app-1' })
    ).rejects.toThrow(/no rawToken/);
  });

  it('surfaces HTTP failures with the response body', async () => {
    const { fetchFn } = stubFetch({
      '/magic-link/create': { ok: false, status: 403, body: 'forbidden' },
    });
    const client = new MagicLinkClient('http://localhost:4010', fetchFn as never);
    await expect(
      client.createInvite('sys-key', { email: 'a@b.c', applicationId: 'app-1' })
    ).rejects.toThrow(/HTTP 403.*forbidden/);
  });
});

describe('MagicLinkClient.redeem', () => {
  it('form-encodes the token and returns the session JWT', async () => {
    const { fetchFn, calls } = stubFetch({
      '/magic-link/redeem': {
        body: JSON.stringify({
          success: true,
          token: 'jwt.abc.def',
          expiresAt: '2026-06-21T00:00:00Z',
        }),
      },
    });
    const client = new MagicLinkClient('http://localhost:4010', fetchFn as never);
    const result = await client.redeem('mj_ml_raw');
    expect(result.token).toBe('jwt.abc.def');
    expect(result.expiresAt).toBe('2026-06-21T00:00:00Z');
    expect(calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0].body).toBe('token=mj_ml_raw');
  });
});
