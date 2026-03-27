import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_ARBOR_LOADING } from "../constants";
import type ArborPlugin from "../main";

export class ArborLoadingView extends FileView {
  navigation = true;
  private resolveStarted = false;
  private resolveRetryTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ArborPlugin) {
    super(leaf);
    this.allowNoFile = false;
  }

  getViewType(): string {
    return VIEW_TYPE_ARBOR_LOADING;
  }

  getDisplayText(): string {
    return this.file ? `Arbor: ${this.file.basename}` : "Arbor";
  }

  getIcon(): string {
    return "git-fork";
  }

  override async onOpen(): Promise<void> {
    this.render();
    this.queueResolve();
  }

  clear(): void {
    this.clearResolveRetryTimer();
    this.contentEl.empty();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.render();
    this.queueResolve(file);
  }

  override async onUnloadFile(): Promise<void> {
    this.resolveStarted = false;
    this.clearResolveRetryTimer();
  }

  override async onClose(): Promise<void> {
    this.resolveStarted = false;
    this.clearResolveRetryTimer();
    return super.onClose();
  }

  private queueResolve(file: TFile | null = this.getResolvableFile(), attempt = 0): void {
    if (this.resolveStarted) {
      return;
    }

    if (file) {
      void this.resolveLoadingTarget(file);
      return;
    }

    if (attempt >= 80) {
      void this.fallbackAfterResolveTimeout();
      return;
    }

    this.clearResolveRetryTimer();
    this.resolveRetryTimer = window.setTimeout(() => {
      this.resolveRetryTimer = null;
      this.queueResolve(this.getResolvableFile(), attempt + 1);
    }, 25);
  }

  private getResolvableFile(): TFile | null {
    if (this.file) {
      return this.file;
    }

    const filePath = this.leaf.getViewState().state?.file;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    return file instanceof TFile ? file : null;
  }

  private getResolvableFilePath(): string | null {
    if (this.file?.path) {
      return this.file.path;
    }

    const filePath = this.leaf.getViewState().state?.file;
    return typeof filePath === "string" && filePath.length > 0 ? filePath : null;
  }

  private async resolveLoadingTarget(file: TFile): Promise<void> {
    if (this.resolveStarted) {
      return;
    }

    this.resolveStarted = true;

    try {
      await this.plugin.resolveLoadingLeafOpen(file, this.leaf, {
        beforeSwap: () => this.playExitAnimation()
      });
    } catch (error) {
      console.error("Arbor loading view failed to resolve", error);
      this.resolveStarted = false;
      this.plugin.suppressAutoOpenOnce(file.path);
      await this.leaf.setViewState({
        type: "markdown",
        active: true,
        state: {
          file: file.path
        }
      });
      await this.app.workspace.revealLeaf(this.leaf);
    }
  }

  private async fallbackAfterResolveTimeout(): Promise<void> {
    if (this.resolveStarted) {
      return;
    }

    const filePath = this.getResolvableFilePath();
    if (!filePath) {
      this.renderFailureState();
      new Notice("Arbor could not resolve the note. Try opening it again.");
      return;
    }

    this.resolveStarted = true;
    try {
      this.plugin.suppressAutoOpenOnce(filePath);
      await this.leaf.setViewState({
        type: "markdown",
        active: true,
        state: {
          file: filePath
        }
      });
      await this.app.workspace.revealLeaf(this.leaf);
      new Notice("Open this note in Markdown instead.");
    } finally {
      this.resolveStarted = false;
    }
  }

  private async playExitAnimation(): Promise<void> {
    this.contentEl.addClass("is-resolving");
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 110);
    });
  }

  private clearResolveRetryTimer(): void {
    if (this.resolveRetryTimer !== null) {
      window.clearTimeout(this.resolveRetryTimer);
      this.resolveRetryTimer = null;
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("arbor-loading-view");
    contentEl.removeClass("is-resolving");

    const panel = contentEl.createDiv({ cls: "arbor-loading-view-panel" });
    panel.createEl("h2", {
      cls: "arbor-loading-view-title",
      text: "Opening branch view"
    });
    panel.createEl("p", {
      cls: "arbor-loading-view-description",
      text: "Preparing a precise block layout before the note appears."
    });
  }

  private renderFailureState(): void {
    this.render();
    const panel = this.contentEl.querySelector(".arbor-loading-view-panel");
    if (!(panel instanceof HTMLElement)) {
      return;
    }

    panel.empty();
    panel.createEl("h2", {
      cls: "arbor-loading-view-title",
      text: "Could not open branch view"
    });
    panel.createEl("p", {
      cls: "arbor-loading-view-description",
      text: "Open this note in Markdown instead."
    });
  }
}
