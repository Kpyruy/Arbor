import type { App, PaneType } from "obsidian";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Run on an actual MarkdownRenderer anchor in the test vault, not a DOM mock. */
export async function checkCardLinkNavigationHost(
  app: App,
  anchor: HTMLAnchorElement,
  expectedLinktext: string,
  sourcePath: string,
  expectedPane: PaneType | boolean = false,
  activation: "click" | "middle" | "ctrl" = "click"
): Promise<void> {
  const workspace = app.workspace;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore by identity; calls retain the workspace receiver.
  const original = workspace.openLinkText;
  const calls: Parameters<typeof original>[] = [];
  const pending: Promise<void>[] = [];
  workspace.openLinkText = function (...args) {
    calls.push(args);
    const result = original.apply(workspace, args);
    pending.push(result);
    return result;
  };
  try {
    check(anchor.isConnected, "Rendered link is detached");
    if (activation === "click") anchor.click();
    else {
      const Mouse = anchor.ownerDocument.defaultView?.MouseEvent;
      check(Mouse, "Missing owner-window MouseEvent");
      anchor.dispatchEvent(new Mouse(activation === "middle" ? "auxclick" : "click", {
        bubbles: true, cancelable: true, button: activation === "middle" ? 1 : 0,
        ctrlKey: activation === "ctrl", detail: 1
      }));
    }
    await Promise.all(pending);
    check(calls.length === 1, `Link navigated ${calls.length} times instead of once`);
    check(calls[0][0] === expectedLinktext, "Wrong link target/subpath");
    check(calls[0][1] === sourcePath, "Wrong relative-link source");
    check(calls[0][2] === expectedPane, "Wrong pane target");
  } finally {
    workspace.openLinkText = original;
  }
}

/** Verify a glossary-like handler remains the only activation owner. */
export function checkHandledCardLinkHost(app: App, anchor: HTMLAnchorElement): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore by identity; calls retain the workspace receiver.
  const original = app.workspace.openLinkText;
  let opens = 0;
  let handled = 0;
  app.workspace.openLinkText = function (...args) {
    opens += 1;
    return original.apply(app.workspace, args);
  };
  const own = (event: MouseEvent) => { handled += 1; event.preventDefault(); };
  anchor.addEventListener("click", own);
  try {
    anchor.click();
    check(handled === 1, "Plugin-like handler was not invoked once");
    check(opens === 0, "Arbor duplicated a plugin-handled click");
  } finally {
    anchor.removeEventListener("click", own);
    app.workspace.openLinkText = original;
  }
}
