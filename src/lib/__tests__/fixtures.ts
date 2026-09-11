/**
 * DOM fixtures mirroring the `data-*` hooks used by the Astro pages.
 *
 * Keeping them here means a renamed hook breaks a test rather than silently
 * breaking the page at runtime.
 */

export const DELETE_REQUEST_FORM_FIXTURE = `
  <div data-panel="form">
    <form data-role="request-form" novalidate>
      <input data-role="email" id="email" type="email" />
      <p data-role="email-error" id="email-error" role="alert"></p>
      <button data-role="submit" type="submit">
        <span class="spinner"></span>
        <span data-role="submit-label">Request account deletion</span>
      </button>
    </form>
  </div>
  <div data-panel="sent" hidden>
    <h2 data-panel-heading>Check your email</h2>
    <button data-role="return-to-form" type="button">Use a different email address</button>
  </div>
  <div data-panel="error" hidden>
    <h2 data-panel-heading data-role="error-heading">Something went wrong</h2>
    <p data-role="error-message">We couldn't process your request right now.</p>
    <button data-role="retry" type="button">Try again</button>
  </div>
`;

export const DELETE_CONFIRM_FIXTURE = `
  <div data-panel="confirm">
    <button data-role="confirm-delete" type="button">
      <span class="spinner"></span>
      <span data-role="confirm-label">Permanently delete account</span>
    </button>
  </div>
  <div data-panel="deleted" hidden>
    <h2 data-panel-heading>Account deleted</h2>
  </div>
  <div data-panel="invalid-link" hidden>
    <h2 data-panel-heading>This link is no longer valid</h2>
  </div>
  <div data-panel="error" hidden>
    <h2 data-panel-heading data-role="error-heading">Something went wrong</h2>
    <p data-role="error-message">We couldn't delete your account right now.</p>
    <button data-role="retry-confirm" type="button">Try again</button>
  </div>
`;

export function mountFixture(html: string): void {
  document.body.innerHTML = html;
}

export function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Fixture is missing ${selector}`);
  return element;
}

export function panel(name: string): HTMLElement {
  return query<HTMLElement>(`[data-panel="${name}"]`);
}

export function isPanelVisible(name: string): boolean {
  return panel(name).hidden === false;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending microtasks settle. */
export async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
