// @ts-check
import { defineConfig } from 'astro/config';

/**
 * Normalises a GitHub Pages base path.
 *
 * Astro wants `base` either as `/` or as a leading-slash, no-trailing-slash
 * path. The deploy workflow passes `BASE_PATH` (`/<repo-name>` for a project
 * site, `/` for a custom domain or user/organisation page).
 *
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeBase(value) {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

// Public production URL. Used for canonical and Open Graph tags only.
const site = process.env.SITE_URL?.trim() || 'https://barryph.github.io';

// Sub-path the site is served from. Defaults to the GitHub Pages project-site
// path for this repository; override with BASE_PATH=/ for a custom domain.
const base = normalizeBase(process.env.BASE_PATH ?? '/kadence-static');

// Static output only: the site is pure HTML/CSS/JS and never needs a Node
// runtime, which is what makes it suitable for GitHub Pages.
export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  devToolbar: {
    enabled: false,
  },
});
