#!/usr/bin/env node
/**
 * End-to-end smoke test: drives the *built* site in a real Chromium against the
 * in-process mock API.
 *
 *   pnpm run test:e2e
 *
 * The unit tests cover the controllers against jsdom fixtures; this script
 * covers the gap they cannot — that the Astro pages really wire those hooks up,
 * that the bundled client code runs in a browser, and that the verification
 * token is handled correctly end to end.
 *
 * Requirements: a `dist/` build (`pnpm run build`) and a Chromium/Chrome binary
 * (set CHROME_BIN to override).
 *
 * Everything here is local-only tooling; nothing is shipped to the browser.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { findBrowser } from './lib/browser.mjs';
import { createMockApiServer } from './mock-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const BASE_PATH = '/kadence-static/';
const API_PORT = 3123;
const SITE_PORT = 4174;
const DEBUG_PORT = 9333;
const VALID_TOKEN = 'a1b2c3d4e5f6789012345678901234567890abcd';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- tiny static file server ------------------------------------------------

function startStaticServer() {
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (!pathname.startsWith(BASE_PATH)) {
      response.writeHead(404).end('Not found');
      return;
    }

    let relative = pathname.slice(BASE_PATH.length);
    if (relative === '' || relative.endsWith('/')) relative += 'index.html';

    const file = path.join(distDir, relative);
    if (!file.startsWith(distDir)) {
      response.writeHead(403).end();
      return;
    }

    try {
      const body = readFileSync(file);
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(SITE_PORT, () =>
      resolve({
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });
}

// --- minimal Chrome DevTools Protocol client --------------------------------

class CdpSession {
  #socket;
  #nextId = 1;
  #pending = new Map();

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });

    const session = new CdpSession(socket);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = message.id ? session.#pending.get(message.id) : null;
      if (!pending) return;
      session.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    return session;
  }

  constructor(socket) {
    this.#socket = socket;
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        `evaluate failed: ${exceptionDetails.text} ${
          exceptionDetails.exception?.description ?? ''
        }`,
      );
    }
    return result.value;
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor("document.readyState === 'complete'");
    // Astro's module scripts run before `complete`; give the mount a tick.
    await sleep(80);
  }

  async waitFor(expression, { timeoutMs = 5_000, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.evaluate(expression)) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
      await sleep(40);
    }
  }

  close() {
    this.#socket.close();
  }
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === 'page' && target.webSocketDebuggerUrl,
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chromium is still starting up.
    }
    await sleep(100);
  }
  throw new Error('Could not find a Chromium page target');
}

// --- assertions -------------------------------------------------------------

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

/** Normalises typographic punctuation so copy assertions stay readable. */
function normalizeCopy(text) {
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- helpers used inside the page -------------------------------------------

const panelVisible = (name) =>
  `document.querySelector('[data-panel="${name}"]').hidden === false`;

const setEmailAndSubmit = (email) => `(() => {
  const input = document.querySelector('[data-role="email"]');
  input.value = ${JSON.stringify(email)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document
    .querySelector('[data-role="request-form"]')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const button = document.querySelector('[data-role="submit"]');
  return {
    disabled: button.disabled,
    busy: button.getAttribute('aria-busy'),
    label: document.querySelector('[data-role="submit-label"]').textContent,
  };
})()`;

// --- main -------------------------------------------------------------------

const browserBinary = findBrowser();
if (!browserBinary) {
  console.error('No Chromium/Chrome binary found. Set CHROME_BIN and retry.');
  process.exit(1);
}

console.log('Building the site against the mock API...');
execFileSync('pnpm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PUBLIC_API_BASE_URL: `http://localhost:${API_PORT}`,
    SITE_URL: `http://localhost:${SITE_PORT}`,
    BASE_PATH,
  },
});

const api = createMockApiServer({ delayMs: 120 });
await api.listen(API_PORT);

const staticServer = await startStaticServer();
const profile = mkdtempSync(path.join(tmpdir(), 'kadence-e2e-'));
const browser = spawn(
  browserBinary,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let session;
let exitCode = 0;

try {
  session = await CdpSession.connect(await findPageTarget());
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  // Collect page-level errors so a broken bundle fails the run.
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__e2eErrors = [];
      window.addEventListener('error', (event) => {
        window.__e2eErrors.push(String(event.message));
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__e2eErrors.push(String(event.reason));
      });
    `,
  });

  const site = `http://localhost:${SITE_PORT}${BASE_PATH}`;
  const requestUrl = `${site}delete-account/`;
  const confirmUrl = (token) =>
    `${site}delete-account/confirm/${token ? `?token=${token}` : ''}`;

  console.log('\nRequest flow');

  await check('renders the request page with its initial state', async () => {
    await session.goto(requestUrl);
    assert(await session.evaluate(panelVisible('form')), 'form panel is hidden');
    assert(
      await session.evaluate(`!${panelVisible('sent')}`),
      'sent panel should start hidden',
    );
    assertEqual(
      await session.evaluate(
        `document.querySelector('[data-role="submit-label"]').textContent`,
      ),
      'Request account deletion',
      'unexpected submit label',
    );
  });

  await check('rejects a malformed address before any request', async () => {
    await session.goto(requestUrl);
    const before = api.requests.length;
    await session.evaluate(setEmailAndSubmit('not-an-email'));
    await session.waitFor(
      `document.querySelector('[data-role="email-error"]').textContent.length > 0`,
    );
    assertEqual(api.requests.length, before, 'the API should not have been called');
    assert(
      await session.evaluate(panelVisible('form')),
      'should stay on the form',
    );
  });

  await check('shows a loading state while the request is in flight', async () => {
    await session.goto(requestUrl);
    const state = await session.evaluate(setEmailAndSubmit('user@example.com'));
    assertEqual(state.disabled, true, 'submit button should be disabled');
    assertEqual(state.busy, 'true', 'submit button should be aria-busy');
    assertEqual(state.label, 'Requesting…', 'unexpected busy label');
  });

  await check('shows the neutral confirmation state on success', async () => {
    await session.waitFor(panelVisible('sent'));
    assert(
      await session.evaluate(`!${panelVisible('form')}`),
      'form panel should be hidden',
    );
    assertEqual(
      await session.evaluate(`document.querySelector('[data-role="email"]').value`),
      '',
      'the email field should be cleared',
    );
    assertEqual(
      normalizeCopy(
        await session.evaluate(
          `document.querySelector('[data-panel="sent"] p.prose').textContent`,
        ),
      ),
      "If an account exists for this email address, we've sent instructions to verify your request and continue with account deletion.",
      'unexpected confirmation copy',
    );
  });

  await check('shows the same neutral state when the backend rejects the address', async () => {
    api.setMode('reject');
    await session.goto(requestUrl);
    await session.evaluate(setEmailAndSubmit('user@example.com'));
    await session.waitFor(panelVisible('sent'));
    assert(
      await session.evaluate(`!${panelVisible('error')}`),
      'a 4xx must not reveal account existence',
    );
    api.setMode('ok');
  });

  await check('shows a retryable error when the API fails', async () => {
    api.setMode('server-error');
    await session.goto(requestUrl);
    await session.evaluate(setEmailAndSubmit('user@example.com'));
    await session.waitFor(panelVisible('error'));
    assertEqual(
      await session.evaluate(
        `document.querySelector('[data-role="error-heading"]').textContent.trim()`,
      ),
      'Something went wrong',
      'unexpected error heading',
    );
    await session.evaluate(`document.querySelector('[data-role="retry"]').click()`);
    assert(await session.evaluate(panelVisible('form')), 'retry should return to the form');
  });

  await check('explains rate limiting', async () => {
    api.setMode('rate-limit');
    await session.goto(requestUrl);
    await session.evaluate(setEmailAndSubmit('user@example.com'));
    await session.waitFor(panelVisible('error'));
    assertEqual(
      await session.evaluate(
        `document.querySelector('[data-role="error-heading"]').textContent.trim()`,
      ),
      'Too many requests',
      'unexpected rate-limit heading',
    );
    api.setMode('ok');
  });

  console.log('\nConfirmation flow');

  await check('does not act without a token', async () => {
    await session.goto(confirmUrl(null));
    assert(
      await session.evaluate(panelVisible('invalid-link')),
      'invalid-link panel should be shown',
    );
    assert(
      await session.evaluate(`!${panelVisible('confirm')}`),
      'confirm panel should be hidden',
    );
  });

  await check('keeps the token out of the rendered DOM', async () => {
    await session.goto(confirmUrl(VALID_TOKEN));
    assert(
      await session.evaluate(panelVisible('confirm')),
      'confirm panel should be shown',
    );
    assert(
      await session.evaluate(
        `!document.documentElement.outerHTML.includes(${JSON.stringify(VALID_TOKEN)})`,
      ),
      'the token must never be rendered',
    );
  });

  await check('sends the token in a POST body, not the URL', async () => {
    const before = api.requests.length;
    await session.evaluate(
      `document.querySelector('[data-role="confirm-delete"]').click()`,
    );
    await session.waitFor(panelVisible('deleted'));

    const confirmRequests = api.requests.slice(before);
    assertEqual(confirmRequests.length, 1, 'expected exactly one confirm request');
    assertEqual(
      confirmRequests[0].pathname,
      '/website/auth/account-deletion/confirm',
      'unexpected endpoint',
    );
    assertEqual(confirmRequests[0].body.token, VALID_TOKEN, 'token should be in the body');
    assertEqual(
      await session.evaluate(
        `document.documentElement.outerHTML.includes(${JSON.stringify(VALID_TOKEN)})`,
      ),
      false,
      'token must not leak into the DOM',
    );
  });

  await check('strips the token from the address bar after deletion', async () => {
    await session.waitFor(panelVisible('deleted'));
    assertEqual(
      await session.evaluate(`window.location.search`),
      '',
      'the query string should be cleared',
    );
  });

  await check('shows the deleted state with the exact copy', async () => {
    assertEqual(
      normalizeCopy(
        await session.evaluate(
          `document.querySelector('[data-panel="deleted"] .prose').textContent`,
        ),
      ),
      'Your Kadence account has been permanently deleted.',
      'unexpected deletion copy',
    );
  });

  await check('reports an expired or already-used link', async () => {
    await session.goto(confirmUrl('expired-token-abcdefghijklmnop'));
    await session.evaluate(
      `document.querySelector('[data-role="confirm-delete"]').click()`,
    );
    await session.waitFor(panelVisible('invalid-link'));
    assert(
      await session.evaluate(`!${panelVisible('deleted')}`),
      'must not claim success',
    );
  });

  await check('recovers when the network fails, then retries successfully', async () => {
    api.setMode('network');
    await session.goto(confirmUrl(VALID_TOKEN));
    await session.evaluate(
      `document.querySelector('[data-role="confirm-delete"]').click()`,
    );
    await session.waitFor(panelVisible('error'));

    api.setMode('ok');
    await session.evaluate(
      `document.querySelector('[data-role="retry-confirm"]').click()`,
    );
    await session.waitFor(panelVisible('deleted'));
  });

  await check('leaves no uncaught errors behind', async () => {
    const errors = await session.evaluate(`window.__e2eErrors ?? []`);
    assertEqual(errors.length, 0, `page errors: ${errors.join(' | ')}`);
  });

  console.log('\nLayout and accessibility');

  await check('loads the Kadence typeface', async () => {
    await session.goto(requestUrl);
    const loaded = await session.evaluate(
      `(async () => { await document.fonts.ready; return document.fonts.check('16px "IBM Plex Mono"'); })()`,
    );
    assert(loaded, 'IBM Plex Mono did not load');
  });

  await check('exposes semantic landmarks and an associated label', async () => {
    await session.goto(requestUrl);
    assert(
      await session.evaluate(
        `document.querySelectorAll('h1').length === 1`,
      ),
      'expected exactly one h1',
    );
    assert(
      await session.evaluate(
        `!!document.querySelector('label[for="email"]') && document.querySelector('[data-role="email"]').id === 'email'`,
      ),
      'the email input must have an associated label',
    );
    assert(
      await session.evaluate(
        `!!document.querySelector('a.skip-link[href="#main"]') && !!document.querySelector('main#main')`,
      ),
      'expected a working skip link',
    );
  });

  await check('does not overflow horizontally at any width', async () => {
    for (const width of [320, 375, 414, 768, 1280]) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width <= 480,
      });
      await session.goto(requestUrl);
      const overflow = await session.evaluate(
        `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
      );
      assert(overflow <= 1, `horizontal overflow of ${overflow}px at ${width}px wide`);

      const target = await session.evaluate(
        `document.querySelector('[data-role="submit"]').getBoundingClientRect().height`,
      );
      assert(target >= 44, `submit button is only ${target}px tall at ${width}px wide`);

      const fontSize = await session.evaluate(
        `parseFloat(getComputedStyle(document.querySelector('[data-role="email"]')).fontSize)`,
      );
      assert(fontSize >= 16, `email input font-size is ${fontSize}px at ${width}px wide`);
    }
    await session.send('Emulation.clearDeviceMetricsOverride');
  });

  await check('keeps the confirmation page usable on a small phone', async () => {
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 700,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await session.goto(confirmUrl(VALID_TOKEN));
    const overflow = await session.evaluate(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    assert(overflow <= 1, `confirmation page overflows by ${overflow}px`);
    assertEqual(
      await session.evaluate(
        `document.querySelector('[data-role="confirm-label"]').textContent.trim()`,
      ),
      'Permanently delete account',
      'unexpected confirm label',
    );
    await session.send('Emulation.clearDeviceMetricsOverride');
  });
} catch (error) {
  console.error(`\nE2E harness failed: ${error.stack ?? error.message}`);
  exitCode = 1;
} finally {
  session?.close();
  browser.kill('SIGKILL');
  await staticServer.close();
  await api.close();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} browser checks passed`,
);

if (failed.length > 0 || results.length === 0) exitCode = 1;
process.exit(exitCode);
