#!/usr/bin/env node
/**
 * Mock Kadence API for local development and end-to-end testing.
 *
 * The real backend does not implement the external deletion flow yet, so this
 * stub lets the site be exercised without one.
 *
 * Run as a standalone dev server:
 *
 *   pnpm run mock-api                 # http://localhost:3000, mode: ok
 *   MOCK_MODE=rate-limit pnpm run mock-api
 *   MOCK_MODE=server-error pnpm run mock-api
 *   MOCK_MODE=reject pnpm run mock-api
 *
 * Then point the site at it and start Astro in another terminal:
 *
 *   PUBLIC_API_BASE_URL=http://localhost:3000 pnpm run dev
 *
 * Modes:
 *   ok            (default) 200 for both endpoints
 *   rate-limit    429 for both endpoints
 *   reject        400 for both endpoints
 *   server-error  500 for both endpoints
 *   network       closes the socket (simulates a network failure)
 *
 * On the confirmation endpoint, any token beginning with "invalid", "expired"
 * or "used" returns 400 regardless of mode, so the invalid-link state can be
 * tested.
 *
 * Requests are logged by method and path only — never by email or token.
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const VALID_TOKEN_PREFIXES = ['invalid', 'expired', 'used'];

function readBody(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

function respond(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  response.end(payload === null ? '' : JSON.stringify(payload));
}

/**
 * Creates a mock API server. Exported so `scripts/e2e-smoke.mjs` can run it
 * in-process on an ephemeral port and switch modes between assertions.
 */
export function createMockApiServer({ mode = 'ok', delayMs = 0 } = {}) {
  let currentMode = mode;
  const requests = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'OPTIONS') {
      respond(response, 204, null);
      return;
    }

    if (request.method !== 'POST') {
      respond(response, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (currentMode === 'network') {
      request.socket.destroy();
      return;
    }

    const isConfirm = url.pathname.endsWith('/confirm');
    const body = await readBody(request);
    requests.push({ pathname: url.pathname, body });

    const status =
      currentMode === 'rate-limit'
        ? 429
        : currentMode === 'server-error'
          ? 500
          : currentMode === 'reject'
            ? 400
            : isConfirm && !isAcceptableToken(body?.token)
              ? 400
              : 200;

    respond(
      response,
      status,
      status === 200
        ? { data: { message: 'ok' } }
        : { error: { code: 'MOCK_ERROR' } },
    );
  });

  return {
    server,
    requests,
    setMode(next) {
      currentMode = next;
    },
    listen(port) {
      return new Promise((resolve) => server.listen(port, resolve));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
    url(port) {
      return `http://localhost:${port}`;
    },
  };
}

function isAcceptableToken(token) {
  if (typeof token !== 'string' || !token) return false;
  return !VALID_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
}

async function startStandalone() {
  const port = Number(process.env.MOCK_API_PORT ?? 3000);
  const mode = process.env.MOCK_MODE ?? 'ok';
  const delayMs = Number(process.env.MOCK_DELAY_MS ?? 700);

  const api = createMockApiServer({ mode, delayMs });
  await api.listen(port);

  console.log(`Kadence mock API listening on http://localhost:${port} (mode: ${mode})`);
  console.log(
    'Routes: POST /account/deletion-requests/request, POST /account/deletion-requests/confirm',
  );

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => api.close().then(() => process.exit(0)));
  }
}

// Only start listening when executed directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startStandalone();
}
