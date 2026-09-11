/**
 * Controller for the email-link confirmation step.
 *
 * The verification token is treated as a credential:
 *  - it lives only in this closure (and the address bar the email link
 *    produced), never in storage, the DOM, a log line or an analytics call;
 *  - it is sent in a POST body over HTTPS, never in a URL;
 *  - it is dropped from memory as soon as a terminal state is reached.
 *
 * Like the request form, this lives outside the `.astro` page so it can be
 * unit-tested against jsdom.
 */

import type { AccountDeletionApi, DeletionFailureReason } from './api';
import { createPanelSwitcher, requireElement, setButtonBusy } from './dom';

export type DeleteConfirmApi = Pick<
  AccountDeletionApi,
  'confirmAccountDeletion'
>;

export interface MountDeleteConfirmOptions {
  readonly root: ParentNode;
  readonly api: DeleteConfirmApi;
  /** Reads the token from the current URL. Injectable for tests. */
  readonly readToken?: () => string | null;
  /** Invoked after a successful deletion to strip the token from the URL. */
  readonly clearTokenFromUrl?: () => void;
}

/** Tokens are opaque, but must at least look like a URL-safe credential. */
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{8,1024}$/;

export function isPlausibleToken(
  value: string | null | undefined,
): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function defaultReadToken(): string | null {
  return new URLSearchParams(window.location.search).get('token');
}

function defaultClearTokenFromUrl(): void {
  try {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.hash}`,
    );
  } catch {
    // `history` can be unavailable in restricted contexts. The token is still
    // cleared from memory; it just stays in the address bar.
  }
}

const ERROR_COPY: Record<'rate_limited' | 'default', {
  heading: string;
  message: string;
}> = {
  rate_limited: {
    heading: 'Too many requests',
    message:
      "You've made too many requests. Please wait a moment, then try again.",
  },
  default: {
    heading: 'Something went wrong',
    message: "We couldn't delete your account right now. Please try again.",
  },
};

export function mountDeleteConfirm(
  options: MountDeleteConfirmOptions,
): void {
  const { root, api } = options;
  const readToken = options.readToken ?? defaultReadToken;
  const clearTokenFromUrl =
    options.clearTokenFromUrl ?? defaultClearTokenFromUrl;

  const confirmButton = requireElement<HTMLButtonElement>(
    root,
    '[data-role="confirm-delete"]',
  );
  const confirmLabel = root.querySelector<HTMLElement>(
    '[data-role="confirm-label"]',
  );
  const retryButton = root.querySelector<HTMLButtonElement>(
    '[data-role="retry-confirm"]',
  );
  const errorHeading = requireElement<HTMLElement>(
    root,
    '[data-role="error-heading"]',
  );
  const errorMessage = requireElement<HTMLElement>(
    root,
    '[data-role="error-message"]',
  );

  const panels = createPanelSwitcher(root);

  let token: string | null = readToken();
  let submitting = false;
  let settled = false;
  let controller: AbortController | null = null;

  function showError(reason: DeletionFailureReason): void {
    const copy =
      reason === 'rate_limited' ? ERROR_COPY.rate_limited : ERROR_COPY.default;
    errorHeading.textContent = copy.heading;
    errorMessage.textContent = copy.message;
    panels.show('error');
    retryButton?.focus();
  }

  async function confirm(): Promise<void> {
    if (submitting || settled) return;
    if (!isPlausibleToken(token)) {
      panels.show('invalid-link');
      return;
    }

    const submittedToken = token;
    submitting = true;
    controller = new AbortController();
    setButtonBusy(confirmButton, confirmLabel, true, { label: 'Deleting…' });

    try {
      const result = await api.confirmAccountDeletion(submittedToken, {
        signal: controller.signal,
      });

      if (result.ok) {
        settled = true;
        token = null;
        clearTokenFromUrl();
        panels.show('deleted');
        return;
      }

      if (result.reason === 'invalid_token') {
        // Expired, unknown or already-consumed link. The account state is
        // never described, so this cannot be used to probe for accounts. A
        // lost response followed by a retry lands here rather than reporting a
        // deletion this page cannot actually confirm — the copy covers both.
        settled = true;
        token = null;
        panels.show('invalid-link');
        return;
      }

      showError(result.reason);
    } finally {
      submitting = false;
      controller = null;
      setButtonBusy(confirmButton, confirmLabel, false);
    }
  }

  // A link without a usable token can never succeed; say so immediately
  // instead of sending the user through a pointless confirmation step.
  // Focus is left alone so the page does not yank focus on load.
  if (!isPlausibleToken(token)) {
    panels.show('invalid-link', { focus: false });
  }

  confirmButton.addEventListener('click', () => {
    void confirm();
  });

  retryButton?.addEventListener('click', () => {
    // A consumed token can never be retried: the account is already gone.
    if (settled || submitting) return;
    panels.show('confirm');
    void confirm();
  });

  window.addEventListener('pagehide', () => controller?.abort());
}
