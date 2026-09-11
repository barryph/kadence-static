import { describe, expect, it } from 'vitest';

import { withBase } from '../url';

// Vitest runs with BASE_URL = '/', so these assertions cover the root-deploy
// case. The project-site case (BASE_PATH=/<repo>) is covered by the
// end-to-end build check in scripts/e2e-smoke.mjs.
describe('withBase', () => {
  it('prefixes a path with the configured base', () => {
    expect(withBase('delete-account/')).toBe('/delete-account/');
  });

  it('resolves the site root when given an empty path', () => {
    expect(withBase('')).toBe('/');
  });

  it('does not double slashes', () => {
    expect(withBase('/delete-account/')).toBe('/delete-account/');
  });
});
