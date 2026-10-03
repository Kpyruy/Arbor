import type { PaneType } from "obsidian";

export interface CardLinkPort {
  getSourcePath(): string;
  paneForEvent(event: MouseEvent): PaneType | boolean;
  openInternal(linktext: string, sourcePath: string, pane: PaneType | boolean): Promise<void>;
  reportOpenError(error: unknown): void;
}

const CONTENT = ".arbor-card-content.markdown-rendered, .arbor-overview-card-content.markdown-rendered";

export function findRenderedCardLink(target: EventTarget | null, card: HTMLElement): HTMLAnchorElement | null {
  const node = target as Node | null;
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  const anchor = element?.closest<HTMLAnchorElement>("a") ?? null;
  const content = anchor?.closest(CONTENT);
  return anchor && content && card.contains(content) ? anchor : null;
}

export class CardLinkController {
  constructor(private readonly port: CardLinkPort) {}

  handleActivation(event: MouseEvent, card: HTMLElement): boolean {
    const anchor = findRenderedCardLink(event.target, card);
    if (!anchor) return false;
    if (event.defaultPrevented) return true;
    if (!anchor.classList.contains("internal-link")) return true;
    if (anchor.closest(".internal-embed")) return true;
    const primary = event.type === "click" && event.button === 0;
    const middle = event.type === "auxclick" && event.button === 1;
    if (!primary && !middle) return true;
    const linktext = anchor.getAttribute("data-href") || anchor.getAttribute("href");
    if (!linktext) return true;
    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) return true;

    try {
      const sourcePath = this.port.getSourcePath();
      if (!sourcePath) {
        this.reportError(new Error("Missing source path for Arbor link"));
        return true;
      }
      const opening = this.port.openInternal(linktext, sourcePath, this.port.paneForEvent(event));
      void Promise.resolve(opening).catch((error: unknown) => this.reportError(error));
    } catch (error) {
      this.reportError(error);
    }
    return true;
  }

  private reportError(error: unknown): void {
    try {
      this.port.reportOpenError(error);
    } catch {
      // Error reporting must not leak into the card's own action handler.
    }
  }
}
