/**
 * Typed API client for the Kadence external account-deletion flow.
 *
 * This is the only module that talks to the backend, so changing an endpoint,
 * header or status-code mapping is a single-file change. See `config.ts` for
 * the endpoint paths.
 *
 * Security properties this client is responsible for:
 *  - it never logs an email address or a deletion token;
 *  - the token travels in the request body over HTTPS, never in a URL;
 *  - cookies are omitted, because this flow is intentionally unauthenticated
 *    and must not attach an ambient session to a cross-origin request;
 *  - redirects are refused, so a token cannot be replayed to another host;
 *  - only status codes are used to classify failures. The request endpoint's
 *    response is never inspected for account existence.
 */

import {
  isAllowedApiBaseUrl,
  joinUrl,
  readApiConfig,
  type ApiConfig,
} from './config';

/**
 * Why a request failed. These describe *transport* outcomes only; they are
 * identical for every email address and therefore cannot be used to discover
 * whether an account exists.
 */
export type DeletionFailureReason =
  | 'invalid_input'
  | 'invalid_token'
  | 'rate_limited'
  | 'unavailable'
  | 'misconfigured';

export type RequestDeletionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DeletionFailureReason };

export type ConfirmDeletionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DeletionFailureReason };

export interface CallOptions {
  readonly signal?: AbortSignal;
}

export interface AccountDeletionApi {
  requestAccountDeletion(
    email: string,
    options?: CallOptions,
  ): Promise<RequestDeletionResult>;
  confirmAccountDeletion(
    token: string,
    options?: CallOptions,
  ): Promise<ConfirmDeletionResult>;
}

type TransportOutcome =
  | { readonly kind: 'response'; readonly status: number }
  | { readonly kind: 'network' };

/**
 * Sends a JSON POST and returns only the status code.
 *
 * The response body is deliberately not surfaced: nothing in this flow may
 * branch on server-provided detail, and reading it risks logging PII.
 */
async function postJson(
  config: ApiConfig,
  path: string,
  payload: unknown,
  options: CallOptions,
): Promise<TransportOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(joinUrl(config.baseUrl, path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      // No cookies: a cross-origin account-deletion request must not carry an
      // ambient session, and the backend does not authenticate this flow with
      // one anyway.
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });

    return { kind: 'response', status: response.status };
  } catch {
    // Covers DNS/TLS errors, offline clients, timeouts and aborts. The error
    // is intentionally not logged: it can embed the request URL.
    return { kind: 'network' };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Classifies a transport outcome into a UI-facing failure reason. */
function classify(
  outcome: TransportOutcome,
  kind: 'request' | 'confirm',
): DeletionFailureReason | null {
  if (outcome.kind === 'network') return 'unavailable';

  const { status } = outcome;
  if (status >= 200 && status < 300) return null;
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';

  // 4xx. For confirmation, these mean the link cannot be used (expired,
  // invalid or already consumed). For the request endpoint a malformed email
  // is the only realistic cause — and that outcome is reported to the user as
  // success so the endpoint cannot be used to probe for accounts.
  if (status >= 400) {
    return kind === 'confirm' ? 'invalid_token' : 'invalid_input';
  }

  // Anything else (an unexpected redirect or 3xx) is a server-side problem.
  return 'unavailable';
}

/**
 * Builds a client bound to a specific configuration.
 *
 * Exported so tests can supply their own base URL and paths without touching
 * `import.meta.env`.
 */
export function createAccountDeletionApi(
  config: ApiConfig | null,
): AccountDeletionApi {
  const usable = config && isAllowedApiBaseUrl(config.baseUrl) ? config : null;

  return {
    async requestAccountDeletion(email, options = {}) {
      if (!usable) return { ok: false, reason: 'misconfigured' };

      const outcome = await postJson(
        usable,
        usable.requestPath,
        { email },
        options,
      );
      const reason = classify(outcome, 'request');
      return reason === null ? { ok: true } : { ok: false, reason };
    },

    async confirmAccountDeletion(token, options = {}) {
      if (!usable) return { ok: false, reason: 'misconfigured' };

      const outcome = await postJson(
        usable,
        usable.confirmPath,
        { token },
        options,
      );
      const reason = classify(outcome, 'confirm');
      return reason === null ? { ok: true } : { ok: false, reason };
    },
  };
}

/** Resolves the build-time configuration, or `null` when it is unusable. */
export function resolveAccountDeletionApi(): AccountDeletionApi {
  return createAccountDeletionApi(readApiConfig());
}
