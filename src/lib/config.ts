/**
 * Configuration for the Kadence account-deletion site.
 *
 * The API base URL is supplied at build time through `PUBLIC_API_BASE_URL`.
 * Only `PUBLIC_*` variables are inlined into the browser bundle, so treat this
 * value as public — it must never contain a secret.
 */

/**
 * Backend path that starts the email-verified deletion flow.
 *
 * The backend implements this route under `modules/account-management/`. The
 * paths live here in exactly one place, so a route change is a one-file edit;
 * everything else goes through the typed API client in `api.ts`.
 */
export const ACCOUNT_DELETION_REQUEST_PATH = '/account/deletion-requests';

/** Backend path that consumes the single-use verification token. */
export const ACCOUNT_DELETION_CONFIRM_PATH = '/account/deletion-requests/confirm';

/** Requests are aborted after this long so the UI can offer a retry. */
export const REQUEST_TIMEOUT_MS = 20_000;

export interface ApiConfig {
  readonly baseUrl: string;
  readonly requestPath: string;
  readonly confirmPath: string;
  readonly timeoutMs: number;
}

/** Reads the build-time API configuration. */
export function readApiConfig(): ApiConfig {
  const baseUrl = (import.meta.env.PUBLIC_API_BASE_URL ?? '').trim();

  return {
    baseUrl,
    requestPath: ACCOUNT_DELETION_REQUEST_PATH,
    confirmPath: ACCOUNT_DELETION_CONFIRM_PATH,
    timeoutMs: REQUEST_TIMEOUT_MS,
  };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Whether a configured API base URL is safe to send this flow's data to.
 *
 * Production traffic must be HTTPS; plain `http://` is tolerated only for a
 * loopback host so the site can be developed against a local backend. Any URL
 * carrying credentials (`https://user:pass@host`) is rejected outright.
 */
export function isAllowedApiBaseUrl(rawBaseUrl: string): boolean {
  const value = rawBaseUrl.trim();
  if (!value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname);
  return false;
}

/** Joins a base URL and an absolute path without doubling the slash. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
