import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { ArborCustomTheme, ArborSavedTheme } from "./types";
import {
  ARBOR_THEME_VARIABLES,
  AUTOMATIC_THEME_ID,
  ArborThemeState,
  BUILT_IN_THEMES,
  cloneThemeState,
  DEFAULT_CUSTOM_THEME,
  findThemeById,
  resolveArborThemeVariables
} from "./theme";

export interface ThemeStudioController {
  initialState: ArborThemeState;
  preview: (state: ArborThemeState) => void;
  apply: (state: ArborThemeState) => Promise<void>;
  cancel: () => void;
  closed: () => void;
}

export class ThemeStudioModal extends Modal {
  private readonly draft: ArborThemeState;
  private resolved = false;
  private previewEl: HTMLElement | null = null;

  constructor(app: App, private readonly controller: ThemeStudioController) {
    super(app);
    this.draft = cloneThemeState(controller.initialState);
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-theme-studio-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.controller.cancel();
    }
    this.controller.closed();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Theme studio" });
    contentEl.createEl("p", {
      cls: "arbor-theme-studio-description",
      text: "Preview, create and manage themes. Changes stay temporary until you apply them."
    });

    this.previewEl = contentEl.createDiv({ cls: "arbor-theme-studio-preview" });
    this.renderPreview();

    const catalog = contentEl.createDiv({ cls: "arbor-theme-studio-catalog" });
    this.renderThemeSection(catalog, "Obsidian", [{
      id: AUTOMATIC_THEME_ID,
      name: "Automatic",
      palette: this.readObsidianPalette()
    }], "Follows the active Obsidian theme");
    this.renderThemeSection(catalog, "Built-in themes", [...BUILT_IN_THEMES], "Ready-made Arbor palettes");
    this.renderCustomThemes(catalog);
    this.renderSelectedThemeEditor(contentEl);

    const actions = contentEl.createDiv({ cls: "arbor-theme-studio-footer" });
    new ButtonComponent(actions)
      .setButtonText("Cancel")
      .onClick(() => this.cancel());
    new ButtonComponent(actions)
      .setButtonText("Apply theme")
      .setCta()
      .onClick(() => void this.apply());
  }

  private renderThemeSection(
    container: HTMLElement,
    title: string,
    themes: readonly ArborSavedTheme[],
    description: string
  ): void {
    const section = container.createDiv({ cls: "arbor-theme-studio-section" });
    const heading = section.createDiv({ cls: "arbor-theme-studio-section-heading" });
    heading.createEl("h3", { text: title });
    heading.createSpan({ text: description });
    const grid = section.createDiv({ cls: "arbor-theme-studio-grid" });
    themes.forEach((theme) => this.renderThemeCard(grid, theme));
  }

  private renderCustomThemes(container: HTMLElement): void {
    const section = container.createDiv({ cls: "arbor-theme-studio-section" });
    const heading = section.createDiv({ cls: "arbor-theme-studio-section-heading arbor-theme-studio-my-themes" });
    const label = heading.createDiv();
    label.createEl("h3", { text: "My themes" });
    label.createSpan({
      text: this.draft.customThemes.length > 0
        ? "Your saved palettes"
        : "No custom themes yet"
    });
    new ButtonComponent(heading)
      .setButtonText("New theme")
      .onClick(() => this.createTheme());

    if (this.draft.customThemes.length === 0) {
      return;
    }
    const grid = section.createDiv({ cls: "arbor-theme-studio-grid" });
    this.draft.customThemes.forEach((theme) => this.renderThemeCard(grid, theme));
  }

  private renderThemeCard(container: HTMLElement, theme: ArborSavedTheme): void {
    const card = container.createEl("button", {
      cls: "arbor-theme-studio-card",
      attr: { type: "button", "aria-label": `Preview ${theme.name} theme` }
    });
    card.toggleClass("is-selected", theme.id === this.draft.activeThemeId);
    card.setCssProps({
      "--arbor-theme-swatch-accent": theme.palette.accent,
      "--arbor-theme-swatch-canvas": theme.palette.canvas,
      "--arbor-theme-swatch-card": theme.palette.card,
      "--arbor-theme-swatch-muted": theme.palette.muted,
      "--arbor-theme-swatch-text": theme.palette.text
    });
    const visual = card.createDiv({ cls: "arbor-theme-studio-card-visual" });
    visual.createSpan({ cls: "arbor-theme-studio-card-node is-root" });
    visual.createSpan({ cls: "arbor-theme-studio-card-line" });
    visual.createSpan({ cls: "arbor-theme-studio-card-node" });
    const label = card.createDiv({ cls: "arbor-theme-studio-card-label" });
    label.createSpan({ text: theme.name });
    label.createSpan({
      cls: "arbor-theme-studio-card-kind",
      text: theme.id === AUTOMATIC_THEME_ID
        ? "Obsidian"
        : theme.id.startsWith("builtin:") ? "Built-in" : "Custom"
    });
    card.addEventListener("click", () => {
      this.draft.activeThemeId = theme.id;
      this.previewDraft();
      this.render();
    });
  }

  private renderPreview(): void {
    const preview = this.previewEl;
    if (!preview) {
      return;
    }
    preview.empty();
    this.applyVariables(preview);
    const tree = preview.createDiv({ cls: "arbor-theme-studio-preview-tree" });
    const root = tree.createDiv({ cls: "arbor-theme-studio-preview-node is-root" });
    root.createEl("strong", { text: "Main idea" });
    root.createSpan({ text: "A focused starting point" });
    tree.createSpan({ cls: "arbor-theme-studio-preview-connector" });
    const branches = tree.createDiv({ cls: "arbor-theme-studio-preview-branches" });
    const first = branches.createDiv({ cls: "arbor-theme-studio-preview-node is-selected" });
    first.createEl("strong", { text: "Selected branch" });
    first.createSpan({ text: "Accent and readable text" });
    const second = branches.createDiv({ cls: "arbor-theme-studio-preview-node" });
    second.createEl("strong", { text: "Next thought" });
    second.createSpan({ text: "Muted context stays visible" });
  }

  private renderSelectedThemeEditor(container: HTMLElement): void {
    const selected = findThemeById(this.draft.activeThemeId, this.draft.customThemes);
    if (!selected) {
      return;
    }

    const editor = container.createDiv({ cls: "arbor-theme-studio-editor" });
    const custom = this.draft.customThemes.find((theme) => theme.id === selected.id) ?? null;
    const heading = new Setting(editor)
      .setName(custom ? "Edit custom theme" : `${selected.name} preset`)
      .setHeading();
    if (!custom) {
      heading.setDesc("Built-in themes are read-only. Duplicate one to create an editable copy.");
      new Setting(editor)
        .setName("Create editable copy")
        .addButton((button) =>
          button.setButtonText("Duplicate").onClick(() => this.duplicateTheme(selected))
        );
      return;
    }

    new Setting(editor)
      .setName("Theme name")
      .addText((text) =>
        text.setValue(custom.name).onChange((value) => {
          const name = value.trim();
          if (name) {
            custom.name = name;
          }
        })
      );
    this.addColorSetting(editor, custom, "Canvas", "canvas");
    this.addColorSetting(editor, custom, "Card surface", "card");
    this.addColorSetting(editor, custom, "Text", "text");
    this.addColorSetting(editor, custom, "Muted text", "muted");
    this.addColorSetting(editor, custom, "Accent", "accent");

    const tools = new Setting(editor).setName("Theme actions");
    tools.addButton((button) =>
      button.setButtonText("Duplicate").onClick(() => this.duplicateTheme(custom))
    );
    tools.addButton((button) =>
      button.setButtonText("Delete").setWarning().onClick(() => this.deleteTheme(custom.id))
    );
  }

  private addColorSetting(
    container: HTMLElement,
    theme: ArborSavedTheme,
    name: string,
    key: keyof ArborCustomTheme
  ): void {
    new Setting(container)
      .setName(name)
      .addColorPicker((picker) =>
        picker.setValue(theme.palette[key]).onChange((value) => {
          theme.palette[key] = value;
          this.previewDraft();
          this.renderPreview();
        })
      );
  }

  private createTheme(source: ArborSavedTheme | null = null, requestedName = "My theme"): void {
    const theme: ArborSavedTheme = {
      id: `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: this.uniqueName(requestedName),
      palette: { ...(source?.palette ?? DEFAULT_CUSTOM_THEME) }
    };
    this.draft.customThemes.push(theme);
    this.draft.activeThemeId = theme.id;
    this.previewDraft();
    this.render();
  }

  private duplicateTheme(source: ArborSavedTheme): void {
    this.createTheme(source, `${source.name} copy`);
  }

  private deleteTheme(themeId: string): void {
    this.draft.customThemes = this.draft.customThemes.filter((theme) => theme.id !== themeId);
    this.draft.activeThemeId = AUTOMATIC_THEME_ID;
    this.previewDraft();
    this.render();
  }

  private uniqueName(requestedName: string): string {
    const base = requestedName.trim() || "My theme";
    const existing = new Set(this.draft.customThemes.map((theme) => theme.name.toLocaleLowerCase()));
    if (!existing.has(base.toLocaleLowerCase())) {
      return base;
    }
    let index = 2;
    while (existing.has(`${base} ${index}`.toLocaleLowerCase())) {
      index += 1;
    }
    return `${base} ${index}`;
  }

  private previewDraft(): void {
    this.controller.preview(cloneThemeState(this.draft));
  }

  private applyVariables(element: HTMLElement): void {
    const variables = resolveArborThemeVariables(this.draft.activeThemeId, this.draft.customThemes);
    element.setCssProps(Object.fromEntries(
      ARBOR_THEME_VARIABLES.map((name) => [name, variables[name] ?? ""])
    ));
  }

  private readObsidianPalette(): ArborCustomTheme {
    const style = window.getComputedStyle(this.contentEl.ownerDocument.body);
    return {
      canvas: style.getPropertyValue("--background-primary").trim() || DEFAULT_CUSTOM_THEME.canvas,
      card: style.getPropertyValue("--background-secondary").trim() || DEFAULT_CUSTOM_THEME.card,
      text: style.getPropertyValue("--text-normal").trim() || DEFAULT_CUSTOM_THEME.text,
      muted: style.getPropertyValue("--text-muted").trim() || DEFAULT_CUSTOM_THEME.muted,
      accent: style.getPropertyValue("--interactive-accent").trim() || DEFAULT_CUSTOM_THEME.accent
    };
  }

  private cancel(): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.controller.cancel();
    this.close();
  }

  private async apply(): Promise<void> {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    await this.controller.apply(cloneThemeState(this.draft));
    this.close();
  }
}
