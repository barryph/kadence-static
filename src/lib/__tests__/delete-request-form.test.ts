import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestDeletionResult } from '../api';
import { mountDeleteRequestForm } from '../delete-request-form';
import {
  DELETE_REQUEST_FORM_FIXTURE,
  deferred,
  flush,
  isPanelVisible,
  mountFixture,
  query,
} from './fixtures';

const VALID_EMAIL = 'user@example.com';

function form(): HTMLFormElement {
  return query<HTMLFormElement>('[data-role="request-form"]');
}
function emailInput(): HTMLInputElement {
  return query<HTMLInputElement>('[data-role="email"]');
}
function submitButton(): HTMLButtonElement {
  return query<HTMLButtonElement>('[data-role="submit"]');
}
function submitLabel(): HTMLElement {
  return query<HTMLElement>('[data-role="submit-label"]');
}
function fieldError(): HTMLElement {
  return query<HTMLElement>('[data-role="email-error"]');
}

function submitForm(): void {
  form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

function apiReturning(result: RequestDeletionResult) {
  return {
    requestAccountDeletion: vi.fn(async () => result),
  };
}

function typeEmail(value: string): void {
  const input = emailInput();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  mountFixture(DELETE_REQUEST_FORM_FIXTURE);
});

describe('initial state', () => {
  it('shows the form and hides the terminal panels', () => {
    mountDeleteRequestForm({ root: document, api: apiReturning({ ok: true }) });

    expect(isPanelVisible('form')).toBe(true);
    expect(isPanelVisible('sent')).toBe(false);
    expect(isPanelVisible('error')).toBe(false);
  });
});

describe('validation', () => {
  it('blocks submission and shows an error for an empty address', () => {
    const api = apiReturning({ ok: true });
    mountDeleteRequestForm({ root: document, api });

    submitForm();

    expect(api.requestAccountDeletion).not.toHaveBeenCalled();
    expect(fieldError().textContent).toMatch(/valid email address/i);
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(emailInput());
    expect(isPanelVisible('form')).toBe(true);
  });

  it('blocks submission for a malformed address', () => {
    const api = apiReturning({ ok: true });
    mountDeleteRequestForm({ root: document, api });

    typeEmail('not-an-email');
    submitForm();

    expect(api.requestAccountDeletion).not.toHaveBeenCalled();
    expect(fieldError().textContent).toMatch(/valid email address/i);
  });

  it('clears the error once the user edits the field', () => {
    mountDeleteRequestForm({ root: document, api: apiReturning({ ok: true }) });

    submitForm();
    expect(fieldError().textContent).not.toBe('');

    typeEmail('u');

    expect(fieldError().textContent).toBe('');
    expect(emailInput().hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('loading state', () => {
  it('disables the button, marks it busy and locks the field', () => {
    const pending = deferred<RequestDeletionResult>();
    mountDeleteRequestForm({
      root: document,
      api: { requestAccountDeletion: vi.fn(() => pending.promise) },
    });

    typeEmail(VALID_EMAIL);
    submitForm();

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().getAttribute('aria-busy')).toBe('true');
    expect(submitLabel().textContent).toBe('Requesting…');
    expect(emailInput().readOnly).toBe(true);
  });

  it('prevents duplicate submissions while a request is in flight', () => {
    const pending = deferred<RequestDeletionResult>();
    const api = { requestAccountDeletion: vi.fn(() => pending.promise) };
    mountDeleteRequestForm({ root: document, api });

    typeEmail(VALID_EMAIL);
    submitForm();
    submitForm();
    submitForm();

    expect(api.requestAccountDeletion).toHaveBeenCalledTimes(1);
  });

  it('restores the button after the request settles', async () => {
    const pending = deferred<RequestDeletionResult>();
    mountDeleteRequestForm({
      root: document,
      api: { requestAccountDeletion: vi.fn(() => pending.promise) },
    });

    typeEmail(VALID_EMAIL);
    submitForm();
    pending.resolve({ ok: true });
    await flush();

    expect(submitButton().disabled).toBe(false);
    expect(submitButton().hasAttribute('aria-busy')).toBe(false);
    expect(submitLabel().textContent).toBe('Request account deletion');
    expect(emailInput().readOnly).toBe(false);
  });
});

describe('success state', () => {
  it('shows the neutral "check your email" panel and clears the field', async () => {
    mountDeleteRequestForm({ root: document, api: apiReturning({ ok: true }) });

    typeEmail(VALID_EMAIL);
    submitForm();
    await flush();

    expect(isPanelVisible('sent')).toBe(true);
    expect(isPanelVisible('form')).toBe(false);
    expect(emailInput().value).toBe('');
  });

  it('shows the same neutral panel when the backend rejects a valid address', async () => {
    // A 4xx here must not let the endpoint be used to test whether an account
    // exists, so the UI deliberately shows the success state.
    mountDeleteRequestForm({
      root: document,
      api: apiReturning({ ok: false, reason: 'invalid_input' }),
    });

    typeEmail(VALID_EMAIL);
    submitForm();
    await flush();

    expect(isPanelVisible('sent')).toBe(true);
    expect(isPanelVisible('error')).toBe(false);
  });

  it('returns to the form when the user asks to use another address', async () => {
    mountDeleteRequestForm({ root: document, api: apiReturning({ ok: true }) });

    typeEmail(VALID_EMAIL);
    submitForm();
    await flush();

    query<HTMLButtonElement>('[data-role="return-to-form"]').click();

    expect(isPanelVisible('form')).toBe(true);
    expect(isPanelVisible('sent')).toBe(false);
    expect(document.activeElement).toBe(emailInput());
  });
});

describe('error state', () => {
  it('shows a generic error for an unavailable API', async () => {
    mountDeleteRequestForm({
      root: document,
      api: apiReturning({ ok: false, reason: 'unavailable' }),
    });

    typeEmail(VALID_EMAIL);
    submitForm();
    await flush();

    expect(isPanelVisible('error')).toBe(true);
    expect(query('[data-role="error-heading"]').textContent).toContain(
      'Something went wrong',
    );
    expect(query('[data-role="error-message"]').textContent).toMatch(
      /couldn't process your request/i,
    );
  });

  it('shows a specific message when rate limited', async () => {
    mountDeleteRequestForm({
      root: document,
      api: apiReturning({ ok: false, reason: 'rate_limited' }),
    });

    typeEmail(VALID_EMAIL);
    submitForm();
    await flush();

    expect(query('[data-role="error-heading"]').textContent).toContain(
      'Too many requests',
    );
  });

  it('treats an unconfigured API as an error the user can retry', async () => {
    mountDeleteRequestForm({
      root: document,
      api: apiReturning({ ok: false, reason: 'misconfigured' }),
    });

    typeEmail(VALID_EMAIL);
    submitForm();
    await flush();

    expect(isPanelVisible('error')).toBe(true);
    expect(query('[data-role="error-heading"]').textContent).toContain(
      'Something went wrong',
    );
  });

  it('preserves the address and allows a retry', async () => {
    const api = apiReturning({ ok: false, reason: 'unavailable' });
    mountDeleteRequestForm({ root: document, api });

    typeEmail(VALID_EMAIL);
    submitForm();
    await flush();

    query<HTMLButtonElement>('[data-role="retry"]').click();

    expect(isPanelVisible('form')).toBe(true);
    expect(emailInput().value).toBe(VALID_EMAIL);

    submitForm();
    await flush();

    expect(api.requestAccountDeletion).toHaveBeenCalledTimes(2);
  });
});
