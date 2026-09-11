/**
 * Controller for the "request account deletion" form.
 *
 * Kept out of the `.astro` page so it can be unit-tested against jsdom without
 * a browser or a running backend.
 */

import type { AccountDeletionApi, DeletionFailureReason } from './api';
import { createPanelSwitcher, requireElement, setButtonBusy } from './dom';
import { isValidEmail, normalizeEmail } from './email';

export type DeleteRequestApi = Pick<
  AccountDeletionApi,
  'requestAccountDeletion'
>;

export interface MountDeleteRequestFormOptions {
  readonly root: ParentNode;
  readonly api: DeleteRequestApi;
}

const FIELD_ERROR =
  'Enter a valid email address, for example name@example.com.';

/**
 * Failure copy. Every variant is identical for every email address, so the
 * wording cannot be used to probe for registered accounts.
 */
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
    message: "We couldn't process your request right now. Please try again.",
  },
};

export function mountDeleteRequestForm(
  options: MountDeleteRequestFormOptions,
): void {
  const { root, api } = options;

  const form = requireElement<HTMLFormElement>(
    root,
    '[data-role="request-form"]',
  );
  const emailInput = requireElement<HTMLInputElement>(
    root,
    '[data-role="email"]',
  );
  const submitButton = requireElement<HTMLButtonElement>(
    root,
    '[data-role="submit"]',
  );
  const submitLabel = root.querySelector<HTMLElement>(
    '[data-role="submit-label"]',
  );
  const fieldError = requireElement<HTMLElement>(
    root,
    '[data-role="email-error"]',
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

  let submitting = false;
  let controller: AbortController | null = null;

  function clearFieldError(): void {
    fieldError.textContent = '';
    emailInput.removeAttribute('aria-invalid');
  }

  function showFieldError(message: string): void {
    fieldError.textContent = message;
    emailInput.setAttribute('aria-invalid', 'true');
    emailInput.focus();
  }

  function showError(reason: DeletionFailureReason): void {
    const copy =
      reason === 'rate_limited' ? ERROR_COPY.rate_limited : ERROR_COPY.default;
    errorHeading.textContent = copy.heading;
    errorMessage.textContent = copy.message;
    panels.show('error');
  }

  function returnToForm(): void {
    panels.show('form');
    emailInput.focus();
  }

  async function submit(): Promise<void> {
    if (submitting) return;

    const email = normalizeEmail(emailInput.value);
    if (!isValidEmail(email)) {
      showFieldError(FIELD_ERROR);
      return;
    }

    clearFieldError();
    submitting = true;
    controller = new AbortController();
    setButtonBusy(submitButton, submitLabel, true, { label: 'Requesting…' });
    // The value stays visible, but cannot be edited mid-flight.
    emailInput.readOnly = true;

    try {
      const result = await api.requestAccountDeletion(email, {
        signal: controller.signal,
      });

      if (result.ok) {
        emailInput.value = '';
        panels.show('sent');
        return;
      }

      if (result.reason === 'invalid_input') {
        // The backend rejected a *well-formed* address. Reporting that as
        // anything other than the neutral success state would make this
        // endpoint usable for account enumeration, so it is treated as sent.
        emailInput.value = '';
        panels.show('sent');
        return;
      }

      showError(result.reason);
    } finally {
      submitting = false;
      controller = null;
      emailInput.readOnly = false;
      setButtonBusy(submitButton, submitLabel, false);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  emailInput.addEventListener('input', clearFieldError);

  root
    .querySelector<HTMLElement>('[data-role="return-to-form"]')
    ?.addEventListener('click', returnToForm);
  root
    .querySelector<HTMLElement>('[data-role="retry"]')
    ?.addEventListener('click', returnToForm);

  // Don't leave a request running while the page is being discarded.
  window.addEventListener('pagehide', () => controller?.abort());
}
