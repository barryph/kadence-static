#!/usr/bin/env node
/**
 * Regenerates `public/og-image.png` (1200x630 Open Graph preview card).
 *
 * This is an optional developer tool, not part of the site build: the rendered
 * PNG is committed so CI and GitHub Pages need neither Chromium nor fonts. Run
 * it only after editing `scripts/og/og-image.html` or the brand logo:
 *
 *   pnpm run og:image
 *
 * Requires a Chromium/Chrome binary on PATH (override with CHROME_BIN).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { findBrowser } from './lib/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(root, 'scripts', 'og', 'og-image.html');
const output = path.join(root, 'public', 'og-image.png');

const binary = findBrowser();

if (!binary) {
  console.error(
    'No Chromium/Chrome binary found. Set CHROME_BIN=/path/to/chrome and retry.',
  );
  process.exit(1);
}

const profile = mkdtempSync(path.join(tmpdir(), 'kadence-og-'));

try {
  execFileSync(
    binary,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1200,630',
      `--user-data-dir=${profile}`,
      '--screenshot=' + output,
      pathToFileURL(template).href,
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(profile, { recursive: true, force: true });
}

console.log(`Wrote ${path.relative(root, output)}`);
