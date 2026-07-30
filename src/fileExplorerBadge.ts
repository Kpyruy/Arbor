import { App, EventRef, TFile } from "obsidian";
import { isArborManagedText } from "./fileExplorerBadgeRecognition";
import { ArborBadgeGeneration } from "./fileExplorerBadgeLifecycle";

export { isArborManagedText } from "./fileExplorerBadgeRecognition";

const REFRESH_DELAY_MS = 100;

export class ArborFileExplorerBadge {
  private readonly observers = new Map<HTMLElement, MutationObserver>();
  private readonly observedDocuments = new Set<Document>();
  private readonly vaultEventRefs: EventRef[];
  private readonly workspaceEventRefs: EventRef[];
  private readonly generation = new ArborBadgeGeneration();
  private refreshTimer: number | null = null;

  constructor(private readonly app: App) {
    this.vaultEventRefs = [
      this.app.vault.on("create", () => this.scheduleRefresh()),
      this.app.vault.on("modify", () => this.scheduleRefresh()),
      this.app.vault.on("rename", () => this.scheduleRefresh()),
      this.app.vault.on("delete", () => this.scheduleRefresh())
    ];
    this.workspaceEventRefs = [
      this.app.workspace.on("layout-change", () => this.scheduleRefresh())
    ];
    this.app.workspace.onLayoutReady(() => this.scheduleRefresh());
  }

  async refresh(): Promise<void> {
    if (this.generation.isDisposed) {
      return;
    }
    const refreshGeneration = this.generation.beginRefresh();
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
      Array.from(container.querySelectorAll<HTMLElement>(".nav-file-title[data-path]")).map((title) => this.decorateTitle(title, refreshGeneration))
    ));
  }

  unload(): void {
    this.generation.dispose();
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
    this.vaultEventRefs.forEach((eventRef) => this.app.vault.offref(eventRef));
    this.workspaceEventRefs.forEach((eventRef) => this.app.workspace.offref(eventRef));
    this.observedDocuments.forEach((document) => {
      document.querySelectorAll(".arbor-file-badge").forEach((badge) => badge.remove());
      document.querySelectorAll<HTMLElement>(".nav-file-title-content.has-arbor-file-badge").forEach((content) => {
        content.removeClass("has-arbor-file-badge");
      });
    });
    this.observedDocuments.clear();
  }

  private observeContainer(container: HTMLElement): void {
    if (this.observers.has(container)) {
      return;
    }
    this.observedDocuments.add(container.ownerDocument);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const target = mutation.target as HTMLElement;
        if (mutation.type === "attributes" && target.matches?.(".nav-file-title")) {
          this.removeBadge(target);
        }
      });
      this.scheduleRefresh();
    });
    observer.observe(container, { attributes: true, attributeFilter: ["data-path"], childList: true, subtree: true });
    this.observers.set(container, observer);
  }

  private scheduleRefresh(): void {
    if (this.generation.isDisposed) {
      return;
    }
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private async decorateTitle(title: HTMLElement, refreshGeneration: number): Promise<void> {
    const path = title.dataset.path;
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile) || file.extension !== "md") {
      this.removeBadge(title);
      return;
    }

    const text = await this.app.vault.cachedRead(file);
    if (!this.generation.isCurrent(refreshGeneration) || !title.isConnected || title.dataset.path !== path) {
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

    content.addClass("has-arbor-file-badge");
    if (!content.querySelector(".arbor-file-badge")) {
      content.createSpan({ cls: "arbor-file-badge", text: "ARBOR" });
    }
  }

  private removeBadge(title: HTMLElement): void {
    title.querySelectorAll(".arbor-file-badge").forEach((badge) => badge.remove());
    title.querySelector<HTMLElement>(".nav-file-title-content")?.removeClass("has-arbor-file-badge");
  }
}
