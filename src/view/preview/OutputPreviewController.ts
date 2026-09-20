import { setIcon } from "obsidian";
import { cloneMetadata, updateBlockContent } from "../../model/tree";
import { projectOutput } from "../../outputProjection";
import type { EditingSession, MarkdownPort, ViewReadPort } from "../state/viewTypes";

export interface OutputPreviewPort {
  read: ViewReadPort;
  markdown: MarkdownPort;
  getStage(): HTMLElement | null;
  getSession(): EditingSession | null;
  closeOutputPreview(): void;
  exportCleanCopy(): Promise<void>;
}

export class OutputPreviewController {
  private outputSurfaceEl: HTMLElement | null = null;
  private outputRenderVersion = 0;

  constructor(private readonly port: OutputPreviewPort) {}

  invalidate(): void {
    this.outputRenderVersion += 1;
  }

  async syncOutputPreview(): Promise<void> {
    const stage = this.port.getStage();
    const state = this.port.read.getState();
    if (!stage || !state) {
      return;
    }

    stage.querySelectorAll<HTMLElement>(".arbor-output-preview-surface.is-staging")
      .forEach((surface) => surface.remove());
    const renderVersion = this.outputRenderVersion;
    let metadata = cloneMetadata(state.metadata);
    const session = this.port.getSession();
    if (session) {
      metadata = updateBlockContent(metadata, session.blockId, session.value);
    }
    const projection = projectOutput(metadata, state.outputState);
    const surface = stage.createDiv({ cls: "arbor-output-preview-surface is-staging" });
    const header = surface.createDiv({ cls: "arbor-output-preview-header" });
    const heading = header.createDiv({ cls: "arbor-output-preview-heading" });
    heading.createEl("h2", { text: projection.profile.name });
    heading.createEl("p", {
      text: `${projection.excludedCount} hidden block${projection.excludedCount === 1 ? "" : "s"}`
    });
    const actions = header.createDiv({ cls: "arbor-output-preview-actions" });
    const returnButton = actions.createEl("button", {
      attr: { type: "button" }
    });
    setIcon(returnButton, "git-fork");
    returnButton.createSpan({ text: "Return to editor" });
    returnButton.addEventListener("click", () => this.port.closeOutputPreview());
    const exportButton = actions.createEl("button", {
      cls: "mod-cta",
      attr: { type: "button" }
    });
    setIcon(exportButton, "file-output");
    exportButton.createSpan({ text: "Export clean copy" });
    exportButton.addEventListener("click", () => void this.port.exportCleanCopy());

    const content = surface.createDiv({
      cls: "arbor-output-preview-content",
      attr: { "aria-label": `Output preview: ${projection.profile.name}` }
    });
    if (projection.prefix.trim().length > 0) {
      const prefix = content.createDiv({ cls: "arbor-output-preview-prefix markdown-rendered" });
      await this.port.markdown.render(projection.prefix, prefix, this.port.read.getFilePath());
    }

    for (const entry of projection.included) {
      if (renderVersion !== this.outputRenderVersion) {
        surface.remove();
        return;
      }
      const block = content.createDiv({ cls: "arbor-output-preview-block markdown-rendered" });
      block.dataset.blockId = entry.block.id;
      block.dataset.depth = String(entry.depth);
      await this.port.markdown.render(entry.block.content, block, this.port.read.getFilePath());
    }

    if (projection.included.length === 0 && projection.prefix.trim().length === 0) {
      content.createDiv({
        cls: "arbor-output-preview-empty",
        text: "No blocks are included in this output profile."
      });
    }

    if (renderVersion !== this.outputRenderVersion) {
      surface.remove();
      return;
    }
    this.outputSurfaceEl?.remove();
    surface.removeClass("is-staging");
    this.outputSurfaceEl = surface;
  }

  reset(): void {
    this.invalidate();
    this.outputSurfaceEl?.remove();
    this.outputSurfaceEl = null;
  }
}
