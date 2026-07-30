import { App, EventRef, TFile } from "obsidian";
import { isArborManagedText } from "./fileExplorerBadgeRecognition";

export { isArborManagedText } from "./fileExplorerBadgeRecognition";

const REFRESH_DELAY_MS = 100;

export class ArborFileExplorerBadge {
  private readonly observers = new Map<HTMLElement, MutationObserver>();
  private readonly eventRefs: EventRef[];
  private refreshTimer: number | null = null;

  constructor(private readonly app: App) {
    this.eventRefs = [
      this.app.vault.on("create", () => this.scheduleRefresh()),
      this.app.vault.on("modify", () => this.scheduleRefresh()),
      this.app.vault.on("rename", () => this.scheduleRefresh()),
      this.app.vault.on("delete", () => this.scheduleRefresh())
    ];
  }

  async refresh(): Promise<void> {
    const containers = new Set<HTMLElement>();
    this.app.workspace.getLeavesOfType("file-explorer").forEach((leaf) => {
      const container = leaf.view.containerEl;
      containers.add(container);
      this.observeContainer(container);
    });

    this.observers.forEach((observer, container) => {
      if (!containers.has(container)) {
        observer.disconnect();
        this.observers.delete(container);
      }
    });

    await Promise.all(Array.from(containers).flatMap((container) =>
      Array.from(container.querySelectorAll<HTMLElement>(".nav-file-title[data-path]")).map((title) => this.decorateTitle(title))
    ));
  }

  unload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
    this.eventRefs.forEach((eventRef) => this.app.vault.offref(eventRef));
    document.querySelectorAll(".arbor-file-badge").forEach((badge) => badge.remove());
  }

  private observeContainer(container: HTMLElement): void {
    if (this.observers.has(container)) {
      return;
    }
    const observer = new MutationObserver(() => this.scheduleRefresh());
    observer.observe(container, { childList: true, subtree: true });
    this.observers.set(container, observer);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private async decorateTitle(title: HTMLElement): Promise<void> {
    const path = title.dataset.path;
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile) || file.extension !== "md") {
      this.removeBadge(title);
      return;
    }

    const text = await this.app.vault.cachedRead(file);
    if (title.dataset.path !== path) {
      return;
    }

    const content = title.querySelector<HTMLElement>(".nav-file-title-content");
    if (!content) {
      return;
    }
    if (!isArborManagedText(text)) {
      this.removeBadge(title);
      return;
    }

    if (!content.querySelector(".arbor-file-badge")) {
      const badge = document.createElement("span");
      badge.className = "arbor-file-badge";
      badge.textContent = "ARBOR";
      content.append(badge);
    }
  }

  private removeBadge(title: HTMLElement): void {
    title.querySelectorAll(".arbor-file-badge").forEach((badge) => badge.remove());
  }
}
