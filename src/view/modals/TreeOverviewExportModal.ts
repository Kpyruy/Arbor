import { ButtonComponent, Modal, Platform } from "obsidian";
import {
  DEFAULT_TREE_OVERVIEW_EXPORT_QUALITY,
  TreeOverviewExportFormat,
  TreeOverviewExportQuality
} from "../../treeOverviewExport";

export interface TreeOverviewExportOptions {
  format: TreeOverviewExportFormat;
  quality: TreeOverviewExportQuality;
}

export class TreeOverviewExportModal extends Modal {
  private resolved = false;
  private format: TreeOverviewExportFormat = "png";
  private quality: TreeOverviewExportQuality = Platform.isMobile ? "standard" : DEFAULT_TREE_OVERVIEW_EXPORT_QUALITY;
  private resolver: (value: TreeOverviewExportOptions | null) => void = () => undefined;

  waitForChoice(): Promise<TreeOverviewExportOptions | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Export tree overview" });
    this.modalEl.addClass("arbor-export-modal");
    contentEl.createEl("p", {
      text: "Export every branch as one full-page image or PDF. The current zoom and viewport position do not affect the result."
    });

    const choicesEl = contentEl.createDiv({ cls: "arbor-clean-export-choices" });
    const formatGroup = choicesEl.createDiv({ cls: "arbor-clean-export-group" });
    formatGroup.createDiv({ cls: "arbor-tree-export-choice-heading", text: "Format" });
    this.addFormatChoice(formatGroup, "png", "PNG image");
    this.addFormatChoice(formatGroup, "pdf", "PDF — one large page");
    const qualityGroup = choicesEl.createDiv({ cls: "arbor-clean-export-group" });
    qualityGroup.createDiv({ cls: "arbor-tree-export-choice-heading", text: "Quality" });
    this.addQualityChoice(qualityGroup, "standard", Platform.isMobile ? "Standard — 1× (recommended)" : "Standard — 1×");
    this.addQualityChoice(qualityGroup, "high", Platform.isMobile ? "High — 2×" : "High — 2× (recommended)");
    this.addQualityChoice(qualityGroup, "ultra", "Ultra — 4×");

    const actionsEl = contentEl.createDiv({ cls: "arbor-confirm-actions" });
    new ButtonComponent(actionsEl)
      .setButtonText("Cancel")
      .onClick(() => this.finish(null));
    new ButtonComponent(actionsEl)
      .setButtonText("Export tree overview")
      .setCta()
      .onClick(() => this.finish({ format: this.format, quality: this.quality }));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolver(null);
    }
  }

  private addFormatChoice(container: HTMLElement, value: TreeOverviewExportFormat, label: string): void {
    const choiceEl = container.createEl("label", { cls: "arbor-clean-export-choice" });
    const input = choiceEl.createEl("input", {
      attr: { type: "radio", name: "arbor-tree-export-format", value }
    });
    input.checked = this.format === value;
    input.addEventListener("change", () => {
      if (input.checked) {
        this.format = value;
      }
    });
    choiceEl.createSpan({ text: label });
  }

  private addQualityChoice(container: HTMLElement, value: TreeOverviewExportQuality, label: string): void {
    const choiceEl = container.createEl("label", { cls: "arbor-clean-export-choice" });
    const input = choiceEl.createEl("input", {
      attr: { type: "radio", name: "arbor-tree-export-quality", value }
    });
    input.checked = this.quality === value;
    input.addEventListener("change", () => {
      if (input.checked) {
        this.quality = value;
      }
    });
    choiceEl.createSpan({ text: label });
  }

  private finish(value: TreeOverviewExportOptions | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver(value);
    this.close();
  }
}
