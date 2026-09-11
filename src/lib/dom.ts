/** Small DOM helpers shared by the two page controllers. */

export function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    // A missing hook is a build-time contract violation, not a user-facing
    // condition. Failing loudly in development surfaces it immediately.
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

/**
 * Shows exactly one `[data-panel]` element and moves focus to its heading.
 *
 * `hidden` is used rather than CSS so that the inactive panels are also
 * removed from the accessibility tree.
 */
export function createPanelSwitcher(root: ParentNode) {
  const panels = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-panel]').forEach((element) => {
    const name = element.dataset.panel;
    if (name) panels.set(name, element);
  });

  const find = (name: string): HTMLElement => {
    const panel = panels.get(name);
    if (!panel) throw new Error(`Unknown panel: ${name}`);
    return panel;
  };

  return {
    show(name: string, options: { focus?: boolean } = {}): void {
      panels.forEach((element, key) => {
        element.hidden = key !== name;
      });

      if (options.focus === false) return;

      const heading = find(name).querySelector<HTMLElement>(
        '[data-panel-heading]',
      );
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    },
  };
}

export interface BusyOptions {
  /** Replacement text shown while busy; the original is restored after. */
  readonly label?: string;
}

/** Toggles a button's disabled/busy state without losing its idle label. */
export function setButtonBusy(
  button: HTMLButtonElement,
  labelElement: HTMLElement | null,
  busy: boolean,
  options: BusyOptions = {},
): void {
  if (busy) {
    if (labelElement && labelElement.dataset.idleLabel === undefined) {
      labelElement.dataset.idleLabel = labelElement.textContent ?? '';
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (labelElement && options.label) {
      labelElement.textContent = options.label;
    }
    return;
  }

  button.disabled = false;
  button.removeAttribute('aria-busy');
  if (labelElement && labelElement.dataset.idleLabel !== undefined) {
    labelElement.textContent = labelElement.dataset.idleLabel;
    delete labelElement.dataset.idleLabel;
  }
}
