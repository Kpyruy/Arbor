import { App, PluginSettingTab, Setting } from "obsidian";
import type ArborPlugin from "./main";
import { ArborCustomTheme, ArborSavedTheme, ArborSettings } from "./types";
import {
  AUTOMATIC_THEME_ID,
  BUILT_IN_THEMES,
  DEFAULT_CUSTOM_THEME,
  findThemeById
} from "./theme";

type ArborSettingControl =
  | { type: "dropdown"; key: keyof ArborSettings; options: Record<string, string>; defaultValue?: string }
  | { type: "slider"; key: keyof ArborSettings; min: number; max: number; step: number; defaultValue?: number; displayFormat?: (value: number) => string }
  | { type: "toggle"; key: keyof ArborSettings; defaultValue?: boolean }
  | { type: "text"; key: keyof ArborSettings; placeholder?: string; defaultValue?: string };

interface ArborSettingDefinition {
  name: string;
  desc: string;
  control: ArborSettingControl;
}

export const DEFAULT_SETTINGS: ArborSettings = {
  layoutDirection: "ltr",
  activeThemeId: AUTOMATIC_THEME_ID,
  customThemes: [],
  defaultPresentationMode: "editor",
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
  liveLinearPreview: false
};

export class ArborSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ArborPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): ArborSettingDefinition[] {
    return [
      {
        name: "Theme",
        desc: "Follow the active Obsidian theme or select a built-in or custom Arbor preset.",
        control: {
          type: "dropdown",
          key: "activeThemeId",
          options: this.themeOptions(),
          defaultValue: DEFAULT_SETTINGS.activeThemeId
        }
      },
      {
        name: "Layout direction",
        desc: "Choose which side the root starts on. Text and Markdown stay unchanged.",
        control: {
          type: "dropdown",
          key: "layoutDirection",
          options: { ltr: "Left to right", rtl: "Right to left" },
          defaultValue: DEFAULT_SETTINGS.layoutDirection
        }
      },
      {
        name: "Default opening mode",
        desc: "Choose whether Arbor notes open in the branch editor or the full tree overview.",
        control: {
          type: "dropdown",
          key: "defaultPresentationMode",
          options: { editor: "Branch editor", overview: "Tree overview" },
          defaultValue: DEFAULT_SETTINGS.defaultPresentationMode
        }
      },
      {
        name: "Split direction",
        desc: "Choose where the branch view opens relative to the current note.",
        control: {
          type: "dropdown",
          key: "splitDirection",
          options: { vertical: "Vertical split", horizontal: "Horizontal split" },
          defaultValue: DEFAULT_SETTINGS.splitDirection
        }
      },
      this.sliderDefinition("Card width", "Card width in pixels.", "cardWidth", 220, 520, 10),
      this.sliderDefinition("Card minimum height", "Minimum card height in pixels.", "cardMinHeight", 80, 300, 10),
      this.sliderDefinition("Horizontal spacing", "Space between columns in pixels.", "horizontalSpacing", 8, 48, 2),
      this.sliderDefinition("Vertical spacing", "Space between cards in pixels.", "verticalSpacing", 4, 32, 2),
      this.sliderDefinition("Default zoom", "Default scene zoom level.", "zoomLevel", 50, 160, 5, "%"),
      this.sliderDefinition("Preview snippet length", "Maximum characters to show in card preview.", "previewSnippetLength", 80, 600, 10),
      this.toggleDefinition("Drag and drop", "Enable drag-and-drop reordering across columns.", "dragAndDrop"),
      this.toggleDefinition("Ctrl/Cmd + wheel zoom", "Zoom the branching scene with Ctrl/Cmd + mouse wheel.", "enableCtrlWheelZoom"),
      this.toggleDefinition("Auto-open managed notes", "Open managed notes directly in the branch view when you open them normally.", "autoOpenManagedNotes"),
      this.toggleDefinition("Show breadcrumb path", "Show the active block path as a breadcrumb strip.", "showBreadcrumb"),
      this.toggleDefinition("Show breadcrumb flow", "Show subtle connectors between breadcrumb items.", "showBreadcrumbFlow"),
      {
        name: "Preferred breadcrumb line prefix",
        desc: "Use the first non-empty line that starts with this prefix for breadcrumb labels. Leave blank to skip prefix matching.",
        control: {
          type: "text",
          key: "breadcrumbLabelPreferredPrefix",
          placeholder: "#",
          defaultValue: DEFAULT_SETTINGS.breadcrumbLabelPreferredPrefix
        }
      },
      {
        name: "Breadcrumb fallback",
        desc: "What to use when no preferred-prefix line exists.",
        control: {
          type: "dropdown",
          key: "breadcrumbLabelFallback",
          options: { firstLine: "First non-empty line", snippet: "Clean snippet", none: "No fallback" },
          defaultValue: DEFAULT_SETTINGS.breadcrumbLabelFallback
        }
      },
      this.toggleDefinition("Selected block panel", "Show the focused selected-block panel alongside the branching editor.", "liveLinearPreview")
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "zoomLevel") {
      return Math.round(this.plugin.settings.zoomLevel * 100);
    }
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS)) {
      return;
    }

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = key === "zoomLevel" && typeof value === "number"
      ? value / 100
      : key === "breadcrumbLabelPreferredPrefix" && typeof value === "string"
        ? value.trim()
        : value;
    await this.plugin.saveSettings();

    if (key === "layoutDirection") {
      this.plugin.refreshAllBranchViews({ layoutDirectionChanged: true });
    } else if (["activeThemeId", "cardWidth", "cardMinHeight", "horizontalSpacing", "verticalSpacing", "zoomLevel", "previewSnippetLength", "dragAndDrop", "showBreadcrumb", "showBreadcrumbFlow", "breadcrumbLabelPreferredPrefix", "breadcrumbLabelFallback", "liveLinearPreview"].includes(key)) {
      this.plugin.refreshAllBranchViews();
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderThemeSettings(containerEl);

    new Setting(containerEl)
      .setName("Layout direction")
      .setDesc("Choose which side the root starts on. Text and Markdown stay unchanged.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ltr", "Left to right")
          .addOption("rtl", "Right to left")
          .setValue(this.plugin.settings.layoutDirection)
          .onChange(async (value) => {
            this.plugin.settings.layoutDirection = value as ArborSettings["layoutDirection"];
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews({ layoutDirectionChanged: true });
          })
      );

    new Setting(containerEl)
      .setName("Default opening mode")
      .setDesc("Choose whether notes open in the branch editor or tree overview.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("editor", "Branch editor")
          .addOption("overview", "Tree overview")
          .setValue(this.plugin.settings.defaultPresentationMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultPresentationMode = value as ArborSettings["defaultPresentationMode"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Split direction")
      .setDesc("Choose where the branch view opens relative to the current note.")
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
    this.addNumericSetting(containerEl, "Default zoom", "Default scene zoom level.", "zoomLevel", 50, 160, 5, "%");
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
      .setName("Ctrl/Cmd + wheel zoom")
      .setDesc("Zoom the branching scene with Ctrl/Cmd + mouse wheel.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableCtrlWheelZoom).onChange(async (value) => {
          this.plugin.settings.enableCtrlWheelZoom = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-open managed notes")
      .setDesc("Open managed notes directly in the branch view when you open them normally.")
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

  }

  private themeOptions(): Record<string, string> {
    const options: Record<string, string> = { [AUTOMATIC_THEME_ID]: "Automatic — Obsidian" };
    BUILT_IN_THEMES.forEach((theme) => {
      options[theme.id] = `Built-in · ${theme.name}`;
    });
    this.plugin.settings.customThemes.forEach((theme) => {
      options[theme.id] = `My themes · ${theme.name}`;
    });
    return options;
  }

  private renderThemeSettings(container: HTMLElement): void {
    const selectedTheme = findThemeById(
      this.plugin.settings.activeThemeId,
      this.plugin.settings.customThemes
    );
    const selectedCustomTheme = this.plugin.settings.customThemes.find(
      (theme) => theme.id === this.plugin.settings.activeThemeId
    ) ?? null;
    const themeSetting = new Setting(container)
      .setName("Theme")
      .setDesc("Follow Obsidian or choose a built-in or saved theme.")
      .addDropdown((dropdown) => {
        Object.entries(this.themeOptions()).forEach(([id, label]) => {
          dropdown.addOption(id, label);
        });
        dropdown
          .setValue(this.plugin.settings.activeThemeId)
          .onChange(async (value) => {
            this.plugin.settings.activeThemeId = value;
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews();
            this.display();
          });
      })
      .addButton((button) =>
        button
          .setButtonText("New theme")
          .onClick(() => void this.createCustomTheme(selectedTheme))
      );

    if (selectedTheme) {
      themeSetting.addButton((button) =>
        button
          .setButtonText("Duplicate")
          .onClick(() => void this.createCustomTheme(selectedTheme, `${selectedTheme.name} copy`))
      );
    }

    if (selectedCustomTheme) {
      let deleteArmed = false;
      themeSetting.addButton((button) =>
        button
          .setButtonText("Delete")
          .setWarning()
          .onClick(async () => {
            if (!deleteArmed) {
              deleteArmed = true;
              button.setButtonText("Confirm delete");
              return;
            }
            this.plugin.settings.customThemes = this.plugin.settings.customThemes.filter(
              (theme) => theme.id !== selectedCustomTheme.id
            );
            this.plugin.settings.activeThemeId = AUTOMATIC_THEME_ID;
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews();
            this.display();
          })
      );
    }

    if (!selectedCustomTheme) {
      if (selectedTheme) {
        new Setting(container)
          .setName(`${selectedTheme.name} preset`)
          .setDesc("Built-in themes are read-only. Duplicate this preset to customize it.");
      }
      return;
    }

    new Setting(container).setName("Edit custom theme").setHeading();
    new Setting(container)
      .setName("Theme name")
      .setDesc("Name shown in the theme menu.")
      .addText((text) =>
        text
          .setValue(selectedCustomTheme.name)
          .onChange(async (value) => {
            const name = value.trim();
            if (!name) {
              return;
            }
            selectedCustomTheme.name = name;
            await this.plugin.saveSettings();
          })
      );
    this.addThemeColorSetting(container, selectedCustomTheme, "Canvas", "Background behind the Arbor workspace.", "canvas");
    this.addThemeColorSetting(container, selectedCustomTheme, "Card surface", "Background used by Arbor cards and panels.", "card");
    this.addThemeColorSetting(container, selectedCustomTheme, "Text", "Primary text color inside Arbor.", "text");
    this.addThemeColorSetting(container, selectedCustomTheme, "Muted text", "Secondary text and connector color.", "muted");
    this.addThemeColorSetting(container, selectedCustomTheme, "Accent", "Selection, focus and interactive accent color.", "accent");
  }

  private async createCustomTheme(source: ArborSavedTheme | null, requestedName = "My theme"): Promise<void> {
    const theme: ArborSavedTheme = {
      id: `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: this.uniqueThemeName(requestedName),
      palette: { ...(source?.palette ?? DEFAULT_CUSTOM_THEME) }
    };
    this.plugin.settings.customThemes.push(theme);
    this.plugin.settings.activeThemeId = theme.id;
    await this.plugin.saveSettings();
    this.plugin.refreshAllBranchViews();
    this.display();
  }

  private uniqueThemeName(requestedName: string): string {
    const base = requestedName.trim() || "My theme";
    const existing = new Set(this.plugin.settings.customThemes.map((theme) => theme.name.toLocaleLowerCase()));
    if (!existing.has(base.toLocaleLowerCase())) {
      return base;
    }
    let index = 2;
    while (existing.has(`${base} ${index}`.toLocaleLowerCase())) {
      index += 1;
    }
    return `${base} ${index}`;
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
    _format: "px" | "%" | "raw" = "px"
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
            const nextValue = key === "zoomLevel" ? value / 100 : value;
            this.plugin.settings[key] = nextValue;
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews();
          })
      );
  }

  private addThemeColorSetting(
    container: HTMLElement,
    theme: ArborSavedTheme,
    name: string,
    description: string,
    key: keyof ArborCustomTheme
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc(description)
      .addColorPicker((picker) =>
        picker
          .setValue(theme.palette[key])
          .onChange(async (value) => {
            theme.palette[key] = value;
            await this.plugin.saveSettings();
            this.plugin.refreshAllBranchViews();
          })
      );
  }

  private sliderDefinition(
    name: string,
    desc: string,
    key: Extract<keyof ArborSettings, "cardWidth" | "cardMinHeight" | "horizontalSpacing" | "verticalSpacing" | "zoomLevel" | "previewSnippetLength">,
    min: number,
    max: number,
    step: number,
    suffix = "px"
  ): ArborSettingDefinition {
    const defaultValue = key === "zoomLevel" ? DEFAULT_SETTINGS.zoomLevel * 100 : DEFAULT_SETTINGS[key];
    return {
      name,
      desc,
      control: {
        type: "slider",
        key,
        min,
        max,
        step,
        defaultValue,
        displayFormat: suffix === "%" ? (value) => `${value}%` : undefined
      }
    };
  }

  private toggleDefinition(
    name: string,
    desc: string,
    key: Extract<keyof ArborSettings, "dragAndDrop" | "enableCtrlWheelZoom" | "autoOpenManagedNotes" | "showBreadcrumb" | "showBreadcrumbFlow" | "liveLinearPreview">
  ): ArborSettingDefinition {
    return { name, desc, control: { type: "toggle", key, defaultValue: DEFAULT_SETTINGS[key] } };
  }
}
