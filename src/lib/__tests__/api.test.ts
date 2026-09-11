import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountDeletionApi } from '../api';
import type { ApiConfig } from '../config';

const config: ApiConfig = {
  baseUrl: 'https://api.kadence.test',
  requestPath: '/website/auth/account-deletion/request',
  confirmPath: '/website/auth/account-deletion/confirm',
  timeoutMs: 1_000,
};

const TOKEN = 'a1b2c3d4e5f6789012345678901234567890abcd';
const EMAIL = 'someone@example.com';

/** Minimal stand-in for a Response; the client only reads `.status`. */
function statusResponse(status: number): Response {
  return { status } as Response;
}

function mockFetch(status: number) {
  const fetchMock = vi.fn(async () => statusResponse(status));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestAccountDeletion', () => {
  it('reports success for a 2xx response', async () => {
    mockFetch(200);
    const api = createAccountDeletionApi(config);

    await expect(api.requestAccountDeletion(EMAIL)).resolves.toEqual({
      ok: true,
    });
  });

  it('classifies a 400 as invalid_input (the UI neutralises it)', async () => {
    mockFetch(400);
    const api = createAccountDeletionApi(config);

    await expect(api.requestAccountDeletion(EMAIL)).resolves.toEqual({
      ok: false,
      reason: 'invalid_input',
    });
  });

  it('classifies 429 as rate_limited', async () => {
    mockFetch(429);
    const api = createAccountDeletionApi(config);

    await expect(api.requestAccountDeletion(EMAIL)).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
    });
  });

  it('classifies 5xx as unavailable', async () => {
    mockFetch(503);
    const api = createAccountDeletionApi(config);

    await expect(api.requestAccountDeletion(EMAIL)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('classifies a rejected fetch as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const api = createAccountDeletionApi(config);

    await expect(api.requestAccountDeletion(EMAIL)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('posts the email in the body and never in the URL', async () => {
    const fetchMock = mockFetch(200);
    const api = createAccountDeletionApi(config);

    await api.requestAccountDeletion(EMAIL);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.kadence.test/website/auth/account-deletion/request',
    );
    expect(url).not.toContain(EMAIL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ email: EMAIL });
  });

  it('does not attach cookies or follow redirects', async () => {
    const fetchMock = mockFetch(200);
    const api = createAccountDeletionApi(config);

    await api.requestAccountDeletion(EMAIL);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('refuses to call an unconfigured API', async () => {
    const fetchMock = mockFetch(200);
    const api = createAccountDeletionApi({ ...config, baseUrl: '' });

    await expect(api.requestAccountDeletion(EMAIL)).resolves.toEqual({
      ok: false,
      reason: 'misconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call an insecure non-loopback API', async () => {
    const fetchMock = mockFetch(200);
    const api = createAccountDeletionApi({
      ...config,
      baseUrl: 'http://api.kadence.test',
    });

    await expect(api.requestAccountDeletion(EMAIL)).resolves.toEqual({
      ok: false,
      reason: 'misconfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('confirmAccountDeletion', () => {
  it('posts the token in the body and never in the URL', async () => {
    const fetchMock = mockFetch(200);
    const api = createAccountDeletionApi(config);

    await expect(api.confirmAccountDeletion(TOKEN)).resolves.toEqual({
      ok: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.kadence.test/website/auth/account-deletion/confirm',
    );
    expect(url).not.toContain(TOKEN);
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
  });

  it('classifies 400/401/403/404/410 as an invalid token', async () => {
    for (const status of [400, 401, 403, 404, 410, 422]) {
      mockFetch(status);
      const api = createAccountDeletionApi(config);

      await expect(api.confirmAccountDeletion(TOKEN), String(status)).resolves.toEqual(
        { ok: false, reason: 'invalid_token' },
      );
    }
  });

  it('classifies 429 as rate_limited and 5xx as unavailable', async () => {
    mockFetch(429);
    await expect(
      createAccountDeletionApi(config).confirmAccountDeletion(TOKEN),
    ).resolves.toEqual({ ok: false, reason: 'rate_limited' });

    mockFetch(500);
    await expect(
      createAccountDeletionApi(config).confirmAccountDeletion(TOKEN),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('classifies a network failure as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(
      createAccountDeletionApi(config).confirmAccountDeletion(TOKEN),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('credential hygiene', () => {
  it('never logs the email address or the deletion token', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    mockFetch(500);
    const api = createAccountDeletionApi(config);

    await api.requestAccountDeletion(EMAIL);
    await api.confirmAccountDeletion(TOKEN);

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const serialised = call.map(String).join(' ');
        expect(serialised).not.toContain(TOKEN);
        expect(serialised).not.toContain(EMAIL);
      }
    }

    vi.restoreAllMocks();
  });
});
