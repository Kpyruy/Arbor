import { App, PluginSettingTab, Setting } from "obsidian";
import type ArborPlugin from "./main";
import { ArborSettings } from "./types";

export const DEFAULT_SETTINGS: ArborSettings = {
  splitDirection: "vertical",
  cardWidth: 300,
  cardMinHeight: 120,
  horizontalSpacing: 20,
  verticalSpacing: 12,
  zoomLevel: 1,
  previewSnippetLength: 220,
  dragAndDrop: true,
  dimNonPathBlocks: false,
  enableCtrlWheelZoom: true,
  autoOpenManagedNotes: true,
  showBreadcrumb: true,
  showBreadcrumbFlow: true,
  breadcrumbLabelPreferredPrefix: "#",
  breadcrumbLabelFallback: "firstLine",
  liveLinearPreview: false,
  metadataBlockStyle: "multiline"
};

export class ArborSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ArborPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Split direction")
      .setDesc("Where the Arbor view opens relative to the current note.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vertical", "Vertical split")
          .addOption("horizontal", "Horizontal split")
          .setValue(this.plugin.settings.splitDirection)
          .onChange(async (value) => {
            this.plugin.settings.splitDirection = value as ArborSettings["splitDirection"];
            await this.plugin.saveSettings();
          })
      );

    this.addNumericSetting(containerEl, "Card width", "Card width in pixels.", "cardWidth", 220, 520, 10);
    this.addNumericSetting(containerEl, "Card minimum height", "Minimum card height in pixels.", "cardMinHeight", 80, 300, 10);
    this.addNumericSetting(containerEl, "Horizontal spacing", "Space between columns in pixels.", "horizontalSpacing", 8, 48, 2);
    this.addNumericSetting(containerEl, "Vertical spacing", "Space between cards in pixels.", "verticalSpacing", 4, 32, 2);
    this.addNumericSetting(containerEl, "Default zoom", "Default scene zoom level.", "zoomLevel", 70, 160, 5, "%");
    this.addNumericSetting(containerEl, "Preview snippet length", "Maximum characters to show in card preview.", "previewSnippetLength", 80, 600, 10);

    new Setting(containerEl)
      .setName("Drag and drop")
      .setDesc("Enable drag-and-drop reordering across columns.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dragAndDrop).onChange(async (value) => {
          this.plugin.settings.dragAndDrop = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllBranchViews();
        })
      );

    new Setting(containerEl)
      .setName("Ctrl+wheel zoom")
      .setDesc("Zoom the branching scene with Ctrl/Cmd + mouse wheel.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableCtrlWheelZoom).onChange(async (value) => {
          this.plugin.settings.enableCtrlWheelZoom = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-open managed notes")
      .setDesc("Open notes with Arbor metadata directly in the Arbor view when you open them normally.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpenManagedNotes).onChange(async (value) => {
          this.plugin.settings.autoOpenManagedNotes = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show breadcrumb path")
      .setDesc("Show the active block path as a breadcrumb strip.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showBreadcrumb).onChange(async (value) => {
          this.plugin.settings.showBreadcrumb = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllBranchViews();
        })
      );

    new Setting(containerEl)
      .setName("Show breadcrumb flow")
      .setDesc("Show subtle connectors between breadcrumb items.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showBreadcrumbFlow).onChange(async (value) => {
          this.plugin.settings.showBreadcrumbFlow = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllBranchViews();
        })
      );

    new Setting(containerEl)
      .setName("Preferred breadcrumb line prefix")
      .setDesc("Use the first non-empty line that starts with this prefix for breadcrumb labels. Leave blank to skip prefix matching.")
      .addText((text) =>
        text
          .setPlaceholder("#")
          .setValue(this.plugin.settings.breadcrumbLabelPreferredPrefix)
          .onChange(async (value) => {
            this.plugin.settings.breadcrumbLabelPreferredPrefix = value.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews();
          })
      );

    new Setting(containerEl)
      .setName("Breadcrumb fallback")
      .setDesc("What to use when no preferred-prefix line exists.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("firstLine", "First non-empty line")
          .addOption("snippet", "Clean snippet")
          .addOption("none", "No fallback")
          .setValue(this.plugin.settings.breadcrumbLabelFallback)
          .onChange(async (value) => {
            this.plugin.settings.breadcrumbLabelFallback = value as ArborSettings["breadcrumbLabelFallback"];
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews();
          })
      );

    new Setting(containerEl)
      .setName("Selected block panel")
      .setDesc("Show the focused selected-block panel alongside the branching editor.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.liveLinearPreview).onChange(async (value) => {
          this.plugin.settings.liveLinearPreview = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllBranchViews();
        })
      );

    new Setting(containerEl)
      .setName("Managed metadata block style")
      .setDesc("How hidden in-note tree metadata is stored.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("multiline", "Multiline HTML comment")
          .addOption("compact", "Compact single-line HTML comment")
          .setValue(this.plugin.settings.metadataBlockStyle)
          .onChange(async (value) => {
            this.plugin.settings.metadataBlockStyle = value as ArborSettings["metadataBlockStyle"];
            await this.plugin.saveSettings();
          })
      );
  }

  private addNumericSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    key: keyof Pick<
      ArborSettings,
      "cardWidth" | "cardMinHeight" | "horizontalSpacing" | "verticalSpacing" | "zoomLevel" | "previewSnippetLength"
    >,
    min: number,
    max: number,
    step: number,
    format: "px" | "%" | "raw" = "px"
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addSlider((slider) =>
        slider
          .setLimits(min, max, step)
          .setDynamicTooltip()
          .setValue(key === "zoomLevel" ? Math.round(this.plugin.settings[key] * 100) : this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = (key === "zoomLevel" ? value / 100 : value) as ArborSettings[typeof key];
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews();
          })
      );
  }
}
