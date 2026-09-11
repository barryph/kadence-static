import { describe, expect, it } from 'vitest';

import {
  MAX_EMAIL_LENGTH,
  isValidEmail,
  normalizeEmail,
} from '../email';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace only', () => {
    expect(normalizeEmail('  User@Example.com ')).toBe('User@Example.com');
  });
});

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const value of [
      'user@example.com',
      'first.last+tag@sub.example.co.nz',
      "o'brien@example.com",
      'a@b.io',
    ]) {
      expect(isValidEmail(value), value).toBe(true);
    }
  });

  it('accepts surrounding whitespace', () => {
    expect(isValidEmail('  user@example.com  ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    for (const value of [
      '',
      '   ',
      'user',
      'user@',
      '@example.com',
      'user@example',
      'user@@example.com',
      'user name@example.com',
      'user@exam ple.com',
      'user@example..com',
    ]) {
      expect(isValidEmail(value), value).toBe(false);
    }
  });

  it('rejects control characters', () => {
    expect(isValidEmail('user@exa\nmple.com')).toBe(false);
    expect(isValidEmail('user\u0000@example.com')).toBe(false);
  });

  it('treats surrounding whitespace as insignificant', () => {
    expect(isValidEmail('user@example.com\n')).toBe(true);
  });

  it('rejects addresses longer than the RFC limit', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });
});
