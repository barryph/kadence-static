import { describe, expect, it } from 'vitest';

import { isAllowedApiBaseUrl, joinUrl } from '../config';

describe('isAllowedApiBaseUrl', () => {
  it('accepts an https origin', () => {
    expect(isAllowedApiBaseUrl('https://api.kadence.app')).toBe(true);
    expect(isAllowedApiBaseUrl('https://api.kadence.app/v1')).toBe(true);
  });

  it('rejects plain http for anything but loopback', () => {
    expect(isAllowedApiBaseUrl('http://api.kadence.app')).toBe(false);
    expect(isAllowedApiBaseUrl('http://192.168.1.10:3000')).toBe(false);
  });

  it('accepts http on loopback for local development', () => {
    expect(isAllowedApiBaseUrl('http://localhost:3000')).toBe(true);
    expect(isAllowedApiBaseUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedApiBaseUrl('http://api.localhost:8080')).toBe(true);
  });

  it('rejects empty, relative and non-http values', () => {
    expect(isAllowedApiBaseUrl('')).toBe(false);
    expect(isAllowedApiBaseUrl('   ')).toBe(false);
    expect(isAllowedApiBaseUrl('/api')).toBe(false);
    expect(isAllowedApiBaseUrl('ftp://api.kadence.app')).toBe(false);
    expect(isAllowedApiBaseUrl('not a url')).toBe(false);
  });

  it('rejects URLs carrying credentials', () => {
    expect(isAllowedApiBaseUrl('https://user:pass@api.kadence.app')).toBe(
      false,
    );
  });
});

describe('joinUrl', () => {
  it('joins without doubling or dropping slashes', () => {
    expect(joinUrl('https://api.kadence.app', '/auth/x')).toBe(
      'https://api.kadence.app/auth/x',
    );
    expect(joinUrl('https://api.kadence.app/', '/auth/x')).toBe(
      'https://api.kadence.app/auth/x',
    );
    expect(joinUrl('https://api.kadence.app///', 'auth/x')).toBe(
      'https://api.kadence.app/auth/x',
    );
  });
});
