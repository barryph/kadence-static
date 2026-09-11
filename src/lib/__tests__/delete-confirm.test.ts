import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfirmDeletionResult } from '../api';
import { isPlausibleToken, mountDeleteConfirm } from '../delete-confirm';
import {
  DELETE_CONFIRM_FIXTURE,
  deferred,
  flush,
  isPanelVisible,
  mountFixture,
  query,
} from './fixtures';

const TOKEN = 'a1b2c3d4e5f6789012345678901234567890abcd';

function confirmButton(): HTMLButtonElement {
  return query<HTMLButtonElement>('[data-role="confirm-delete"]');
}
function confirmLabel(): HTMLElement {
  return query<HTMLElement>('[data-role="confirm-label"]');
}
function retryButton(): HTMLButtonElement {
  return query<HTMLButtonElement>('[data-role="retry-confirm"]');
}

function apiReturning(result: ConfirmDeletionResult) {
  return { confirmAccountDeletion: vi.fn(async () => result) };
}

function mount(overrides: {
  api: { confirmAccountDeletion: (token: string) => Promise<ConfirmDeletionResult> };
  token?: string | null;
  clearTokenFromUrl?: () => void;
}) {
  mountDeleteConfirm({
    root: document,
    api: overrides.api,
    readToken: () => overrides.token ?? null,
    clearTokenFromUrl: overrides.clearTokenFromUrl ?? (() => {}),
  });
}

beforeEach(() => {
  mountFixture(DELETE_CONFIRM_FIXTURE);
});

describe('isPlausibleToken', () => {
  it('accepts URL-safe credential shapes', () => {
    expect(isPlausibleToken(TOKEN)).toBe(true);
    expect(isPlausibleToken('aB3._~-+/=z'.repeat(2))).toBe(true);
  });

  it('rejects missing, empty and obviously malformed values', () => {
    for (const value of [null, undefined, '', 'short', 'has space here ok', 'x'.repeat(2000)]) {
      expect(isPlausibleToken(value), String(value)).toBe(false);
    }
  });
});

describe('token handling', () => {
  it('never writes the token into the DOM', () => {
    mount({ api: apiReturning({ ok: true }), token: TOKEN });

    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('shows the invalid-link panel when the URL has no token', () => {
    const api = apiReturning({ ok: true });
    mount({ api, token: null });

    expect(isPanelVisible('invalid-link')).toBe(true);
    expect(isPanelVisible('confirm')).toBe(false);
    expect(api.confirmAccountDeletion).not.toHaveBeenCalled();
  });

  it('shows the invalid-link panel for a malformed token', () => {
    const api = apiReturning({ ok: true });
    mount({ api, token: 'short' });

    expect(isPanelVisible('invalid-link')).toBe(true);
    expect(api.confirmAccountDeletion).not.toHaveBeenCalled();
  });

  it('does not delete anything until the user confirms explicitly', () => {
    const api = apiReturning({ ok: true });
    mount({ api, token: TOKEN });

    expect(isPanelVisible('confirm')).toBe(true);
    expect(api.confirmAccountDeletion).not.toHaveBeenCalled();
  });
});

describe('loading state', () => {
  it('disables the button and marks it busy while deleting', () => {
    const pending = deferred<ConfirmDeletionResult>();
    mount({
      api: { confirmAccountDeletion: vi.fn(() => pending.promise) },
      token: TOKEN,
    });

    confirmButton().click();

    expect(confirmButton().disabled).toBe(true);
    expect(confirmButton().getAttribute('aria-busy')).toBe('true');
    expect(confirmLabel().textContent).toBe('Deleting…');
  });

  it('ignores repeated clicks while a deletion is in flight', () => {
    const pending = deferred<ConfirmDeletionResult>();
    const api = { confirmAccountDeletion: vi.fn(() => pending.promise) };
    mount({ api, token: TOKEN });

    confirmButton().click();
    confirmButton().click();
    confirmButton().click();

    expect(api.confirmAccountDeletion).toHaveBeenCalledTimes(1);
  });
});

describe('success state', () => {
  it('sends the token to the API and shows the deleted panel', async () => {
    const api = apiReturning({ ok: true });
    mount({ api, token: TOKEN });

    confirmButton().click();
    await flush();

    expect(api.confirmAccountDeletion).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(isPanelVisible('deleted')).toBe(true);
    expect(isPanelVisible('confirm')).toBe(false);
  });

  it('strips the token from the URL only after success', async () => {
    const clearTokenFromUrl = vi.fn();
    mount({ api: apiReturning({ ok: true }), token: TOKEN, clearTokenFromUrl });

    confirmButton().click();
    await flush();

    expect(clearTokenFromUrl).toHaveBeenCalledTimes(1);
  });

  it('does not strip the token when the link is rejected', async () => {
    const clearTokenFromUrl = vi.fn();
    mount({
      api: apiReturning({ ok: false, reason: 'invalid_token' }),
      token: TOKEN,
      clearTokenFromUrl,
    });

    confirmButton().click();
    await flush();

    expect(clearTokenFromUrl).not.toHaveBeenCalled();
  });
});

describe('invalid and expired links', () => {
  it('shows the invalid-link panel for a rejected token', async () => {
    mount({ api: apiReturning({ ok: false, reason: 'invalid_token' }), token: TOKEN });

    confirmButton().click();
    await flush();

    expect(isPanelVisible('invalid-link')).toBe(true);
    expect(isPanelVisible('confirm')).toBe(false);
  });
});

describe('error state', () => {
  it('shows a generic error when the API is unavailable', async () => {
    mount({ api: apiReturning({ ok: false, reason: 'unavailable' }), token: TOKEN });

    confirmButton().click();
    await flush();

    expect(isPanelVisible('error')).toBe(true);
    expect(query('[data-role="error-heading"]').textContent).toContain(
      'Something went wrong',
    );
  });

  it('explains rate limiting without leaking account information', async () => {
    mount({ api: apiReturning({ ok: false, reason: 'rate_limited' }), token: TOKEN });

    confirmButton().click();
    await flush();

    expect(query('[data-role="error-heading"]').textContent).toContain(
      'Too many requests',
    );
  });

  it('allows retrying after a transport failure', async () => {
    const confirmAccountDeletion = vi
      .fn<(token: string) => Promise<ConfirmDeletionResult>>()
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockResolvedValueOnce({ ok: true });
    mount({ api: { confirmAccountDeletion }, token: TOKEN });

    confirmButton().click();
    await flush();
    expect(isPanelVisible('error')).toBe(true);

    retryButton().click();
    await flush();

    expect(confirmAccountDeletion).toHaveBeenCalledTimes(2);
    expect(isPanelVisible('deleted')).toBe(true);
    expect(isPanelVisible('error')).toBe(false);
  });

  it('does not allow a retry after the account is deleted', async () => {
    const api = apiReturning({ ok: true });
    mount({ api, token: TOKEN });

    confirmButton().click();
    await flush();

    // The retry control lives in a hidden panel, but even a synthetic click
    // must not re-send a consumed token.
    retryButton().click();
    await flush();

    expect(api.confirmAccountDeletion).toHaveBeenCalledTimes(1);
    expect(isPanelVisible('deleted')).toBe(true);
  });
});
