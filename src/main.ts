import { MarkdownView, normalizePath, Notice, Platform, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { COMMANDS, METADATA_MARKER, VIEW_TYPE_ARBOR } from "./constants";
import { ARBOR_DEMO_NOTE } from "./demoNote";
import { ArborSettingTab, DEFAULT_SETTINGS } from "./settings";
import { parseBranchDocument } from "./storage/document";
import { ArborSettings } from "./types";
import { ArborView } from "./view/ArborView";

interface ArborPluginData {
  settings: ArborSettings;
  managedPaths: string[];
}

export default class ArborPlugin extends Plugin {
  settings: ArborSettings = DEFAULT_SETTINGS;
  private readonly ownWrites = new Map<string, number>();
  private readonly suppressedAutoOpen = new Map<string, number>();
  private readonly managedNotePaths = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_ARBOR, (leaf) => new ArborView(leaf, this));
    this.addSettingTab(new ArborSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }

      if (this.managedNotePaths.has(file.path)) {
        void this.refreshManagedStatus(file);
      }
      this.getBranchViews().forEach((view) => {
        void view.handleFileModified(file);
      });
    }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      void this.handleFileOpen(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      void this.handleActiveLeafChange(leaf);
    }));

    this.registerCommands();
  }

  override onunload(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_ARBOR).forEach((leaf) => {
      void leaf.detach();
    });
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    const payload = this.normalizePluginData(raw);
    this.settings = { ...DEFAULT_SETTINGS, ...payload.settings };
    this.managedNotePaths.clear();
    payload.managedPaths.forEach((path) => this.managedNotePaths.add(path));
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
  }

  getBranchViews(): ArborView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ARBOR)
      .map((leaf) => leaf.view)
      .filter((view): view is ArborView => view instanceof ArborView);
  }

  refreshAllBranchViews(): void {
    this.getBranchViews().forEach((view) => {
      void view.refreshView();
    });
  }

  markOwnWrite(path: string): void {
    this.ownWrites.set(path, (this.ownWrites.get(path) ?? 0) + 1);
  }

  consumeOwnWrite(path: string): boolean {
    const count = this.ownWrites.get(path) ?? 0;
    if (count <= 0) {
      return false;
    }

    if (count === 1) {
      this.ownWrites.delete(path);
    } else {
      this.ownWrites.set(path, count - 1);
    }
    return true;
  }

  suppressAutoOpenOnce(path: string): void {
    this.suppressedAutoOpen.set(path, (this.suppressedAutoOpen.get(path) ?? 0) + 3);
  }

  rememberManagedNote(path: string): void {
    if (this.managedNotePaths.has(path)) {
      return;
    }

    this.managedNotePaths.add(path);
    void this.savePluginData();
  }

  forgetManagedNote(path: string): void {
    if (!this.managedNotePaths.delete(path)) {
      return;
    }

    void this.savePluginData();
  }

  private consumeSuppressedAutoOpen(path: string): boolean {
    const count = this.suppressedAutoOpen.get(path) ?? 0;
    if (count <= 0) {
      return false;
    }

    if (count === 1) {
      this.suppressedAutoOpen.delete(path);
    } else {
      this.suppressedAutoOpen.set(path, count - 1);
    }
    return true;
  }

  private registerCommands(): void {
    this.addCommand({
      id: COMMANDS.openView,
      name: "Open view for current note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.openBranchViewForFile(file);
        }
        return true;
      }
    });

    this.addCommand({
      id: COMMANDS.createNote,
      name: "Create new note",
      callback: () => void this.createArborNote(true)
    });

    this.addCommand({
      id: COMMANDS.createNoteMarkdown,
      name: "Create new note in Markdown editor",
      callback: () => void this.createArborNote(false)
    });

    this.addCommand({
      id: COMMANDS.createDemo,
      name: "Create demo note",
      callback: () => void this.createDemoNote()
    });

    this.addBranchCommand(COMMANDS.openBlockMenu, "Open block actions menu", (view) => {
      view.openActiveBlockMenu();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectParent, "Select parent block", (view) => {
      view.selectParentBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectPreviousSibling, "Select previous sibling block", (view) => {
      view.selectPreviousSiblingBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectNextSibling, "Select next sibling block", (view) => {
      view.selectNextSiblingBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectFirstChild, "Select first child block", (view) => {
      view.selectFirstChildBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectFirstSibling, "Select first sibling block", (view) => {
      view.selectFirstSiblingBlock();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.selectLastSibling, "Select last sibling block", (view) => {
      view.selectLastSiblingBlock();
      return Promise.resolve();
    });

    this.addBranchCommand(COMMANDS.newRoot, "Create new root block", (view) => view.createRootBlock());
    this.addBranchCommand(COMMANDS.siblingAbove, "Create sibling above", (view) => view.createSiblingAbove());
    this.addBranchCommand(COMMANDS.siblingBelow, "Create sibling below", (view) => view.createSiblingBelow());
    this.addBranchCommand(COMMANDS.childRight, "Create child to the right", (view) => view.createChild());
    this.addBranchCommand(COMMANDS.parentLevelLeft, "Create block to the left at parent level", (view) => view.createParentLevelBlock());
    this.addBranchCommand(COMMANDS.moveUp, "Move block up among siblings", (view) => view.moveSelectedUp());
    this.addBranchCommand(COMMANDS.moveDown, "Move block down among siblings", (view) => view.moveSelectedDown());
    this.addBranchCommand(COMMANDS.moveLeft, "Move block left to parent level", (view) => view.moveSelectedLeft());
    this.addBranchCommand(COMMANDS.moveRight, "Move block right to become child of previous block", (view) => view.moveSelectedRight());
    this.addBranchCommand(COMMANDS.deleteBlock, "Delete block", (view) => view.deleteSelectedBlock());
    this.addBranchCommand(COMMANDS.deleteSubtree, "Delete subtree", (view) => view.deleteSelectedSubtree());
    this.addBranchCommand(COMMANDS.duplicateBlock, "Duplicate block", (view) => view.duplicateSelectedBlock());
    this.addBranchCommand(COMMANDS.duplicateSubtree, "Duplicate subtree", (view) => view.duplicateSelectedSubtree());
    this.addBranchCommand(COMMANDS.toggleEditMode, "Toggle edit mode", (view) => {
      view.toggleEditMode();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.revealInMarkdown, "Reveal current block in linear Markdown", (view) => view.revealCurrentBlockInMarkdown());
    this.addBranchCommand(COMMANDS.rebuildMarkdown, "Rebuild linear Markdown from tree", (view) => view.rebuildLinearMarkdownFromTree());
    this.addBranchCommand(COMMANDS.rebuildTree, "Rebuild tree from metadata", (view) => view.rebuildTreeFromMetadata());
    this.addBranchCommand(COMMANDS.undo, "Undo branch action", (view) => view.undo());
    this.addBranchCommand(COMMANDS.redo, "Redo branch action", (view) => view.redo());
  }

  private addBranchCommand(id: string, name: string, callback: (view: ArborView) => Promise<void>): void {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const available = Boolean(this.getActiveMarkdownFile() || this.getActiveBranchView()?.file);
        if (!available) {
          return false;
        }

        if (!checking) {
          void this.withBranchView(callback);
        }
        return true;
      }
    });
  }

  private async withBranchView(callback: (view: ArborView) => Promise<void>): Promise<void> {
    const view = await this.ensureBranchViewForCurrentNote();
    if (!view) {
      new Notice("Open a Markdown note first to use this view.");
      return;
    }

    await callback(view);
  }

  private getActiveBranchView(): ArborView | null {
    const activeView = this.app.workspace.getActiveViewOfType(ArborView);
    return activeView ?? null;
  }

  private getActiveMarkdownFile(): TFile | null {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return markdownView?.file ?? null;
  }

  private async ensureBranchViewForCurrentNote(): Promise<ArborView | null> {
    const activeBranchView = this.getActiveBranchView();
    if (activeBranchView?.file) {
      return activeBranchView;
    }

    const file = this.getActiveMarkdownFile();
    if (!file) {
      return null;
    }

    return this.openBranchViewForFile(file);
  }

  async openBranchViewForFile(file: TFile): Promise<ArborView | null> {
    if (Platform.isMobileApp) {
      new Notice("Arbor is desktop-first. Mobile support is intentionally limited.");
      return null;
    }

    const existingLeaf = this.findLeafForFile(file);
    const leaf = existingLeaf ?? this.app.workspace.getLeaf("split", this.settings.splitDirection);
    await leaf.setViewState({
      type: VIEW_TYPE_ARBOR,
      active: true,
      state: {
        file: file.path
      }
    });
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof ArborView ? leaf.view : null;
  }

  async createDemoNote(): Promise<TFile | null> {
    const folderPath = this.getCreationFolderPath();
    const targetPath = normalizePath(this.buildAvailableNotePath(folderPath, "Arbor demo"));
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      await this.openBranchViewForFile(existing);
      return existing;
    }

    if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }

    const file = await this.app.vault.create(targetPath, ARBOR_DEMO_NOTE);
    await this.openBranchViewForFile(file);
    return file;
  }

  async createArborNote(openInBranchView: boolean): Promise<TFile | null> {
    const folderPath = this.getCreationFolderPath();
    const filePath = this.buildAvailableNotePath(folderPath, "Arbor note");
    const file = await this.app.vault.create(filePath, "");

    if (openInBranchView) {
      await this.openBranchViewForFile(file);
    } else {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await this.app.workspace.revealLeaf(leaf);
    }

    return file;
  }

  private getCreationFolderPath(): string {
    const sourceFile = this.getActiveMarkdownFile() ?? this.getActiveBranchView()?.file ?? null;
    const folderPath = sourceFile?.parent?.path ?? "";
    return folderPath === "/" ? "" : folderPath;
  }

  private buildAvailableNotePath(folderPath: string, baseName: string): string {
    let index = 1;
    while (true) {
      const suffix = index === 1 ? "" : ` ${index}`;
      const fileName = `${baseName}${suffix}.md`;
      const candidate = folderPath ? `${folderPath}/${fileName}` : fileName;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      index += 1;
    }
  }

  private findLeafForFile(file: TFile): WorkspaceLeaf | null {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_ARBOR).find((leaf) => {
      const view = leaf.view;
      return view instanceof ArborView && view.file?.path === file.path;
    }) ?? null;
  }

  private async handleFileOpen(file: TFile | null): Promise<void> {
    if (!file || file.extension !== "md" || Platform.isMobileApp || !this.settings.autoOpenManagedNotes) {
      return;
    }

    if (this.consumeSuppressedAutoOpen(file.path)) {
      return;
    }

    if (!(await this.isManagedBranchNote(file))) {
      return;
    }

    await this.autoOpenManagedNote(file);
  }

  private async handleActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
    if (!leaf || Platform.isMobileApp || !this.settings.autoOpenManagedNotes) {
      return;
    }

    if (leaf.view instanceof ArborView) {
      return;
    }

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) {
      return;
    }

    if (this.consumeSuppressedAutoOpen(view.file.path)) {
      return;
    }

    if (!(await this.isManagedBranchNote(view.file))) {
      return;
    }

    await this.autoOpenManagedNote(view.file, leaf);
  }

  private async autoOpenManagedNote(file: TFile, preferredLeaf?: WorkspaceLeaf | null): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const leaf = this.findMarkdownLeafForFile(file, preferredLeaf);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_ARBOR,
          active: true,
          state: {
            file: file.path
          }
        });
        await this.app.workspace.revealLeaf(leaf);
        return;
      }

      await this.wait(40 * (attempt + 1));
    }
  }

  private async isManagedBranchNote(file: TFile): Promise<boolean> {
    if (this.managedNotePaths.has(file.path)) {
      return true;
    }

    const text = await this.app.vault.cachedRead(file);
    if (!this.containsMetadataMarker(text)) {
      this.forgetManagedNote(file.path);
      return false;
    }

    const managed = Boolean(parseBranchDocument(text).metadata);
    if (managed) {
      this.rememberManagedNote(file.path);
    } else {
      this.forgetManagedNote(file.path);
    }
    return managed;
  }

  private findMarkdownLeafForFile(file: TFile, preferredLeaf?: WorkspaceLeaf | null): WorkspaceLeaf | null {
    if (preferredLeaf?.view instanceof MarkdownView && preferredLeaf.view.file?.path === file.path) {
      return preferredLeaf;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file?.path === file.path) {
      return activeView.leaf;
    }

    return this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const view = leaf.view;
      return view instanceof MarkdownView && view.file?.path === file.path;
    }) ?? null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private normalizePluginData(raw: unknown): ArborPluginData {
    if (!raw || typeof raw !== "object") {
      return { settings: DEFAULT_SETTINGS, managedPaths: [] };
    }

    const candidate = raw as Partial<ArborPluginData> & Record<string, unknown>;
    if ("settings" in candidate || "managedPaths" in candidate) {
      return {
        settings: { ...DEFAULT_SETTINGS, ...((candidate.settings as Partial<ArborSettings>) ?? {}) },
        managedPaths: Array.isArray(candidate.managedPaths)
          ? candidate.managedPaths.filter((item): item is string => typeof item === "string")
          : []
      };
    }

    return {
      settings: { ...DEFAULT_SETTINGS, ...(candidate as Partial<ArborSettings>) },
      managedPaths: []
    };
  }

  private async savePluginData(): Promise<void> {
    const payload: ArborPluginData = {
      settings: this.settings,
      managedPaths: [...this.managedNotePaths].sort((left, right) => left.localeCompare(right))
    };
    await this.saveData(payload);
  }

  private async refreshManagedStatus(file: TFile): Promise<void> {
    const text = await this.app.vault.cachedRead(file);
    const managed = this.containsMetadataMarker(text) && Boolean(parseBranchDocument(text).metadata);
    if (managed) {
      this.rememberManagedNote(file.path);
    } else {
      this.forgetManagedNote(file.path);
    }
  }

  private containsMetadataMarker(text: string): boolean {
    return text.includes(METADATA_MARKER);
  }
}
