/**
 * Prefixes an absolute site path with Astro's configured `base`.
 *
 * GitHub Pages serves project sites from `/<repo-name>/`, so every internal
 * link and public asset reference has to be prefixed. `import.meta.env.BASE_URL`
 * is `/` when the site is served from the domain root and `/<repo>/` otherwise.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}${normalizedPath}`;
}
