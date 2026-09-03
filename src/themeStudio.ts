import { App, ButtonComponent, Menu, Modal, Setting } from "obsidian";
import { ArborCustomTheme, ArborSavedTheme } from "./types";
import {
  ARBOR_THEME_VARIABLES,
  AUTOMATIC_THEME_ID,
  ArborThemeState,
  BUILT_IN_THEMES,
  cloneThemeState,
  DEFAULT_CUSTOM_THEME,
  findThemeById,
  hasUnsavedThemeDraft,
  resolveArborPaletteVariables
} from "./theme";

export interface ThemeStudioController {
  initialState: ArborThemeState;
  applyTheme: (themeId: string) => Promise<ArborThemeState>;
  saveTheme: (theme: ArborSavedTheme) => Promise<ArborThemeState>;
  deleteTheme: (themeId: string) => Promise<ArborThemeState>;
  closed: () => void;
}

class ThemeStudioConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly description: string,
    private readonly confirmText: string,
    private readonly onConfirm: () => void | Promise<void>,
    private readonly onDismiss: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-theme-studio-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();
    const heading = contentEl.createDiv({ cls: "arbor-theme-studio-confirm-heading" });
    heading.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { cls: "arbor-theme-studio-confirm-description", text: this.description });
    const actions = contentEl.createDiv({ cls: "arbor-confirm-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(actions)
      .setButtonText(this.confirmText)
      .setWarning()
      .onClick(() => void this.confirm());
  }

  onClose(): void {
    this.contentEl.empty();
    this.onDismiss();
  }

  private async confirm(): Promise<void> {
    await this.onConfirm();
    this.close();
  }
}

interface ThemeEditorController {
  theme: ArborSavedTheme;
  isNewTheme: boolean;
  saveTheme: (theme: ArborSavedTheme) => Promise<void>;
  closed: () => void;
}

class ThemeEditorModal extends Modal {
  private readonly original: ArborSavedTheme | null;
  private readonly draft: ArborSavedTheme;
  private previewEl: HTMLElement | null = null;
  private forceClose = false;
  private confirmationOpen = false;

  constructor(app: App, private readonly controller: ThemeEditorController) {
    super(app);
    this.original = controller.isNewTheme ? null : cloneSavedTheme(controller.theme);
    this.draft = cloneSavedTheme(controller.theme);
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-theme-studio-editor-modal");
    this.render();
  }

  dismissImmediately(): void {
    this.forceClose = true;
    super.close();
  }

  override close(): void {
    if (!this.forceClose && hasUnsavedThemeDraft(this.original, this.draft)) {
      this.confirmDiscardAndClose();
      return;
    }
    super.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.controller.closed();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.original ? "Edit custom theme" : "Create custom theme" });

    this.previewEl = contentEl.createDiv({ cls: "arbor-theme-studio-editor-preview" });
    this.renderPreview();

    new Setting(contentEl)
      .setName("Theme name")
      .addText((text) =>
        text.setValue(this.draft.name).onChange((value) => {
          this.draft.name = value;
          this.renderPreview();
        })
      );
    this.addColorSetting(contentEl, "Canvas", "canvas");
    this.addColorSetting(contentEl, "Card surface", "card");
    this.addColorSetting(contentEl, "Text", "text");
    this.addColorSetting(contentEl, "Muted text", "muted");
    this.addColorSetting(contentEl, "Accent", "accent");

    const actions = contentEl.createDiv({ cls: "arbor-theme-studio-editor-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(actions)
      .setButtonText("Save changes")
      .setCta()
      .onClick(() => void this.saveChanges());
  }

  private renderPreview(): void {
    const preview = this.previewEl;
    if (!preview) {
      return;
    }
    preview.empty();
    applyPaletteVariables(preview, this.draft.palette);
    const card = preview.createDiv({ cls: "arbor-theme-studio-editor-preview-card" });
    card.createEl("strong", { text: this.draft.name.trim() || "Untitled theme" });
    const swatches = preview.createDiv({ cls: "arbor-theme-studio-editor-preview-swatches" });
    (Object.keys(this.draft.palette) as Array<keyof ArborCustomTheme>).forEach((key) => {
      const swatch = swatches.createSpan({ attr: { "aria-label": key } });
      swatch.setCssProps({ "--arbor-theme-editor-swatch": this.draft.palette[key] });
    });
  }

  private addColorSetting(container: HTMLElement, name: string, key: keyof ArborCustomTheme): void {
    new Setting(container)
      .setName(name)
      .addColorPicker((picker) =>
        picker.setValue(this.draft.palette[key]).onChange((value) => {
          this.draft.palette[key] = value;
          this.renderPreview();
        })
      );
  }

  private async saveChanges(): Promise<void> {
    if (!this.draft.name.trim()) {
      return;
    }
    this.draft.name = this.draft.name.trim();
    await this.controller.saveTheme(cloneSavedTheme(this.draft));
    this.forceClose = true;
    super.close();
  }

  private confirmDiscardAndClose(): void {
    if (this.confirmationOpen) {
      return;
    }
    this.confirmationOpen = true;
    new ThemeStudioConfirmModal(
      this.app,
      "Theme has unsaved changes",
      "Leave Theme editor without saving? Your latest edits will be discarded.",
      "Leave without saving",
      () => {
        this.forceClose = true;
        super.close();
      },
      () => {
        this.confirmationOpen = false;
      }
    ).open();
  }
}

function cloneSavedTheme(theme: ArborSavedTheme): ArborSavedTheme {
  return { ...theme, palette: { ...theme.palette } };
}

function applyPaletteVariables(element: HTMLElement, palette: ArborCustomTheme): void {
  const variables = resolveArborPaletteVariables(palette);
  element.setCssProps(Object.fromEntries(
    ARBOR_THEME_VARIABLES.map((name) => [name, variables[name] ?? ""])
  ));
}

export class ThemeStudioModal extends Modal {
  private state: ArborThemeState;
  private previewThemeId: string;
  private previewEl: HTMLElement | null = null;
  private editorModal: ThemeEditorModal | null = null;
  private confirmationOpen = false;

  constructor(app: App, private readonly controller: ThemeStudioController) {
    super(app);
    this.state = cloneThemeState(controller.initialState);
    this.previewThemeId = this.state.activeThemeId;
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-theme-studio-modal");
    this.render();
  }

  dismissImmediately(): void {
    this.editorModal?.dismissImmediately();
    super.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.controller.closed();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Theme studio" });

    this.previewEl = contentEl.createDiv({ cls: "arbor-theme-studio-preview" });
    this.renderPreview();

    const catalog = contentEl.createDiv({ cls: "arbor-theme-studio-catalog" });
    this.renderThemeSection(catalog, "Obsidian", [this.automaticTheme()]);
    this.renderThemeSection(catalog, "Built-in themes", [...BUILT_IN_THEMES]);
    this.renderCustomThemes(catalog);
    this.renderFooter(contentEl);
  }

  private renderThemeSection(
    container: HTMLElement,
    title: string,
    themes: readonly ArborSavedTheme[]
  ): void {
    const section = container.createDiv({ cls: "arbor-theme-studio-section" });
    const heading = section.createDiv({ cls: "arbor-theme-studio-section-heading" });
    heading.createEl("h3", { text: title });
    const grid = section.createDiv({ cls: "arbor-theme-studio-grid" });
    themes.forEach((theme) => this.renderThemeCard(grid, theme));
  }

  private renderCustomThemes(container: HTMLElement): void {
    const section = container.createDiv({ cls: "arbor-theme-studio-section" });
    const heading = section.createDiv({ cls: "arbor-theme-studio-section-heading" });
    heading.createEl("h3", { text: "My themes" });
    new ButtonComponent(heading).setButtonText("New theme").onClick(() => this.openThemeEditor(null));

    if (this.state.customThemes.length === 0) {
      return;
    }
    const grid = section.createDiv({ cls: "arbor-theme-studio-grid" });
    this.state.customThemes.forEach((theme) => this.renderThemeCard(grid, theme));
  }

  private renderThemeCard(container: HTMLElement, theme: ArborSavedTheme): void {
    const card = container.createEl("button", {
      cls: "arbor-theme-studio-card",
      attr: { type: "button", "aria-label": `Preview ${theme.name} theme` }
    });
    card.dataset.themeId = theme.id;
    card.toggleClass("is-selected", theme.id === this.previewThemeId);
    card.toggleClass("is-active-theme", theme.id === this.state.activeThemeId);
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
    label.createSpan({ cls: "arbor-theme-studio-card-kind", text: this.themeKind(theme.id) });
    card.addEventListener("click", () => this.selectPreview(theme.id));
    card.addEventListener("contextmenu", (event) => this.openThemeMenu(event, theme));
  }

  private selectPreview(themeId: string): void {
    this.previewThemeId = themeId;
    this.contentEl.querySelectorAll<HTMLElement>(".arbor-theme-studio-card").forEach((card) => {
      card.toggleClass("is-selected", card.dataset.themeId === themeId);
    });
    this.renderPreview();
  }

  private openThemeMenu(event: MouseEvent, theme: ArborSavedTheme): void {
    event.preventDefault();
    event.stopPropagation();

    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Apply theme").setIcon("check").onClick(() => void this.applyTheme(theme.id))
    );
    if (theme.id.startsWith("custom:")) {
      menu.addItem((item) =>
        item.setTitle("Edit theme").setIcon("pencil").onClick(() => this.openThemeEditor(theme))
      );
    }
    if (theme.id !== AUTOMATIC_THEME_ID) {
      menu.addItem((item) =>
        item
          .setTitle("Duplicate theme")
          .setIcon("copy")
          .onClick(() => this.openThemeEditor(theme, `${theme.name} copy`))
      );
    }
    if (theme.id.startsWith("custom:")) {
      menu.addItem((item) =>
        item
          .setTitle("Delete theme")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => this.confirmDelete(theme))
      );
    }
    menu.showAtMouseEvent(event);
    this.styleThemeMenu(menu, theme.palette.accent);
  }

  private styleThemeMenu(menu: Menu, accent: string): void {
    const menuWithDom = menu as Menu & { dom?: HTMLElement };
    window.requestAnimationFrame(() => {
      const menuEl = menuWithDom.dom;
      if (!menuEl) {
        return;
      }

      menuEl.setCssProps({ "--arbor-theme-studio-menu-accent": accent });
      menuEl.querySelectorAll<HTMLElement>(".menu-item-title").forEach((titleEl) => {
        const itemEl = titleEl.closest(".menu-item");
        if (titleEl.textContent?.trim() === "Apply theme") {
          itemEl?.addClass("arbor-theme-studio-menu-apply");
        }
        if (titleEl.textContent?.trim() === "Delete theme") {
          itemEl?.addClass("arbor-theme-studio-menu-danger");
        }
      });
    });
  }

  private renderPreview(): void {
    const preview = this.previewEl;
    if (!preview) {
      return;
    }
    preview.empty();
    const palette = this.previewTheme()?.palette ?? this.readObsidianPalette();
    applyPaletteVariables(preview, palette);
    const tree = preview.createDiv({ cls: "arbor-theme-studio-preview-tree" });
    const root = tree.createDiv({ cls: "arbor-theme-studio-preview-node is-root" });
    root.createEl("strong", { text: "Main idea" });
    root.createSpan({ text: "A focused starting point" });
    const links = tree.createSvg("svg", {
      cls: "arbor-theme-studio-preview-links",
      attr: { viewBox: "0 0 432 156", "aria-hidden": "true" }
    });
    links.createSvg("path", {
      cls: "arbor-theme-studio-preview-link",
      attr: { d: "M 180 78 C 216 78 216 36 252 36" }
    });
    links.createSvg("path", {
      cls: "arbor-theme-studio-preview-link",
      attr: { d: "M 180 78 C 216 78 216 120 252 120" }
    });
    const branches = tree.createDiv({ cls: "arbor-theme-studio-preview-branches" });
    const first = branches.createDiv({ cls: "arbor-theme-studio-preview-node is-selected" });
    first.createEl("strong", { text: "Selected branch" });
    first.createSpan({ text: "Accent and readable text" });
    const second = branches.createDiv({ cls: "arbor-theme-studio-preview-node" });
    second.createEl("strong", { text: "Next thought" });
    second.createSpan({ text: "Muted context stays visible" });
  }

  private renderFooter(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "arbor-theme-studio-footer" });
    new ButtonComponent(actions).setButtonText("Close").onClick(() => this.close());
    new ButtonComponent(actions)
      .setButtonText("Apply selected")
      .setCta()
      .onClick(() => void this.applyTheme(this.previewThemeId));
  }

  private openThemeEditor(source: ArborSavedTheme | null, requestedName?: string): void {
    if (this.editorModal) {
      return;
    }
    const isNewTheme = source === null || requestedName !== undefined;
    let theme: ArborSavedTheme;
    if (source && requestedName === undefined) {
      theme = cloneSavedTheme(source);
    } else {
      theme = {
        id: `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: this.uniqueName(requestedName ?? "My theme"),
        palette: { ...(source?.palette ?? DEFAULT_CUSTOM_THEME) }
      };
    }
    let modal: ThemeEditorModal;
    modal = new ThemeEditorModal(this.app, {
      theme,
      isNewTheme,
      saveTheme: async (savedTheme) => {
        this.state = cloneThemeState(await this.controller.saveTheme(savedTheme));
        this.previewThemeId = savedTheme.id;
        this.render();
      },
      closed: () => {
        if (this.editorModal === modal) {
          this.editorModal = null;
        }
      }
    });
    this.editorModal = modal;
    modal.open();
  }

  private async applyTheme(themeId: string): Promise<void> {
    this.state = cloneThemeState(await this.controller.applyTheme(themeId));
    this.previewThemeId = this.state.activeThemeId;
    this.render();
  }

  private confirmDelete(theme: ArborSavedTheme): void {
    if (this.confirmationOpen) {
      return;
    }
    this.confirmationOpen = true;
    new ThemeStudioConfirmModal(
      this.app,
      "Delete theme?",
      `Are you sure you want to delete “${theme.name}”? This cannot be undone.`,
      "Delete theme",
      async () => {
        this.state = cloneThemeState(await this.controller.deleteTheme(theme.id));
        if (this.previewThemeId === theme.id) {
          this.previewThemeId = this.state.activeThemeId;
        }
        this.render();
      },
      () => {
        this.confirmationOpen = false;
      }
    ).open();
  }

  private previewTheme(): ArborSavedTheme | null {
    if (this.previewThemeId === AUTOMATIC_THEME_ID) {
      return this.automaticTheme();
    }
    return findThemeById(this.previewThemeId, this.state.customThemes);
  }

  private automaticTheme(): ArborSavedTheme {
    return { id: AUTOMATIC_THEME_ID, name: "Automatic", palette: this.readObsidianPalette() };
  }

  private themeKind(themeId: string): string {
    return themeId === AUTOMATIC_THEME_ID ? "Obsidian" : themeId.startsWith("builtin:") ? "Built-in" : "Custom";
  }

  private uniqueName(requestedName: string): string {
    const base = requestedName.trim() || "My theme";
    const existing = new Set(this.state.customThemes.map((theme) => theme.name.toLocaleLowerCase()));
    if (!existing.has(base.toLocaleLowerCase())) {
      return base;
    }
    let index = 2;
    while (existing.has(`${base} ${index}`.toLocaleLowerCase())) {
      index += 1;
    }
    return `${base} ${index}`;
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
}
