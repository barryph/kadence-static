/// <reference types="astro/client" />

/**
 * Environment variables available to the browser bundle.
 *
 * Astro only exposes variables prefixed with `PUBLIC_`. Values are inlined at
 * build time, so they are public by definition — never place credentials here.
 */
interface ImportMetaEnv {
  /** Base URL of the Kadence API, e.g. `https://api.kadence.app`. */
  readonly PUBLIC_API_BASE_URL?: string;
  /** Public site URL baked in at build time (see `astro.config.mjs`). */
  readonly SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
