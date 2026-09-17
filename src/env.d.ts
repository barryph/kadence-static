/// <reference types="astro/client" />

/**
 * Environment variables available to the browser bundle.
 *
 * Astro only exposes variables prefixed with `PUBLIC_`. Values are inlined at
 * build time, so they are public by definition — never place credentials here.
 */
interface ImportMetaEnv {
  /** Base URL of the Kadence API, e.g. `https://kadence.barryph.com`. */
  readonly PUBLIC_API_BASE_URL?: string;
  /**
   * Public site URL baked in at build time (see `astro.config.mjs`), e.g.
   * `https://accounts.kadence.barryph.com` — deliberately a different origin to
   * the API.
   */
  readonly SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
