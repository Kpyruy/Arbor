import type { EditingSession } from "../../src/view/state/viewTypes";
import type { ArborOverviewOrientation } from "../../src/types";
import type { ViewStateResult } from "obsidian";

interface OrientationMenuInput {
  root: HTMLElement;
  getSession(): EditingSession | null;
  captureGuards(): Promise<string>;
  pauseMarkdown(): { entered: Promise<void>; release(): void; restore(): void };
  click(element: HTMLElement): Promise<void>;
  waitForPublication(previous: HTMLElement): Promise<void>;
}

interface OrientationRequestsInput {
  view: {
    getState(): Record<string, unknown>;
    setState(state: unknown, result: ViewStateResult): Promise<void>;
    setOverviewOrientationOverride(value: ArborOverviewOrientation | null): Promise<void>;
    getOverviewOrientation(): ArborOverviewOrientation;
  };
  getSurface(): HTMLElement;
  waitForPublication(previous: HTMLElement): Promise<void>;
  captureGuards(): Promise<string>;
}

export async function checkOrientationRequestsHost(input: OrientationRequestsInput): Promise<{ checks: number }> {
  const guards = await input.captureGuards();
  for (const route of ["setState", "override"] as const) {
    let previous = input.getSurface();
    await input.view.setOverviewOrientationOverride("horizontal");
    await input.waitForPublication(previous);
    previous = input.getSurface();
    const state = { ...input.view.getState(), arborOverviewOrientation: "vertical-top-down" };
    const first = input.view.setState(state, { history: false });
    const second = route === "setState" ? input.view.setState(state, { history: false })
      : input.view.setOverviewOrientationOverride("vertical-top-down");
    await Promise.all([first, second]);
    await input.waitForPublication(previous);
    const surface = input.getSurface();
    const cards = Array.from(surface.querySelectorAll<HTMLElement>(".arbor-overview-card"));
    const root = cards.find(card => card.querySelector("textarea"))!;
    if (input.view.getOverviewOrientation() !== "vertical-top-down" || !root
      || !cards.some(card => card !== root && root.offsetTop + root.offsetHeight < card.offsetTop)) throw Error(`${route}: effective orientation and published geometry disagree`);
    await input.view.setState(state, { history: false });
    await input.view.setOverviewOrientationOverride("vertical-top-down");
    await new Promise(resolve => setTimeout(resolve, 160));
    if (input.getSurface() !== surface || surface.parentElement?.querySelector(".is-staging")) throw Error(`${route}: already published identical orientation relaid out`);
    if (await input.captureGuards() !== guards) throw Error(`${route}: same-file requests changed source/history/state`);
  }
  return { checks: 6 };
}

export async function checkOrientationMenuHost(input: OrientationMenuInput): Promise<{ checks: number }> {
  const surface = input.root.querySelector<HTMLElement>(".arbor-overview-surface:not(.is-staging)")!;
  const textarea = surface.querySelector<HTMLTextAreaElement>("textarea")!;
  textarea.focus({ preventScroll: true });
  textarea.value = "Unsaved toolbar menu draft";
  textarea.dispatchEvent(new Event("input"));
  textarea.setSelectionRange(3, 17, "backward");
  const session = input.getSession();
  const guards = await input.captureGuards();
  const pause = input.pauseMarkdown();
  const delay = () => new Promise(resolve => setTimeout(resolve, 160));
  const intact = async (label: string) => {
    if (input.getSession() !== session || session?.value !== "Unsaved toolbar menu draft" || await input.captureGuards() !== guards) {
      throw Error(`${label}: menu committed or changed source/history/state/session/draft`);
    }
  };
  try {
    await input.click(input.root.querySelector<HTMLElement>(".arbor-view-menu-button")!);
    if (!input.root.ownerDocument.querySelector(".menu")) throw Error("Trusted toolbar click did not open the native menu");
    await delay();
    await intact("reading menu beyond blur timeout");
    const item = Array.from(input.root.ownerDocument.querySelectorAll<HTMLElement>(".menu-item"))
      .find(row => row.querySelector(".menu-item-title")?.textContent === "Vertical — root at top");
    if (!item) throw Error("Actual native orientation menu item missing");
    await input.click(item);
    let entryTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([pause.entered, new Promise((_, reject) => {
        entryTimeout = setTimeout(() => reject(Error("Menu selection did not start Markdown staging")), 5000);
      })]);
    } finally { clearTimeout(entryTimeout); }
    await delay();
    await intact("delayed Markdown staging beyond blur timeout");
    if (textarea.selectionStart !== 3 || textarea.selectionEnd !== 17 || textarea.selectionDirection !== "backward") throw Error("Menu lost old caret");
    pause.release();
    await input.waitForPublication(surface);
    const published = input.root.querySelector<HTMLTextAreaElement>(".arbor-overview-surface:not(.is-staging) textarea")!;
    await intact("menu publication");
    if (published.value !== session?.value || published.selectionStart !== 3 || published.selectionEnd !== 17
      || published.selectionDirection !== "backward" || input.root.ownerDocument.activeElement !== published) throw Error("Menu publication lost draft/caret/focus");
    return { checks: 6 };
  } finally {
    pause.release();
    pause.restore();
  }
}
