// @ts-check
import { defineConfig } from 'astro/config';

// Public production URL. Used for canonical and Open Graph tags only.
const site =
  process.env.SITE_URL?.trim() || 'https://accounts.kadence.barryph.com';

// Static output only: the site is pure HTML/CSS/JS and never needs a Node
// runtime, which is what makes it suitable for GitHub Pages.
export default defineConfig({
  site,
  // `base` is intentionally left at Astro's default of `/`: the site is always
  // served from the domain root, so no sub-path prefixing is required.
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  devToolbar: {
    enabled: false,
  },
});
