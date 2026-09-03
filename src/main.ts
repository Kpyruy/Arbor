import { MarkdownView, Menu, normalizePath, Notice, Platform, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { AutoOpenSuppression } from "./autoOpenSuppression";
import { COMMANDS, VIEW_TYPE_ARBOR, VIEW_TYPE_ARBOR_LOADING } from "./constants";
import { ARBOR_DEMO_NOTE } from "./demoNote";
import { ArborFileExplorerBadge } from "./fileExplorerBadge";
import { canExportCleanCopy, canExportTreeOverview } from "./exportCommand";
import { FILE_EXPLORER_CREATION_SECTION, shouldShowNewArborMenuItem } from "./fileExplorerMenu";
import { captureOriginalSetViewState, invokeOriginalSetViewState } from "./leafOpenInterception";
import { resolveInitialLayoutDirection } from "./layoutDirection";
import { buildAvailableMarkdownPath } from "./markdownPaths";
import { buildAvailableTreeOverviewExportPath, TreeOverviewExportFormat } from "./treeOverviewExport";
import { createEmptyTree } from "./model/tree";
import { inspectManagedBranchDocumentText, resolveLoadingViewTarget, shouldRouteMarkdownOpenToLoadingView } from "./opening";
import { ArborSettingTab, DEFAULT_SETTINGS } from "./settings";
import { buildBranchDocument } from "./storage/document";
import { normalizeMetadata } from "./storage/serializer";
import { getReleaseNote, shouldShowReleaseNotice } from "./releaseNotice";
import { ArborSettings } from "./types";
import { ArborThemeState, cloneThemeState, normalizeThemeSettings } from "./theme";
import { ThemeStudioModal } from "./themeStudio";
import { getNextNumberedName } from "./utils";
import { ArborLoadingView } from "./view/ArborLoadingView";
import { ArborView } from "./view/ArborView";

interface ArborPluginData {
  settings: ArborSettings;
  managedPaths: string[];
  lastSeenReleaseVersion?: string;
}

export default class ArborPlugin extends Plugin {
  settings: ArborSettings = DEFAULT_SETTINGS;
  private readonly ownWrites = new Map<string, number>();
  private readonly suppressedAutoOpen = new AutoOpenSuppression(1_000);
  private readonly managedNotePaths = new Set<string>();
  private readonly explicitArborOpenPaths = new Map<string, number>();
  private lastSeenReleaseVersion: string | undefined;
  private themePreviewState: ArborThemeState | null = null;
  private themeStudioModal: ThemeStudioModal | null = null;
  private isFreshPluginInstall = false;
  private originalLeafSetViewState: typeof WorkspaceLeaf.prototype.setViewState | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.pruneManagedNoteCache();

    this.registerView(VIEW_TYPE_ARBOR, (leaf) => new ArborView(leaf, this));
    this.registerView(VIEW_TYPE_ARBOR_LOADING, (leaf) => new ArborLoadingView(leaf, this));
    this.installLeafOpenInterception();
    this.addSettingTab(new ArborSettingTab(this.app, this));
    const fileExplorerBadge = new ArborFileExplorerBadge(this.app);
    this.register(() => fileExplorerBadge.unload());
    void fileExplorerBadge.refresh();

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
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.handleVaultDelete(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.handleVaultRename(file, oldPath);
    }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      void this.handleFileOpen(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      void this.handleActiveLeafChange(leaf);
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source) => {
      this.handleFileMenu(menu, file, source);
    }));
    this.registerEvent(this.app.workspace.on("files-menu", (menu, files, source) => {
      this.handleFilesMenu(menu, files, source);
    }));
    this.registerObsidianProtocolHandler("arbor", (params) => {
      const filePath = typeof params.file === "string" ? params.file : "";
      const blockId = typeof params.block === "string" ? params.block : "";
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile) || !blockId) {
        new Notice("Arbor block link is no longer available.");
        return;
      }
      void this.openBranchViewForFile(file, {
        preferredLeaf: this.app.workspace.getMostRecentLeaf(),
        splitIfNeeded: false,
        selectedBlockId: blockId
      });
    });

    this.registerCommands();
    this.app.workspace.onLayoutReady(() => void this.showReleaseNoticeIfNeeded());
  }

  override onunload(): void {
    this.themeStudioModal?.close();
    this.themeStudioModal = null;
    [VIEW_TYPE_ARBOR, VIEW_TYPE_ARBOR_LOADING].forEach((viewType) => {
      this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
        void leaf.detach();
      });
    });
  }

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    this.isFreshPluginInstall = raw === null || raw === undefined;
    const payload = this.normalizePluginData(raw);
    const themeSettings = normalizeThemeSettings(payload.settings as unknown as Record<string, unknown>);
    const settings = {
      ...DEFAULT_SETTINGS,
      ...payload.settings,
      ...themeSettings
    } as ArborSettings & Record<string, unknown>;
    delete settings.themeMode;
    delete settings.customTheme;
    this.settings = settings;
    this.settings.layoutDirection = resolveInitialLayoutDirection({
      hasStoredPluginData: !this.isFreshPluginInstall,
      savedDirection: this.getStoredLayoutDirection(raw),
      documentDirection: document.documentElement.dir || window.getComputedStyle(document.body).direction
    });
    this.lastSeenReleaseVersion = payload.lastSeenReleaseVersion;
    this.managedNotePaths.clear();
    payload.managedPaths.forEach((path) => this.managedNotePaths.add(path));
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
  }

  getEffectiveThemeState(): ArborThemeState {
    return this.themePreviewState ?? {
      activeThemeId: this.settings.activeThemeId,
      customThemes: this.settings.customThemes
    };
  }

  openThemeStudio(): void {
    if (this.themeStudioModal) {
      return;
    }
    const initialState = cloneThemeState({
      activeThemeId: this.settings.activeThemeId,
      customThemes: this.settings.customThemes
    });
    let modal: ThemeStudioModal;
    modal = new ThemeStudioModal(this.app, {
      initialState,
      preview: (state) => {
        this.themePreviewState = cloneThemeState(state);
        this.refreshAllBranchViews();
      },
      apply: async (state) => {
        this.themePreviewState = null;
        this.settings.activeThemeId = state.activeThemeId;
        this.settings.customThemes = cloneThemeState(state).customThemes;
        await this.saveSettings();
        this.refreshAllBranchViews();
      },
      cancel: () => {
        this.themePreviewState = null;
        this.refreshAllBranchViews();
      },
      closed: () => {
        if (this.themeStudioModal === modal) {
          this.themeStudioModal = null;
        }
      }
    });
    this.themeStudioModal = modal;
    modal.open();
  }

  getBranchViews(): ArborView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ARBOR)
      .map((leaf) => leaf.view)
      .filter((view): view is ArborView => view instanceof ArborView);
  }

  refreshAllBranchViews(options?: { layoutDirectionChanged?: boolean }): void {
    this.getBranchViews().forEach((view) => {
      if (options?.layoutDirectionChanged) {
        void view.refreshLayoutDirection();
        return;
      }

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
    this.suppressedAutoOpen.suppress(path);
  }

  async openFileInMarkdownView(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    const viewState = {
      type: "markdown" as const,
      active: true,
      state: { file: file.path }
    };
    this.suppressAutoOpenOnce(file.path);
    if (this.originalLeafSetViewState) {
      await invokeOriginalSetViewState(this.originalLeafSetViewState, leaf, viewState);
    } else {
      await leaf.setViewState(viewState);
    }
    await this.app.workspace.revealLeaf(leaf);
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

  expectExplicitArborOpen(path: string): void {
    this.explicitArborOpenPaths.set(path, (this.explicitArborOpenPaths.get(path) ?? 0) + 1);
  }

  consumeExplicitArborOpen(path: string): boolean {
    const count = this.explicitArborOpenPaths.get(path) ?? 0;
    if (count <= 0) {
      return false;
    }

    if (count === 1) {
      this.explicitArborOpenPaths.delete(path);
    } else {
      this.explicitArborOpenPaths.set(path, count - 1);
    }
    return true;
  }

  private isAutoOpenSuppressed(path: string): boolean {
    return this.suppressedAutoOpen.isSuppressed(path);
  }

  async resolveLoadingLeafOpen(
    file: TFile,
    leaf: WorkspaceLeaf,
    options?: {
      beforeSwap?: () => Promise<void> | void;
      eState?: unknown;
    }
  ): Promise<void> {
    if (leaf.view.getViewType() !== VIEW_TYPE_ARBOR_LOADING) {
      return;
    }

    const inspection = await this.inspectManagedBranchNote(file);
    const explicitArborOpen = this.consumeExplicitArborOpen(file.path);
    const beforeSwap = options?.beforeSwap;
    if (resolveLoadingViewTarget(inspection, explicitArborOpen) === "arbor") {
      await beforeSwap?.();
      await leaf.setViewState({
        type: VIEW_TYPE_ARBOR,
        active: true,
        state: {
          file: file.path
        }
      }, options?.eState);
      await this.app.workspace.revealLeaf(leaf);
      return;
    }

    await beforeSwap?.();
    await this.openFileInMarkdownView(leaf, file);
  }

  private installLeafOpenInterception(): void {
    const original = captureOriginalSetViewState(WorkspaceLeaf.prototype);
    this.originalLeafSetViewState = original;

    const rewriteViewStateForManagedOpen = this.rewriteViewStateForManagedOpen.bind(this);
    const patched: typeof WorkspaceLeaf.prototype.setViewState = function (this: WorkspaceLeaf, state, ...args) {
      return Reflect.apply(original, this, [rewriteViewStateForManagedOpen(state), ...args]);
    };

    WorkspaceLeaf.prototype.setViewState = patched;
    this.register(() => {
      if (WorkspaceLeaf.prototype.setViewState === patched) {
        WorkspaceLeaf.prototype.setViewState = original;
      }
    });
  }

  private rewriteViewStateForManagedOpen(state: Parameters<WorkspaceLeaf["setViewState"]>[0]): Parameters<WorkspaceLeaf["setViewState"]>[0] {
    const requestedViewType = typeof state?.type === "string" ? state.type : "";
    const filePath = typeof state?.state?.file === "string" ? state.state.file : null;
    const isSuppressed = filePath ? this.isAutoOpenSuppressed(filePath) : false;
    if (!shouldRouteMarkdownOpenToLoadingView({
      requestedViewType,
      filePath,
      autoOpenManagedNotes: this.settings.autoOpenManagedNotes,
      isMobile: Platform.isMobileApp,
      isSuppressed,
      managedPathHint: filePath ? this.managedNotePaths.has(filePath) : false
    })) {
      return state;
    }

    const file = filePath ? this.app.vault.getAbstractFileByPath(filePath) : null;
    if (!(file instanceof TFile) || file.extension !== "md") {
      if (filePath) {
        this.forgetManagedNote(filePath);
      }
      return state;
    }

    return {
      ...state,
      type: VIEW_TYPE_ARBOR_LOADING,
      state: {
        ...state.state,
        file: file.path
      }
    };
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

    this.addCommand({
      id: COMMANDS.exportCleanCopy,
      name: "Export clean copy",
      checkCallback: (checking) => {
        const view = this.getActiveBranchView();
        if (!canExportCleanCopy({ hasActiveArborView: Boolean(view), hasFile: Boolean(view?.file) })) {
          return false;
        }
        if (!checking && view) {
          void view.exportCleanCopy();
        }
        return true;
      }
    });

    this.addCommand({
      id: COMMANDS.exportTreeOverview,
      name: "Export tree overview",
      checkCallback: (checking) => {
        const view = this.getActiveBranchView();
        if (!canExportTreeOverview({ hasActiveArborView: Boolean(view), hasFile: Boolean(view?.file) })) {
          return false;
        }
        if (!checking && view) {
          void view.exportTreeOverview();
        }
        return true;
      }
    });

    this.addBranchCommand(COMMANDS.openTreeOverview, "Open tree overview", (view) => {
      view.openTreeOverview();
      return Promise.resolve();
    });
    this.addBranchCommand(COMMANDS.closeTreeOverview, "Return to branch editor", (view) => {
      view.closeTreeOverview();
      return Promise.resolve();
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

  async openBranchViewForFile(
    file: TFile,
    options?: {
      preferredLeaf?: WorkspaceLeaf | null;
      splitIfNeeded?: boolean;
      selectedBlockId?: string;
    }
  ): Promise<ArborView | null> {
    if (Platform.isMobileApp) {
      new Notice("Arbor is desktop-first. Mobile support is intentionally limited.");
      return null;
    }

    const existingLeaf = this.findManagedLeafForFile(file);
    const leaf = existingLeaf
      ?? options?.preferredLeaf
      ?? (options?.splitIfNeeded === false
        ? this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false)
        : this.app.workspace.getLeaf("split", this.settings.splitDirection));
    this.expectExplicitArborOpen(file.path);
    await leaf.setViewState({
      type: VIEW_TYPE_ARBOR,
      active: true,
      state: {
        file: file.path
      }
    });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view instanceof ArborView ? leaf.view : null;
    if (view && options?.selectedBlockId) {
      view.selectBlock(options.selectedBlockId, { focus: true });
    }
    return view;
  }

  async createDemoNote(): Promise<TFile | null> {
    const folderPath = this.getCreationFolderPath();
    const targetPath = normalizePath(
      buildAvailableMarkdownPath(
        folderPath,
        "Arbor demo",
        (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
      )
    );
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
    const filePath = this.buildAvailableUntitledNotePath(folderPath);
    const file = await this.app.vault.create(filePath, this.buildInitialArborNoteDocument());
    this.rememberManagedNote(file.path);

    if (openInBranchView) {
      await this.openBranchViewForFile(file, {
        preferredLeaf: this.app.workspace.getMostRecentLeaf(),
        splitIfNeeded: false
      });
    } else {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await this.app.workspace.revealLeaf(leaf);
    }

    return file;
  }

  async createArborNoteNear(target: TAbstractFile | null, openInBranchView = true): Promise<TFile | null> {
    const folderPath = this.resolveCreationFolderPath(target);
    const filePath = this.buildAvailableUntitledNotePath(folderPath);
    const file = await this.app.vault.create(filePath, this.buildInitialArborNoteDocument());
    this.rememberManagedNote(file.path);

    if (openInBranchView) {
      await this.openBranchViewForFile(file, {
        preferredLeaf: this.app.workspace.getMostRecentLeaf(),
        splitIfNeeded: false
      });
    } else {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await this.app.workspace.revealLeaf(leaf);
    }

    return file;
  }

  async createCleanExportCopy(source: TFile, contents: string): Promise<TFile> {
    const folderPath = source.parent?.path ?? "";
    const path = buildAvailableMarkdownPath(
      folderPath,
      `${source.basename} — export`,
      (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
    );
    return this.app.vault.create(path, contents);
  }

  async createTreeOverviewExport(
    source: TFile,
    format: TreeOverviewExportFormat,
    contents: Uint8Array
  ): Promise<TFile> {
    const folderPath = source.parent?.path ?? "";
    const path = buildAvailableTreeOverviewExportPath(
      folderPath,
      source.basename,
      format,
      (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
    );
    return this.app.vault.createBinary(path, new Uint8Array(contents).buffer);
  }

  private getCreationFolderPath(): string {
    const sourceFile = this.getActiveMarkdownFile() ?? this.getActiveBranchView()?.file ?? null;
    return this.resolveCreationFolderPath(sourceFile);
  }

  private buildInitialArborNoteDocument(): string {
    return buildBranchDocument(
      "",
      "",
      normalizeMetadata(createEmptyTree())
    );
  }

  private resolveCreationFolderPath(target: TAbstractFile | null): string {
    const folderPath = target instanceof TFolder
      ? target.path
      : target instanceof TFile
        ? target.parent?.path ?? ""
        : "";
    return folderPath === "/" ? "" : folderPath;
  }

  private buildAvailableUntitledNotePath(folderPath: string): string {
    const folder = folderPath
      ? this.app.vault.getAbstractFileByPath(folderPath)
      : this.app.vault.getRoot();
    const existingNames = folder instanceof TFolder
      ? folder.children
          .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
          .map((child) => child.basename)
      : [];
    const nextName = getNextNumberedName(existingNames, "Untitled");
    return normalizePath(folderPath ? `${folderPath}/${nextName}.md` : `${nextName}.md`);
  }

  private findManagedLeafForFile(file: TFile): WorkspaceLeaf | null {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_ARBOR).find((leaf) => {
      const view = leaf.view;
      return view instanceof ArborView && view.file?.path === file.path;
    }) ?? this.app.workspace.getLeavesOfType(VIEW_TYPE_ARBOR_LOADING).find((leaf) => {
      const view = leaf.view;
      return view instanceof ArborLoadingView && view.file?.path === file.path;
    }) ?? null;
  }

  private async handleFileOpen(file: TFile | null): Promise<void> {
    if (!file || file.extension !== "md" || Platform.isMobileApp || !this.settings.autoOpenManagedNotes) {
      return;
    }

    if (this.findManagedLeafForFile(file)) {
      return;
    }

    if (this.isAutoOpenSuppressed(file.path)) {
      return;
    }

    const releaseMask = this.managedNotePaths.has(file.path)
      ? this.maskLeafForManagedFile(file)
      : null;

    if (this.managedNotePaths.has(file.path)) {
      await this.autoOpenManagedNote(file, null, releaseMask);
      void this.refreshManagedStatus(file);
      return;
    }

    if (!(await this.isManagedBranchNote(file))) {
      releaseMask?.();
      return;
    }

    await this.autoOpenManagedNote(file, null, releaseMask);
  }

  private async handleActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
    if (!leaf || Platform.isMobileApp || !this.settings.autoOpenManagedNotes) {
      return;
    }

    if (leaf.view instanceof ArborView || leaf.view instanceof ArborLoadingView) {
      return;
    }

    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) {
      return;
    }

    if (this.isAutoOpenSuppressed(view.file.path)) {
      return;
    }

    const releaseMask = this.managedNotePaths.has(view.file.path)
      ? this.maskLeafDuringAutoOpen(leaf)
      : null;

    if (this.findManagedLeafForFile(view.file)) {
      releaseMask?.();
      return;
    }

    if (this.managedNotePaths.has(view.file.path)) {
      await this.autoOpenManagedNote(view.file, leaf, releaseMask);
      void this.refreshManagedStatus(view.file);
      return;
    }

    if (!(await this.isManagedBranchNote(view.file))) {
      releaseMask?.();
      return;
    }

    await this.autoOpenManagedNote(view.file, leaf, releaseMask);
  }

  private async autoOpenManagedNote(
    file: TFile,
    preferredLeaf?: WorkspaceLeaf | null,
    existingReleaseMask?: (() => void) | null
  ): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const managedLeaf = this.findManagedLeafForFile(file);
      if (managedLeaf) {
        existingReleaseMask?.();
        return;
      }

      const leaf = this.findMarkdownLeafForFile(file, preferredLeaf);
      if (leaf) {
        const releaseMask = existingReleaseMask ?? this.maskLeafDuringAutoOpen(leaf);
        try {
          await leaf.setViewState({
            type: VIEW_TYPE_ARBOR_LOADING,
            active: true,
            state: {
              file: file.path
            }
          });
          await this.app.workspace.revealLeaf(leaf);
        } finally {
          window.setTimeout(releaseMask, 180);
        }
        return;
      }

      await this.wait(40 * (attempt + 1));
    }

    existingReleaseMask?.();
  }

  private async isManagedBranchNote(file: TFile): Promise<boolean> {
    const inspection = await this.inspectManagedBranchNote(file);
    if (!inspection.autoManaged) {
      this.forgetManagedNote(file.path);
      return false;
    }

    this.rememberManagedNote(file.path);
    return true;
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
          : [],
        lastSeenReleaseVersion: typeof candidate.lastSeenReleaseVersion === "string"
          ? candidate.lastSeenReleaseVersion
          : undefined
      };
    }

    return {
      settings: { ...DEFAULT_SETTINGS, ...(candidate as Partial<ArborSettings>) },
      managedPaths: [],
      lastSeenReleaseVersion: undefined
    };
  }

  private getStoredLayoutDirection(raw: unknown): unknown {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }

    const candidate = raw as Record<string, unknown>;
    if (candidate.settings && typeof candidate.settings === "object") {
      return (candidate.settings as Record<string, unknown>).layoutDirection;
    }

    return candidate.layoutDirection;
  }

  private async savePluginData(): Promise<void> {
    const payload: ArborPluginData = {
      settings: this.settings,
      managedPaths: [...this.managedNotePaths].sort((left, right) => left.localeCompare(right)),
      lastSeenReleaseVersion: this.lastSeenReleaseVersion
    };
    await this.saveData(payload);
  }

  private async showReleaseNoticeIfNeeded(): Promise<void> {
    const version = this.manifest.version;
    if (this.isFreshPluginInstall) {
      this.lastSeenReleaseVersion = version;
      await this.savePluginData();
      return;
    }

    if (!shouldShowReleaseNotice(this.lastSeenReleaseVersion, version, false)) {
      return;
    }

    const releaseNote = getReleaseNote(version);
    if (!releaseNote) {
      return;
    }

    const notice = new Notice("", 12_000);
    const noticeEl = (notice as unknown as { noticeEl: HTMLElement }).noticeEl;
    noticeEl.empty();
    const content = noticeEl.createDiv({ cls: "arbor-release-notice-content" });
    const title = content.createDiv({ cls: "arbor-release-notice-title", text: `Arbor ${releaseNote.title}` });
    title.createSpan({ cls: "arbor-release-notice-badge", text: "New" });
    const changes = content.createEl("ul", { cls: "arbor-release-notice-body" });
    releaseNote.changes.forEach((change) => changes.createEl("li", { text: change }));

    if (releaseNote.action) {
      const action = content.createEl("button", {
        cls: "arbor-release-notice-action",
        text: releaseNote.action.label
      });
      action.addEventListener("click", () => {
        this.openArborSettings();
        notice.hide();
      });
    }

    this.lastSeenReleaseVersion = version;
    await this.savePluginData();
  }

  private openArborSettings(): void {
    const settingManager = (this.app as typeof this.app & { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
    settingManager?.open?.();
    settingManager?.openTabById?.(this.manifest.id);
  }

  private async refreshManagedStatus(file: TFile): Promise<void> {
    const inspection = await this.inspectManagedBranchNote(file);
    if (inspection.autoManaged) {
      this.rememberManagedNote(file.path);
    } else {
      this.forgetManagedNote(file.path);
    }
  }

  private async pruneManagedNoteCache(): Promise<void> {
    if (this.managedNotePaths.size === 0) {
      return;
    }

    let changed = false;
    for (const path of [...this.managedNotePaths]) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        this.managedNotePaths.delete(path);
        changed = true;
        continue;
      }

      const inspection = await this.inspectManagedBranchNote(file);
      if (!inspection.autoManaged) {
        this.managedNotePaths.delete(path);
        changed = true;
      }
    }

    if (changed) {
      await this.savePluginData();
    }
  }

  private handleVaultDelete(file: TAbstractFile): void {
    if (file instanceof TFile) {
      this.forgetManagedNote(file.path);
      return;
    }

    this.forgetManagedPathsUnder(file.path);
  }

  private handleVaultRename(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      if (!this.managedNotePaths.has(oldPath)) {
        return;
      }

      this.managedNotePaths.delete(oldPath);
      this.managedNotePaths.add(file.path);
      void this.savePluginData();
      return;
    }

    this.moveManagedPathsUnder(oldPath, file.path);
  }

  private handleFileMenu(menu: Menu, file: TAbstractFile, source: string): void {
    if (
      source === "link-context-menu" ||
      !(file instanceof TFolder) ||
      !shouldShowNewArborMenuItem("folder", Platform.isMobileApp)
    ) {
      return;
    }

    this.addNewArborMenuItem(menu, file);
  }

  private handleFilesMenu(menu: Menu, files: TAbstractFile[], source: string): void {
    if (source === "link-context-menu" || files.length !== 0 || !shouldShowNewArborMenuItem("empty", Platform.isMobileApp)) {
      return;
    }

    this.addNewArborMenuItem(menu, null);
  }

  private addNewArborMenuItem(menu: Menu, target: TFolder | null): void {
    menu.addItem((item) => {
      item
        .setTitle("New arbor note")
        .setIcon("git-fork")
        .setSection(FILE_EXPLORER_CREATION_SECTION)
        .onClick(() => void this.createArborNoteNear(target, true));
    });
  }

  private forgetManagedPathsUnder(folderPath: string): void {
    const prefix = `${folderPath}/`;
    let changed = false;
    for (const path of [...this.managedNotePaths]) {
      if (path === folderPath || path.startsWith(prefix)) {
        this.managedNotePaths.delete(path);
        changed = true;
      }
    }

    if (changed) {
      void this.savePluginData();
    }
  }

  private moveManagedPathsUnder(oldFolderPath: string, newFolderPath: string): void {
    const prefix = `${oldFolderPath}/`;
    let changed = false;
    for (const path of [...this.managedNotePaths]) {
      if (path === oldFolderPath || path.startsWith(prefix)) {
        this.managedNotePaths.delete(path);
        const suffix = path.slice(oldFolderPath.length);
        this.managedNotePaths.add(`${newFolderPath}${suffix}`);
        changed = true;
      }
    }

    if (changed) {
      void this.savePluginData();
    }
  }

  private maskLeafForManagedFile(file: TFile, preferredLeaf?: WorkspaceLeaf | null): (() => void) | null {
    const leaf = this.findMarkdownLeafForFile(file, preferredLeaf);
    return leaf ? this.maskLeafDuringAutoOpen(leaf) : null;
  }

  private async inspectManagedBranchNote(file: TFile): Promise<ReturnType<typeof inspectManagedBranchDocumentText>> {
    const text = await this.app.vault.cachedRead(file);
    return inspectManagedBranchDocumentText(text);
  }

  private maskLeafDuringAutoOpen(leaf: WorkspaceLeaf): () => void {
    const shell = leaf.view.containerEl.closest(".workspace-leaf");
    const target = shell instanceof HTMLElement ? shell : leaf.view.containerEl;
    target.addClass("is-arbor-auto-opening-source");
    return () => target.removeClass("is-arbor-auto-opening-source");
  }
}
