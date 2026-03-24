import {
  App,
  ButtonComponent,
  FileView,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  setIcon,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import type ArborPlugin from "../main";
import { BranchHistory } from "../history";
import {
  addChild,
  addRootBlock,
  addSibling,
  buildLinearOrder,
  buildColumnModels,
  cloneMetadata,
  createEmptyTree,
  deleteBlockAndLiftChildren,
  deleteSubtree,
  duplicateBlock,
  duplicateSubtree,
  ensureSelectedBlock,
  getActivePath,
  getBlock,
  getChildren,
  getDescendantIds,
  getFirstChildBlock,
  getPreferredChildBlock,
  getNextSibling,
  getParentBlock,
  getPreviousSibling,
  moveBlockDown,
  moveBlockLeft,
  moveBlockRight,
  moveBlockToParentAtIndex,
  moveBlockUp,
  setBlockCollapsed,
  toggleBlockCollapsed,
  updateBlockContent
} from "../model/tree";
import { DEFAULT_BLOCK_SEPARATOR, ROOT_COLUMN_LABEL, VIEW_TYPE_ARBOR } from "../constants";
import {
  BranchBlock,
  BranchBlockId,
  BranchColumnModel,
  BranchHistoryEntry,
  BranchTreeMetadata,
  LinearizedBranchDocument,
  ArborSettings
} from "../types";
import { buildBranchDocument, parseBranchDocument } from "../storage/document";
import { loadImportedBranchDocument } from "../storage/reconcile";
import { applyBodyHash, linearizeTree } from "../storage/serializer";
import { extractPathLabel, extractSnippet, hashString } from "../utils";

type EditingOrigin = "card" | "preview";

interface EditingSession {
  blockId: BranchBlockId;
  originalContent: string;
  value: string;
  autofocus: boolean;
  origin: EditingOrigin;
}

interface LoadedFileState {
  frontmatter: string;
  metadata: BranchTreeMetadata;
  selectedBlockId: BranchBlockId | null;
  staleMetadata: BranchTreeMetadata | null;
  origin: "metadata" | "imported" | "reconciled";
  linearized: LinearizedBranchDocument;
}

interface DragState {
  draggedBlockId: BranchBlockId;
  targetParentId: BranchBlockId | null;
  targetIndex: number;
  columnKey: string;
}

interface BranchOverviewNode {
  id: BranchBlockId;
  parentId: BranchBlockId | null;
  depth: number;
  label: string;
  childCount: number;
  collapsed: boolean;
  isSelected: boolean;
  isOnActivePath: boolean;
  isSelectable: boolean;
  isSearchMatch: boolean;
  isSearchRelated: boolean;
}

interface BranchViewContext {
  activePathIds: Set<BranchBlockId>;
  selectableChildIds: Set<BranchBlockId>;
  searchQuery: string;
  searchMatchedIds: Set<BranchBlockId>;
  searchRelatedIds: Set<BranchBlockId>;
  previewVisibleIds: Set<BranchBlockId> | null;
  overviewNodes: BranchOverviewNode[];
}

class ArborConfirmModal extends Modal {
  private resolved = false;
  private resolver: (value: boolean) => void = () => undefined;

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly bodyText: string,
    private readonly confirmText: string
  ) {
    super(app);
  }

  waitForChoice(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("arbor-confirm-modal");
    contentEl.empty();
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.bodyText });

    const actionsEl = contentEl.createDiv({ cls: "arbor-confirm-actions" });
    new ButtonComponent(actionsEl)
      .setButtonText("Cancel")
      .onClick(() => this.finish(false));

    new ButtonComponent(actionsEl)
      .setButtonText(this.confirmText)
      .setWarning()
      .setCta()
      .onClick(() => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolver(false);
    }
  }

  private finish(value: boolean): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    this.resolver(value);
    this.close();
  }
}

export class ArborView extends FileView {
  navigation = true;

  private readonly history = new BranchHistory();
  private state: LoadedFileState | null = null;
  private editingSession: EditingSession | null = null;
  private dragState: DragState | null = null;
  private renderFrame: number | null = null;
  private layoutFrame: number | null = null;
  private blurCommitTimer: number | null = null;
  private isPersisting = false;
  private pendingFocusBlockId: BranchBlockId | null = null;
  private pendingScrollBlockId: BranchBlockId | null = null;
  private lastViewportScroll = { left: 0, top: 0 };
  private frameEl: HTMLElement | null = null;
  private breadcrumbsEl: HTMLElement | null = null;
  private zoomIndicatorEl: HTMLButtonElement | null = null;
  private viewMenuButtonEl: HTMLButtonElement | null = null;
  private searchOverlayEl: HTMLElement | null = null;
  private searchDialogEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchMetaEl: HTMLElement | null = null;
  private searchClearEl: HTMLButtonElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private columnsStageEl: HTMLElement | null = null;
  private columnsViewportEl: HTMLElement | null = null;
  private columnsEl: HTMLElement | null = null;
  private previewPaneEl: HTMLElement | null = null;
  private previewMiniMapEl: HTMLElement | null = null;
  private previewContentEl: HTMLElement | null = null;
  private rootEmptyEl: HTMLElement | null = null;
  private renderedPreviewSignature = "";
  private previewSearchQuery = "";
  private isSearchOpen = false;
  private showFullMiniMap = false;
  private shouldFocusSearchInput = false;
  private hoveredBlockId: BranchBlockId | null = null;
  private viewContext: BranchViewContext | null = null;
  private readonly columnElementMap = new Map<string, HTMLElement>();
  private readonly currentColumnMap = new Map<string, BranchColumnModel>();
  private pendingFocusFrame: number | null = null;
  private horizontalScrollFrame: number | null = null;
  private breadcrumbScrollFrame: number | null = null;
  private zoomPersistTimer: number | null = null;
  private zoomIndicatorTimer: number | null = null;
  private dragPreviewEl: HTMLElement | null = null;
  private dragPreviewPoint: { x: number; y: number } | null = null;
  private dragPreviewOffset = { x: 0, y: 0 };
  private dragPreviewFrame: number | null = null;
  private transparentDragImageEl: HTMLCanvasElement | null = null;
  private lastCardPointerPosition: { blockId: BranchBlockId; clientX: number; clientY: number } | null = null;
  private viewportPanState:
    | {
        pointerId: number;
        startClientX: number;
        startScrollLeft: number;
        dragging: boolean;
      }
    | null = null;
  private readonly documentDragOverHandler = (event: DragEvent) => this.handleDocumentDragOver(event);

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ArborPlugin) {
    super(leaf);
    this.allowNoFile = false;
  }

  getViewType(): string {
    return VIEW_TYPE_ARBOR;
  }

  getDisplayText(): string {
    return this.file ? `Arbor: ${this.file.basename}` : "Arbor";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onLoadFile(file: TFile): Promise<void> {
    const text = await this.app.vault.cachedRead(file);
    const parsed = parseBranchDocument(text);
    const loaded = loadImportedBranchDocument(text);
    const selectedBlockId = ensureSelectedBlock(loaded.metadata, this.state?.selectedBlockId ?? null);

    this.state = {
      frontmatter: parsed.frontmatter,
      metadata: loaded.metadata,
      selectedBlockId,
      staleMetadata: loaded.staleMetadata,
      origin: loaded.origin,
      linearized: linearizeTree(loaded.metadata)
    };
    this.plugin.rememberManagedNote(file.path);

    if (loaded.origin === "reconciled") {
      new Notice("Arbor rebuilt the tree from the visible markdown body to avoid losing plain-editor changes.");
    }

    this.history.clear();
    this.editingSession = null;
    this.dragState = null;
    this.previewSearchQuery = "";
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.pendingFocusBlockId = selectedBlockId;
    this.pendingScrollBlockId = selectedBlockId;
    this.render();
  }

  async onUnloadFile(): Promise<void> {
    await this.commitEditIfNeeded();
    this.resetViewState();
  }

  clear(): void {
    this.clearBlurCommitTimer();
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
    this.clearBreadcrumbScrollFrame();
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
      this.pendingFocusFrame = null;
    }
    this.stopHorizontalScrollMotion();
    this.cleanupDragPreview();
    this.cleanupViewportPan();
    this.state = null;
    this.history.clear();
    this.editingSession = null;
    this.dragState = null;
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.teardownShell();
  }

  async onClose(): Promise<void> {
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
    this.clearBreadcrumbScrollFrame();
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
      this.pendingFocusFrame = null;
    }
    this.stopHorizontalScrollMotion();
    this.cleanupDragPreview();
    await this.commitEditIfNeeded();
    return super.onClose();
  }

  async handleFileModified(file: TFile): Promise<void> {
    if (!this.file || file.path !== this.file.path) {
      return;
    }

    if (this.plugin.consumeOwnWrite(file.path) || this.isPersisting) {
      return;
    }

    if (this.editingSession) {
      new Notice("The note changed on disk while a block was being edited. Finish or cancel the card edit before reloading.");
      return;
    }

    await this.onLoadFile(file);
  }

  async refreshView(): Promise<void> {
    if (!this.file) {
      return;
    }

    const text = await this.app.vault.cachedRead(this.file);
    const parsed = parseBranchDocument(text);
    const loaded = loadImportedBranchDocument(text);
    this.state = {
      frontmatter: parsed.frontmatter,
      metadata: loaded.metadata,
      selectedBlockId: ensureSelectedBlock(loaded.metadata, this.state?.selectedBlockId ?? null),
      staleMetadata: loaded.staleMetadata,
      origin: loaded.origin,
      linearized: linearizeTree(loaded.metadata)
    };
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    this.render();
  }

  selectBlock(blockId: BranchBlockId | null, options?: { focus?: boolean }): void {
    if (!this.state) {
      return;
    }

    const nextSelectedBlockId = ensureSelectedBlock(this.state.metadata, blockId);
    if (this.editingSession && this.editingSession.blockId !== nextSelectedBlockId) {
      const pendingSession = this.editingSession;
      void this.commitEditingSession(pendingSession).then(() => {
        if (this.state) {
          this.selectBlock(nextSelectedBlockId, options);
        }
      });
      return;
    }

    const selectionChanged = this.state.selectedBlockId !== nextSelectedBlockId;
    this.state.selectedBlockId = nextSelectedBlockId;

    if (options?.focus) {
      this.pendingFocusBlockId = this.state.selectedBlockId;
    }
    if (selectionChanged) {
      this.pendingScrollBlockId = this.state.selectedBlockId;
    }

    if (!selectionChanged && !options?.focus) {
      return;
    }

    if (!selectionChanged && options?.focus && this.state.selectedBlockId) {
      const card = this.contentEl.querySelector<HTMLElement>(`.arbor-card[data-block-id="${this.state.selectedBlockId}"]`);
      card?.focus({ preventScroll: true });
      return;
    }

    this.render();
  }

  async createRootBlock(): Promise<void> {
    await this.applyMutation("Create root block", (metadata) => addRootBlock(metadata), true);
  }

  async createSiblingAbove(): Promise<void> {
    await this.applyMutation("Create sibling above", (metadata) => addSibling(metadata, this.state?.selectedBlockId ?? null, "above"), true);
  }

  async createSiblingBelow(): Promise<void> {
    await this.applyMutation("Create sibling below", (metadata) => addSibling(metadata, this.state?.selectedBlockId ?? null, "below"), true);
  }

  async createChild(): Promise<void> {
    await this.applyMutation("Create child", (metadata) => addChild(metadata, this.state?.selectedBlockId ?? null), true);
  }

  async createParentLevelBlock(): Promise<void> {
    if (!this.state?.selectedBlockId) {
      return;
    }

    const parent = getParentBlock(this.state.metadata, this.state.selectedBlockId);
    if (!parent) {
      return;
    }

    await this.applyMutation("Create parent-level block", (metadata) => addSibling(metadata, parent.id, "below"), true);
  }

  async moveSelectedUp(): Promise<void> {
    await this.applyMutation("Move block up", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockUp(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }

  async moveSelectedDown(): Promise<void> {
    await this.applyMutation("Move block down", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockDown(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }

  async moveSelectedLeft(): Promise<void> {
    await this.applyMutation("Move block left", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockLeft(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }

  async moveSelectedRight(): Promise<void> {
    await this.applyMutation("Move block right", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return {
        metadata: selectedBlockId ? moveBlockRight(metadata, selectedBlockId) : metadata,
        selectedBlockId
      };
    });
  }

  async deleteSelectedBlock(): Promise<void> {
    await this.applyMutation("Delete block", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? deleteBlockAndLiftChildren(metadata, selectedBlockId) : { metadata, selectedBlockId };
    });
  }

  async deleteSelectedSubtree(): Promise<void> {
    if (!this.state?.selectedBlockId) {
      return;
    }

    const selectedBlock = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!selectedBlock) {
      return;
    }

    const descendantCount = getDescendantIds(this.state.metadata, selectedBlock.id).length;
    const totalBlocks = descendantCount + 1;
    const blockLabel = extractPathLabel(
      selectedBlock.content,
      {
        preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
        fallback: this.plugin.settings.breadcrumbLabelFallback
      }
    ) || "this block";

    const confirmed = await new ArborConfirmModal(
      this.app,
      "Delete subtree?",
      `Delete "${blockLabel}" and ${totalBlocks - 1} descendant ${descendantCount === 1 ? "block" : "blocks"}?`,
      "Delete subtree"
    ).waitForChoice();

    if (!confirmed) {
      return;
    }

    await this.applyMutation("Delete subtree", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? deleteSubtree(metadata, selectedBlockId) : { metadata, selectedBlockId };
    });
  }

  async duplicateSelectedBlock(): Promise<void> {
    await this.applyMutation("Duplicate block", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? duplicateBlock(metadata, selectedBlockId) : { metadata, selectedBlockId };
    }, true);
  }

  async duplicateSelectedSubtree(): Promise<void> {
    await this.applyMutation("Duplicate subtree", (metadata) => {
      const selectedBlockId = this.state?.selectedBlockId ?? null;
      return selectedBlockId ? duplicateSubtree(metadata, selectedBlockId) : { metadata, selectedBlockId };
    }, true);
  }

  toggleEditMode(): void {
    if (!this.state?.selectedBlockId) {
      return;
    }

    if (this.editingSession?.blockId === this.state.selectedBlockId) {
      void this.commitEditingSession();
      return;
    }

    const block = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!block) {
      return;
    }

    this.editingSession = {
      blockId: block.id,
      originalContent: block.content,
      value: block.content,
      autofocus: true,
      origin: "card"
    };
    this.render();
  }

  async toggleCollapsedState(blockId: BranchBlockId): Promise<void> {
    await this.applyMutation("Toggle branch collapse", (metadata) => ({
      metadata: toggleBlockCollapsed(metadata, blockId),
      selectedBlockId: blockId
    }));
  }

  async setCollapsedState(blockId: BranchBlockId, collapsed: boolean): Promise<void> {
    await this.applyMutation(collapsed ? "Collapse branch" : "Expand branch", (metadata) => ({
      metadata: setBlockCollapsed(metadata, blockId, collapsed),
      selectedBlockId: blockId
    }));
  }

  private beginEditingBlock(blockId: BranchBlockId, origin: EditingOrigin = "card"): void {
    if (!this.state) {
      return;
    }

    const nextSelectedBlockId = ensureSelectedBlock(this.state.metadata, blockId);
    if (this.editingSession && this.editingSession.blockId !== nextSelectedBlockId) {
      const pendingSession = this.editingSession;
      void this.commitEditingSession(pendingSession).then(() => {
        if (this.state && nextSelectedBlockId) {
          this.beginEditingBlock(nextSelectedBlockId);
        }
      });
      return;
    }

    const block = getBlock(this.state.metadata, nextSelectedBlockId);
    if (!block) {
      return;
    }

    if (this.state.selectedBlockId !== nextSelectedBlockId) {
      this.pendingScrollBlockId = nextSelectedBlockId;
    }

    this.stopHorizontalScrollMotion();
    this.state.selectedBlockId = nextSelectedBlockId;
    this.pendingFocusBlockId = nextSelectedBlockId;
    this.editingSession = {
      blockId: block.id,
      originalContent: block.content,
      value: block.content,
      autofocus: true,
      origin
    };
    this.render();
  }

  selectParentBlock(): void {
    if (!this.state) {
      return;
    }
    const parent = getParentBlock(this.state.metadata, this.state.selectedBlockId);
    if (parent) {
      this.selectBlock(parent.id, { focus: true });
    }
  }

  selectPreviousSiblingBlock(): void {
    if (!this.state) {
      return;
    }
    const sibling = getPreviousSibling(this.state.metadata, this.state.selectedBlockId);
    if (sibling) {
      this.selectBlock(sibling.id, { focus: true });
    }
  }

  selectNextSiblingBlock(): void {
    if (!this.state) {
      return;
    }
    const sibling = getNextSibling(this.state.metadata, this.state.selectedBlockId);
    if (sibling) {
      this.selectBlock(sibling.id, { focus: true });
    }
  }

  selectFirstChildBlock(): void {
    if (!this.state) {
      return;
    }
    const child = getFirstChildBlock(this.state.metadata, this.state.selectedBlockId);
    if (child) {
      this.selectBlock(child.id, { focus: true });
    }
  }

  selectPreferredChildBlock(): void {
    if (!this.state) {
      return;
    }
    const child = getPreferredChildBlock(this.state.metadata, this.state.selectedBlockId);
    if (child) {
      this.selectBlock(child.id, { focus: true });
    }
  }

  selectFirstSiblingBlock(): void {
    if (!this.state?.selectedBlockId) {
      return;
    }

    const current = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!current) {
      return;
    }

    const firstSibling = getChildren(this.state.metadata, current.parentId)[0];
    if (firstSibling) {
      this.selectBlock(firstSibling.id, { focus: true });
    }
  }

  selectLastSiblingBlock(): void {
    if (!this.state?.selectedBlockId) {
      return;
    }

    const current = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!current) {
      return;
    }

    const siblings = getChildren(this.state.metadata, current.parentId);
    const lastSibling = siblings[siblings.length - 1];
    if (lastSibling) {
      this.selectBlock(lastSibling.id, { focus: true });
    }
  }

  openActiveBlockMenu(): void {
    if (!this.state?.selectedBlockId) {
      return;
    }

    const activeCard = this.contentEl.querySelector<HTMLElement>(`.arbor-card.is-active`);
    const menu = this.buildBlockMenu(this.state.selectedBlockId);
    if (activeCard) {
      const rect = activeCard.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right - 12, y: rect.top + 20 }, activeCard.ownerDocument);
      return;
    }

    menu.showAtPosition({ x: 160, y: 160 }, this.contentEl.ownerDocument);
  }

  async revealCurrentBlockInMarkdown(): Promise<void> {
    if (!this.file || !this.state?.selectedBlockId) {
      return;
    }

    await this.commitEditIfNeeded();

    const location = this.state.linearized.locations.get(this.state.selectedBlockId);
    if (!location) {
      return;
    }

    const existingLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const view = leaf.view as MarkdownView;
      return view.file?.path === this.file?.path;
    }) ?? this.app.workspace.getLeaf(false);

    this.plugin.suppressAutoOpenOnce(this.file.path);
    await existingLeaf.openFile(this.file);
    const markdownView = existingLeaf.view as MarkdownView;
    if (markdownView.editor) {
      markdownView.editor.setCursor({ line: location.line, ch: 0 });
      markdownView.editor.focus();
    }
    this.app.workspace.setActiveLeaf(existingLeaf, true, true);
  }

  async rebuildLinearMarkdownFromTree(): Promise<void> {
    await this.commitEditIfNeeded();
    await this.persistState("Rebuild linear markdown from tree");
  }

  async rebuildTreeFromMetadata(): Promise<void> {
    if (!this.file || !this.state) {
      return;
    }

    await this.commitEditIfNeeded();

    const text = await this.app.vault.cachedRead(this.file);
    const parsed = parseBranchDocument(text);
    if (!parsed.metadata && !this.state.staleMetadata) {
      new Notice("No stored Arbor metadata was found in this note.");
      return;
    }

    const restored = cloneMetadata(parsed.metadata ?? this.state.staleMetadata ?? createEmptyTree());
    this.history.push("Rebuild tree from metadata", this.state.metadata, this.state.selectedBlockId);
    this.state.metadata = restored;
    this.state.selectedBlockId = ensureSelectedBlock(restored, this.state.selectedBlockId);
    this.state.linearized = linearizeTree(restored);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.editingSession = null;
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    await this.persistState("Rebuild tree from metadata");
    this.render();
  }

  async undo(): Promise<void> {
    if (!this.state || !this.history.canUndo()) {
      return;
    }

    await this.commitEditIfNeeded();

    const previous = this.history.undo(this.currentHistorySnapshot("Current state"));
    if (!previous) {
      return;
    }

    this.state.metadata = cloneMetadata(previous.metadata);
    this.state.selectedBlockId = ensureSelectedBlock(previous.metadata, previous.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.editingSession = null;
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    await this.persistState("Undo");
    this.render();
  }

  async redo(): Promise<void> {
    if (!this.state || !this.history.canRedo()) {
      return;
    }

    await this.commitEditIfNeeded();

    const next = this.history.redo(this.currentHistorySnapshot("Current state"));
    if (!next) {
      return;
    }

    this.state.metadata = cloneMetadata(next.metadata);
    this.state.selectedBlockId = ensureSelectedBlock(next.metadata, next.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.editingSession = null;
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    await this.persistState("Redo");
    this.render();
  }

  render(): void {
    if (this.renderFrame !== null) {
      window.cancelAnimationFrame(this.renderFrame);
    }

    this.renderFrame = window.requestAnimationFrame(() => {
      this.renderFrame = null;
      void this.renderNow();
    });
  }

  private async renderNow(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("arbor-view");
    this.applyCssVars(contentEl);
    this.applyViewClasses(contentEl);

    if (!this.file || !this.state) {
      this.viewContext = null;
      this.teardownShell();
      contentEl.createDiv({ cls: "arbor-empty", text: "Open a markdown note to use Arbor." });
      return;
    }

    this.ensureShell();
    this.syncViewportEdgeFades();
    this.syncBreadcrumbs();
    this.viewContext = this.buildViewContext();
    this.syncSearchOverlay(this.viewContext);
    this.syncBanner();
    const preservedSceneWidth = this.armSceneWidthForPendingScroll();

    const columns = buildColumnModels(this.state.metadata, this.state.selectedBlockId, this.plugin.settings.previewSnippetLength);
    this.currentColumnMap.clear();
    columns.forEach((column) => this.currentColumnMap.set(column.key, column));

    await this.syncColumns(columns, this.viewContext);
    await this.syncPreview(this.viewContext);
    this.applyPendingFocusAndScroll(preservedSceneWidth);
    this.syncHoverLinkedState();
  }

  private ensureShell(): void {
    if (
      this.frameEl &&
      this.columnsStageEl &&
      this.columnsViewportEl &&
      this.columnsEl &&
      this.bodyEl &&
      this.breadcrumbsEl &&
      this.bannerEl
    ) {
      return;
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("arbor-view");
    this.applyViewClasses(contentEl);

    this.frameEl = contentEl.createDiv({ cls: "arbor-frame" });
    this.breadcrumbsEl = this.frameEl.createDiv({ cls: "arbor-breadcrumbs" });
    this.zoomIndicatorEl = this.frameEl.createEl("button", {
      cls: "arbor-zoom-indicator",
      attr: {
        type: "button",
        "aria-label": "Reset Arbor zoom to 100%"
      }
    });
    this.zoomIndicatorEl.addEventListener("click", () => this.updateZoomLevel(1));
    this.zoomIndicatorEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.viewMenuButtonEl = this.frameEl.createEl("button", {
      cls: "arbor-view-menu-button",
      attr: {
        type: "button",
        "aria-label": "Open Arbor view menu"
      }
    });
    setIcon(this.viewMenuButtonEl, "sliders-horizontal");
    this.viewMenuButtonEl.addEventListener("click", (event) => this.openViewMenu(event));
    this.viewMenuButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.bannerEl = this.frameEl.createDiv({ cls: "arbor-banner" });
    this.bodyEl = this.frameEl.createDiv({ cls: "arbor-body" });
    this.columnsStageEl = this.bodyEl.createDiv({ cls: "arbor-columns-stage" });
    this.columnsViewportEl = this.columnsStageEl.createDiv({ cls: "arbor-columns-viewport" });
    this.columnsViewportEl.tabIndex = 0;
    this.columnsViewportEl.scrollLeft = this.lastViewportScroll.left;
    this.columnsViewportEl.scrollTop = this.lastViewportScroll.top;
    this.columnsViewportEl.addEventListener("scroll", () => {
      this.lastViewportScroll = {
        left: this.columnsViewportEl?.scrollLeft ?? 0,
        top: this.columnsViewportEl?.scrollTop ?? 0
      };
      this.syncViewportEdgeFades();
    }, { passive: true });
    this.columnsViewportEl.addEventListener("dragover", (event) => this.handleViewportDragOver(event));
    this.columnsViewportEl.addEventListener("wheel", (event) => this.handleViewportWheel(event, this.columnsViewportEl!), { passive: false });
    this.columnsViewportEl.addEventListener("keydown", (event) => this.handleViewportKeyDown(event));
    this.columnsViewportEl.addEventListener("pointerdown", (event) => this.handleViewportPointerDown(event, this.columnsViewportEl!));
    this.columnsViewportEl.addEventListener("pointermove", (event) => this.handleViewportPointerMove(event, this.columnsViewportEl!));
    this.columnsViewportEl.addEventListener("pointerup", (event) => this.handleViewportPointerUp(event, this.columnsViewportEl!));
    this.columnsViewportEl.addEventListener("pointercancel", (event) => this.handleViewportPointerUp(event, this.columnsViewportEl!));
    this.columnsViewportEl.addEventListener("lostpointercapture", (event) => this.handleViewportPointerCaptureLost(event, this.columnsViewportEl!));
    this.columnsEl = this.columnsViewportEl.createDiv({ cls: "arbor-columns" });
    const viewportFadesEl = this.columnsStageEl.createDiv({ cls: "arbor-viewport-fades" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-top" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-right" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-bottom" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-left" });
    this.syncZoomIndicator();
  }

  private teardownShell(): void {
    this.cleanupDragPreview();
    this.cleanupViewportPan();
    this.contentEl.empty();
    this.frameEl = null;
    this.breadcrumbsEl = null;
    this.zoomIndicatorEl = null;
    this.viewMenuButtonEl = null;
    this.searchOverlayEl = null;
    this.searchDialogEl = null;
    this.searchInputEl = null;
    this.searchMetaEl = null;
    this.searchClearEl = null;
    this.bannerEl = null;
    this.bodyEl = null;
    this.columnsStageEl = null;
    this.columnsViewportEl = null;
    this.columnsEl = null;
    this.previewPaneEl = null;
    this.previewMiniMapEl = null;
    this.previewContentEl = null;
    this.rootEmptyEl = null;
    this.renderedPreviewSignature = "";
    this.columnElementMap.clear();
    this.currentColumnMap.clear();
  }

  private syncBreadcrumbs(): void {
    if (!this.breadcrumbsEl || !this.state) {
      return;
    }

    this.breadcrumbsEl.style.display = this.plugin.settings.showBreadcrumb ? "" : "none";
    if (!this.plugin.settings.showBreadcrumb) {
      return;
    }

    this.breadcrumbsEl.empty();
    const path = getActivePath(this.state.metadata, this.state.selectedBlockId);
    if (path.length === 0) {
      this.breadcrumbsEl.createSpan({ cls: "arbor-breadcrumb-empty", text: this.file?.basename ?? "Arbor" });
      return;
    }

    this.renderBreadcrumbItems(this.breadcrumbsEl, path);
    this.syncBreadcrumbScroll();
  }

  private getBreadcrumbLabel(markdown: string): string {
    return extractPathLabel(markdown, {
      preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
      fallback: this.plugin.settings.breadcrumbLabelFallback,
      maxWords: 4,
      maxLength: 34
    });
  }

  private renderBreadcrumbItems(container: HTMLElement, path: BranchBlock[]): void {
    path.forEach((block, index) => {
      const button = container.createEl("button", {
        cls: index === path.length - 1 ? "is-active" : "",
        text: this.getBreadcrumbLabel(block.content)
      });
      button.style.setProperty("--bw-crumb-index", String(index));
      button.addEventListener("click", () => this.selectBlock(block.id, { focus: true }));

      if (this.plugin.settings.showBreadcrumbFlow && index < path.length - 1) {
        const connector = container.createSpan({ cls: "arbor-breadcrumb-connector" });
        connector.style.setProperty("--bw-crumb-index", String(index + 0.45));
      }
    });
  }

  private syncBreadcrumbScroll(): void {
    if (!this.breadcrumbsEl) {
      return;
    }

    this.clearBreadcrumbScrollFrame();
    this.breadcrumbScrollFrame = window.requestAnimationFrame(() => {
      this.breadcrumbScrollFrame = null;
      const breadcrumbsEl = this.breadcrumbsEl;
      if (!breadcrumbsEl || breadcrumbsEl.scrollWidth <= breadcrumbsEl.clientWidth + 1) {
        return;
      }

      const activeButton =
        breadcrumbsEl.querySelector<HTMLElement>("button.is-active") ??
        breadcrumbsEl.querySelector<HTMLElement>("button:last-of-type");
      if (!activeButton) {
        return;
      }

      const breadcrumbsRect = breadcrumbsEl.getBoundingClientRect();
      const activeRect = activeButton.getBoundingClientRect();
      const rightInset = (this.zoomIndicatorEl?.offsetWidth ?? 0) + (this.viewMenuButtonEl?.offsetWidth ?? 0) + 32;
      const leftInset = 28;
      const isFullyVisible =
        activeRect.left >= breadcrumbsRect.left + leftInset &&
        activeRect.right <= breadcrumbsRect.right - rightInset;
      if (isFullyVisible) {
        return;
      }

      const maxScrollLeft = Math.max(0, breadcrumbsEl.scrollWidth - breadcrumbsEl.clientWidth);
      const activeCenter =
        breadcrumbsEl.scrollLeft +
        (activeRect.left - breadcrumbsRect.left) +
        activeRect.width / 2;
      const targetLeft = Math.max(
        0,
        Math.min(
          activeCenter - (breadcrumbsEl.clientWidth - rightInset - leftInset) / 2 - leftInset,
          maxScrollLeft
        )
      );

      breadcrumbsEl.scrollTo({
        left: targetLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
  }

  private syncBanner(): void {
    if (!this.bannerEl || !this.state) {
      return;
    }

    const showBanner = this.state.origin === "reconciled";
    this.bannerEl.style.display = showBanner ? "" : "none";
    if (showBanner) {
      this.bannerEl.empty();
      this.bannerEl.createSpan({
        text: "This note changed in plain markdown mode. The branch tree was rebuilt from the visible note body."
      });
    }
  }

  private buildViewContext(): BranchViewContext {
    const metadata = this.state!.metadata;
    const selectedBlockId = this.state!.selectedBlockId;
    const activePathIds = new Set(getActivePath(metadata, selectedBlockId).map((item) => item.id));
    const selectableChildIds = new Set(
      selectedBlockId
        ? getChildren(metadata, selectedBlockId).map((item) => item.id)
        : []
    );
    const searchQuery = this.previewSearchQuery.trim().toLocaleLowerCase();
    const searchMatchedIds = new Set<BranchBlockId>();
    const searchRelatedIds = new Set<BranchBlockId>();

    if (searchQuery.length > 0) {
      for (const block of metadata.blocks) {
        const pathLabel = this.buildPreviewPathLabels(block.id).join(" ");
        const haystack = `${block.content}\n${pathLabel}`.toLocaleLowerCase();
        if (!haystack.includes(searchQuery)) {
          continue;
        }

        searchMatchedIds.add(block.id);
        getActivePath(metadata, block.id).forEach((pathBlock) => searchRelatedIds.add(pathBlock.id));
      }
    }

    const previewVisibleIds = searchQuery.length > 0
      ? new Set<BranchBlockId>([...searchMatchedIds, ...searchRelatedIds])
      : null;

    const overviewNodes: BranchOverviewNode[] = buildLinearOrder(metadata).map((block) => {
      const depth = getActivePath(metadata, block.id).length - 1;
      const childCount = getChildren(metadata, block.id).length;
      return {
        id: block.id,
        parentId: block.parentId,
        depth,
        label: extractPathLabel(block.content, {
          preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
          fallback: this.plugin.settings.breadcrumbLabelFallback,
          maxWords: 5,
          maxLength: 52
        }),
        childCount,
        collapsed: Boolean(block.collapsed),
        isSelected: selectedBlockId === block.id,
        isOnActivePath: activePathIds.has(block.id),
        isSelectable: selectableChildIds.has(block.id),
        isSearchMatch: searchMatchedIds.has(block.id),
        isSearchRelated: searchRelatedIds.has(block.id)
      };
    });

    return {
      activePathIds,
      selectableChildIds,
      searchQuery,
      searchMatchedIds,
      searchRelatedIds,
      previewVisibleIds,
      overviewNodes
    };
  }

  private syncSearchOverlay(context: BranchViewContext): void {
    if (!this.frameEl) {
      return;
    }

    if (!this.isSearchOpen) {
      this.searchOverlayEl?.remove();
      this.searchOverlayEl = null;
      this.searchDialogEl = null;
      this.searchInputEl = null;
      this.searchMetaEl = null;
      this.searchClearEl = null;
      return;
    }

    if (!this.searchOverlayEl) {
      this.searchOverlayEl = this.frameEl.createDiv({ cls: "arbor-search-overlay" });
      this.searchOverlayEl.addEventListener("mousedown", (event) => {
        if (event.target === this.searchOverlayEl) {
          this.closeSearchOverlay();
        }
      });

      this.searchDialogEl = this.searchOverlayEl.createDiv({ cls: "arbor-search-dialog" });
      this.searchInputEl = this.searchDialogEl.createEl("input", {
        cls: "arbor-search-input",
        attr: {
          type: "search",
          placeholder: "Search blocks and path"
        }
      });
      this.searchInputEl.addEventListener("input", () => {
        this.previewSearchQuery = this.searchInputEl?.value ?? "";
        this.render();
      });
      this.searchInputEl.addEventListener("keydown", (event) => {
        if (this.handleSearchShortcut(event)) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeSearchOverlay();
          return;
        }

        if (event.key === "Enter" && this.viewContext) {
          const firstMatch = this.viewContext.overviewNodes.find((node) => node.isSearchMatch);
          if (firstMatch) {
            event.preventDefault();
            this.selectBlock(firstMatch.id, { focus: true });
          }
        }
      });

      const footerEl = this.searchDialogEl.createDiv({ cls: "arbor-search-footer" });
      this.searchMetaEl = footerEl.createDiv({ cls: "arbor-search-meta", text: "Search blocks and path" });
      this.searchClearEl = footerEl.createEl("button", {
        cls: "arbor-search-clear",
        text: "Clear",
        attr: {
          type: "button",
          "aria-label": "Clear Arbor search"
        }
      });
      this.searchClearEl.addEventListener("click", () => {
        this.previewSearchQuery = "";
        this.render();
        this.searchInputEl?.focus();
      });
    }

    if (this.searchInputEl && this.searchInputEl.value !== this.previewSearchQuery) {
      this.searchInputEl.value = this.previewSearchQuery;
    }

    if (this.searchMetaEl && this.searchClearEl) {
      const matchCount = context.searchMatchedIds.size;
      this.searchMetaEl.setText(
        context.searchQuery.length > 0
          ? `${matchCount} match${matchCount === 1 ? "" : "es"}`
          : "Search blocks and path"
      );
      this.searchClearEl.toggleClass("is-visible", context.searchQuery.length > 0);
      this.searchClearEl.toggleAttribute("disabled", context.searchQuery.length === 0);
    }

    if (this.shouldFocusSearchInput) {
      this.shouldFocusSearchInput = false;
      window.requestAnimationFrame(() => {
        this.searchInputEl?.focus();
        this.searchInputEl?.select();
      });
    }
  }

  private async syncColumns(columns: BranchColumnModel[], context: BranchViewContext): Promise<void> {
    if (!this.columnsEl) {
      return;
    }

    if (columns.length === 1 && columns[0].blocks.length === 0) {
      this.columnElementMap.forEach((columnEl) => columnEl.remove());
      this.columnElementMap.clear();
      this.columnsEl.empty();
      this.rootEmptyEl = this.columnsEl.createDiv({ cls: "arbor-root-empty" });
      this.rootEmptyEl.createEl("p", { text: "This note has no branch blocks yet." });
      const button = this.rootEmptyEl.createEl("button", { text: "Create root block" });
      button.addEventListener("click", () => void this.createRootBlock());
      return;
    }

    this.rootEmptyEl?.remove();
    this.rootEmptyEl = null;

    const desiredKeys = new Set(columns.map((column) => column.key));
    for (const [key, columnEl] of this.columnElementMap) {
      if (!desiredKeys.has(key)) {
        columnEl.remove();
        this.columnElementMap.delete(key);
      }
    }

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const columnEl = this.ensureColumnElement(column.key);
      columnEl.dataset.columnKey = column.key;
      columnEl.dataset.parentId = column.parentId ?? "";

      const siblingAtIndex = this.columnsEl.children[index] ?? null;
      if (siblingAtIndex !== columnEl) {
        this.columnsEl.insertBefore(columnEl, siblingAtIndex);
      }

      await this.syncColumn(columnEl, column, context);
    }
  }

  private ensureColumnElement(columnKey: string): HTMLElement {
    const existing = this.columnElementMap.get(columnKey);
    if (existing) {
      return existing;
    }

    const columnEl = this.columnsEl!.createDiv({ cls: "arbor-column" });
    columnEl.dataset.columnKey = columnKey;
    const cardsEl = columnEl.createDiv({ cls: "arbor-card-list" });
    cardsEl.addEventListener("dragover", (event) => this.handleColumnDragOver(event));
    cardsEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const column = this.currentColumnMap.get(cardsEl.dataset.columnKey ?? "");
      if (column) {
        void this.applyDrop(column);
      }
    });
    this.columnElementMap.set(columnKey, columnEl);
    return columnEl;
  }

  private async syncColumn(columnEl: HTMLElement, column: BranchColumnModel, context: BranchViewContext): Promise<void> {
    const cardsEl = columnEl.querySelector<HTMLElement>(".arbor-card-list") ?? columnEl.createDiv({ cls: "arbor-card-list" });
    cardsEl.dataset.columnKey = column.key;
    const nextParentId = column.parentId ?? "";
    const parentChanged = (cardsEl.dataset.parentId ?? "") !== nextParentId;
    cardsEl.dataset.parentId = nextParentId;

    if (parentChanged) {
      cardsEl.addClass("is-rebinding");
      cardsEl.style.transform = "";
    }

    if (column.collapsedBlockId) {
      cardsEl.empty();
      const summary = cardsEl.createDiv({ cls: "arbor-column-summary" });
      summary.dataset.nodeKey = `collapsed-${column.key}`;
      summary.createDiv({
        cls: "arbor-column-summary-title",
        text: `${column.collapsedCount ?? 0} hidden block${(column.collapsedCount ?? 0) === 1 ? "" : "s"}`
      });
      if ((column.collapsedPreviewLabels?.length ?? 0) > 0) {
        const labelsEl = summary.createDiv({ cls: "arbor-column-summary-labels" });
        column.collapsedPreviewLabels?.forEach((label) => {
          labelsEl.createSpan({ cls: "arbor-column-summary-chip", text: label });
        });
      }
      const expandButton = summary.createEl("button", {
        cls: "arbor-column-summary-action",
        text: "Expand branch",
        attr: { type: "button" }
      });
      expandButton.addEventListener("click", () => void this.setCollapsedState(column.collapsedBlockId!, false));
      return;
    }

    if (column.blocks.length === 0) {
      cardsEl.empty();
      const empty = cardsEl.createDiv({ cls: "arbor-column-empty" });
      empty.dataset.nodeKey = `empty-${column.key}`;
      empty.setText(column.parentId ? "No child blocks yet." : "No root blocks yet.");
      empty.toggleClass("is-selectable-context", column.parentId === this.state?.selectedBlockId);
      if (column.parentId) {
        empty.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.selectBlock(column.parentId);
          const menu = new Menu();
          menu.addItem((item) =>
            item.setTitle("Create child block").setIcon("arrow-right").onClick(() => void this.createChild())
          );
          menu.showAtMouseEvent(event);
        });
      }
      return;
    }

    const existingChildren = new Map<string, HTMLElement>();
    Array.from(cardsEl.children).forEach((child) => {
      if (child instanceof HTMLElement && child.dataset.nodeKey) {
        existingChildren.set(child.dataset.nodeKey, child);
      }
    });

    const desiredNodes: HTMLElement[] = [];
    for (let index = 0; index < column.blocks.length; index += 1) {
      if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === index) {
        desiredNodes.push(this.ensureIndicatorNode(existingChildren, `indicator-${column.key}-${index}`));
      }

      const block = column.blocks[index];
      const card = this.ensureCardNode(existingChildren, block.id);
      await this.syncCardNode(card, block, column, index, context);
      desiredNodes.push(card);
    }

    if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === column.blocks.length) {
      desiredNodes.push(this.ensureIndicatorNode(existingChildren, `indicator-${column.key}-${column.blocks.length}`));
    }

    desiredNodes.forEach((node, index) => {
      const siblingAtIndex = cardsEl.children[index] ?? null;
      if (siblingAtIndex !== node) {
        cardsEl.insertBefore(node, siblingAtIndex);
      }
    });

    const desiredNodeKeys = new Set(desiredNodes.map((node) => node.dataset.nodeKey!));
    existingChildren.forEach((node, key) => {
      if (!desiredNodeKeys.has(key)) {
        node.remove();
      }
    });
  }

  private ensureIndicatorNode(existingChildren: Map<string, HTMLElement>, key: string): HTMLElement {
    const existing = existingChildren.get(key);
    if (existing) {
      existing.className = "arbor-drop-indicator";
      existing.dataset.nodeKey = key;
      return existing;
    }

    const indicator = createDiv({ cls: "arbor-drop-indicator" });
    indicator.dataset.nodeKey = key;
    return indicator;
  }

  private ensureCardNode(existingChildren: Map<string, HTMLElement>, blockId: BranchBlockId): HTMLElement {
    const key = `card-${blockId}`;
    const existing = existingChildren.get(key);
    if (existing) {
      existing.dataset.nodeKey = key;
      return existing;
    }

    const card = createDiv({ cls: "arbor-card" });
    card.tabIndex = 0;
    card.dataset.nodeKey = key;
    card.addEventListener("pointerdown", (event) => this.rememberCardPointerPosition(blockId, event.clientX, event.clientY));
    card.addEventListener("mousedown", (event) => this.rememberCardPointerPosition(blockId, event.clientX, event.clientY));
    card.addEventListener("click", (event) => this.handleCardClick(event));
    card.addEventListener("dblclick", (event) => this.handleCardDoubleClick(event));
    card.addEventListener("contextmenu", (event) => this.handleCardContextMenu(event));
    card.addEventListener("keydown", (event) => this.handleCardKeyDown(event));
    card.addEventListener("mouseenter", () => this.setHoveredBlock(blockId));
    card.addEventListener("mouseleave", () => this.setHoveredBlock(null));
    card.addEventListener("dragstart", (event) => this.handleCardDragStart(event));
    card.addEventListener("dragend", () => this.handleCardDragEnd());
    card.addEventListener("dragover", (event) => this.handleCardDragOver(event));
    card.addEventListener("drop", (event) => this.handleCardDrop(event));
    return card;
  }

  private async syncCardNode(
    card: HTMLElement,
    block: BranchBlock,
    column: BranchColumnModel,
    index: number,
    context: BranchViewContext
  ): Promise<void> {
    card.dataset.blockId = block.id;
    card.dataset.columnKey = column.key;
    card.dataset.blockIndex = String(index);
    card.dataset.parentId = block.parentId ?? "";
    card.draggable = this.plugin.settings.dragAndDrop;
    card.removeClass(
      "is-active",
      "is-on-path",
      "is-selectable",
      "is-muted",
      "is-drag-source",
      "is-editing",
      "is-search-match",
      "is-search-related",
      "is-search-muted"
    );

    if (this.state?.selectedBlockId === block.id) {
      card.addClass("is-active");
    } else if (context.activePathIds.has(block.id)) {
      card.addClass("is-on-path");
    } else if (context.selectableChildIds.has(block.id)) {
      card.addClass("is-selectable");
    } else if (context.activePathIds.size > 0) {
      card.addClass("is-muted");
    }

    if (this.dragState?.draggedBlockId === block.id) {
      card.addClass("is-drag-source");
    }

    if (context.searchQuery.length > 0) {
      if (context.searchMatchedIds.has(block.id)) {
        card.addClass("is-search-match");
      } else if (context.searchRelatedIds.has(block.id)) {
        card.addClass("is-search-related");
      } else {
        card.addClass("is-search-muted");
      }
    }

    if (this.editingSession?.blockId === block.id && this.editingSession.origin === "card") {
      card.addClass("is-editing");
      await this.syncEditorNode(card, block);
      return;
    }

    await this.syncCardContentNode(card, block);
  }

  private wireEditorElement(editor: HTMLTextAreaElement, block: BranchBlock, origin: EditingOrigin): void {
    if (editor.dataset.arborBound === "true") {
      editor.dataset.editorOrigin = origin;
      return;
    }

    editor.dataset.arborBound = "true";
    editor.dataset.editorOrigin = origin;
    ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach((eventName) => {
      editor.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    });
    editor.addEventListener("input", () => {
      if (this.editingSession?.blockId === block.id) {
        this.clearBlurCommitTimer();
        this.editingSession.value = editor.value;
        this.resizeEditor(editor);
        this.scheduleColumnAlignment();
      }
    });
    editor.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (this.handleSearchShortcut(event)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelEditingSession();
      } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.commitEditingSession();
      }
    });
    editor.addEventListener("paste", (event) => {
      event.stopPropagation();
      void this.handleEditorPaste(event, editor);
    });
    editor.addEventListener("drop", (event) => {
      event.stopPropagation();
      void this.handleEditorDrop(event, editor);
    });
    editor.addEventListener("dragover", (event) => {
      event.stopPropagation();
      if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith("image/"))) {
        event.preventDefault();
      }
    });
    editor.addEventListener("focus", (event) => {
      event.stopPropagation();
      this.clearBlurCommitTimer();
    });
    editor.addEventListener("blur", (event) => {
      event.stopPropagation();
      const session = this.editingSession;
      if (!session || session.blockId !== block.id || session.origin !== editor.dataset.editorOrigin) {
        return;
      }
      this.scheduleEditingSessionCommit(session);
    });
  }

  private async syncEditorNode(card: HTMLElement, block: BranchBlock): Promise<void> {
    let editor = card.querySelector<HTMLTextAreaElement>("textarea.arbor-editor");
    if (!editor) {
      card.empty();
      editor = card.createEl("textarea", { cls: "arbor-editor" });
    }

    this.wireEditorElement(editor, block, "card");

    if (editor.value !== this.editingSession!.value) {
      editor.value = this.editingSession!.value;
    }
    this.resizeEditor(editor);
    card.dataset.renderMode = "editing";

    if (this.editingSession?.autofocus && this.editingSession.origin === "card") {
      window.setTimeout(() => {
        editor!.focus();
        editor!.setSelectionRange(editor!.value.length, editor!.value.length);
        this.resizeEditor(editor!);
        if (this.editingSession) {
          this.editingSession.autofocus = false;
        }
      }, 0);
    }
  }

  private async syncCardContentNode(card: HTMLElement, block: BranchBlock): Promise<void> {
    const renderSignature = hashString(block.content);
    let content = card.querySelector<HTMLElement>(".arbor-card-content");
    const needsRender = !content || card.dataset.renderSignature !== renderSignature || card.dataset.renderMode === "editing";

    if (needsRender) {
      card.empty();
      content = card.createDiv({ cls: "arbor-card-content markdown-rendered" });
      await MarkdownRenderer.render(this.app, block.content, content, this.file?.path ?? "", this);
      if (content.innerText.trim().length === 0) {
        content.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
      }
      content.querySelectorAll("img").forEach((image) => {
        image.addEventListener("load", () => this.scheduleColumnAlignment(), { once: true });
      });
      card.dataset.renderSignature = renderSignature;
    }

    card.dataset.renderMode = "content";
  }

  private async syncPreview(context: BranchViewContext): Promise<void> {
    if (!this.bodyEl || !this.file || !this.state) {
      return;
    }

    const shouldShow = this.plugin.settings.liveLinearPreview;
    if (!shouldShow) {
      this.previewPaneEl?.remove();
      this.previewPaneEl = null;
      this.previewMiniMapEl = null;
      this.previewContentEl = null;
      this.renderedPreviewSignature = "";
      return;
    }

    if (!this.previewPaneEl) {
      this.previewPaneEl = this.bodyEl.createDiv({ cls: "arbor-preview-pane" });
      this.previewPaneEl.createEl("div", { cls: "arbor-preview-title", text: "Selected Block" });
      this.previewMiniMapEl = this.previewPaneEl.createDiv({ cls: "arbor-preview-minimap" });
      this.previewContentEl = this.previewPaneEl.createDiv({ cls: "arbor-preview-content markdown-rendered" });
    }

    if (this.previewMiniMapEl) {
      this.syncPreviewMiniMap(this.previewMiniMapEl, context);
    }

    const collapseSignature = this.state.metadata.blocks
      .map((block) => `${block.id}:${block.collapsed ? 1 : 0}`)
      .join("|");

    const previewSignature = [
      this.state.linearized.body,
      this.state.selectedBlockId ?? "",
      this.editingSession?.blockId ?? "",
      this.editingSession?.origin ?? "",
      context.searchQuery,
      collapseSignature
    ].join("\u001f");

    if (this.previewContentEl && this.renderedPreviewSignature !== previewSignature) {
      this.previewContentEl.empty();
      await this.renderPreviewBlocks(this.previewContentEl, context);
      this.previewContentEl.scrollTop = 0;
      this.renderedPreviewSignature = previewSignature;
    }
  }

  private async renderPreviewBlocks(container: HTMLElement, context: BranchViewContext): Promise<void> {
    if (!this.state || !this.file) {
      return;
    }

    const previewItems = this.buildPreviewItems(context);
    const linearOrder = buildLinearOrder(this.state.metadata);
    const linearIndexById = new Map(linearOrder.map((block, index) => [block.id, index]));
    if (previewItems.length === 0) {
      container.createDiv({
        cls: "arbor-preview-empty",
        text: context.searchQuery.length > 0 ? "No blocks match the current search." : "No preview blocks available."
      });
      return;
    }

    for (const [index, item] of previewItems.entries()) {
      if (item.type === "summary") {
        const summaryEl = container.createDiv({ cls: "arbor-preview-summary" });
        summaryEl.style.setProperty("--bw-preview-depth", String(item.depth));
        summaryEl.createDiv({
          cls: "arbor-preview-summary-title",
          text: `${item.count} hidden block${item.count === 1 ? "" : "s"}`
        });
        if (item.labels.length > 0) {
          const labelsEl = summaryEl.createDiv({ cls: "arbor-preview-summary-labels" });
          item.labels.forEach((label) => labelsEl.createSpan({ cls: "arbor-preview-chip", text: label }));
        }
        const actionButton = summaryEl.createEl("button", {
          cls: "arbor-preview-action is-primary",
          text: "Expand branch",
          attr: { type: "button" }
        });
        actionButton.addEventListener("click", () => void this.setCollapsedState(item.ownerId, false));
        continue;
      }

      const { block, depth } = item;
      const previewBlockEl = container.createDiv({ cls: "arbor-preview-block" });
      previewBlockEl.dataset.blockId = block.id;
      previewBlockEl.style.setProperty("--bw-preview-depth", String(depth));
      previewBlockEl.toggleClass("is-active", this.state.selectedBlockId === block.id);
      previewBlockEl.toggleClass("is-on-path", context.activePathIds.has(block.id));
      previewBlockEl.toggleClass("is-direct-child", block.parentId === this.state.selectedBlockId);
      previewBlockEl.toggleClass("is-editing", this.editingSession?.blockId === block.id && this.editingSession.origin === "preview");
      previewBlockEl.toggleClass("is-search-match", context.searchMatchedIds.has(block.id));
      previewBlockEl.toggleClass("is-search-related", context.searchQuery.length > 0 && context.searchRelatedIds.has(block.id));
      previewBlockEl.addEventListener("mouseenter", () => this.setHoveredBlock(block.id));
      previewBlockEl.addEventListener("mouseleave", () => this.setHoveredBlock(null));
      previewBlockEl.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest("button")) {
          return;
        }
        this.selectBlock(block.id, { focus: true });
      });
      previewBlockEl.addEventListener("dblclick", () => {
        this.beginEditingBlock(block.id, "preview");
      });

      const headerEl = previewBlockEl.createDiv({ cls: "arbor-preview-block-header" });
      const linearIndex = (linearIndexById.get(block.id) ?? 0) + 1;
      headerEl.createEl("div", {
        cls: "arbor-preview-index",
        text: `Block ${String(linearIndex).padStart(2, "0")}`
      });
      const pathLabels = this.buildPreviewPathLabels(block.id);

      const actionsEl = headerEl.createDiv({ cls: "arbor-preview-actions" });
      const selectButton = actionsEl.createEl("button", {
        cls: "arbor-preview-action",
        text: "Select",
        attr: { type: "button" }
      });
      selectButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.selectBlock(block.id, { focus: true });
      });

      const editButton = actionsEl.createEl("button", {
        cls: "arbor-preview-action is-primary",
        text: this.editingSession?.blockId === block.id ? "Editing" : "Edit",
        attr: {
          type: "button",
          "aria-label": `Edit ${pathLabels[pathLabels.length - 1] ?? "block"}`
        }
      });
      editButton.toggleAttribute("disabled", this.editingSession?.blockId === block.id);
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.beginEditingBlock(block.id, "preview");
      });

      const childCount = getChildren(this.state.metadata, block.id).length;
      if (childCount > 0) {
        const collapseButton = actionsEl.createEl("button", {
          cls: "arbor-preview-action",
          text: block.collapsed ? "Expand" : "Collapse",
          attr: { type: "button" }
        });
        collapseButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.toggleCollapsedState(block.id);
        });
      }

      if (this.editingSession?.blockId === block.id && this.editingSession.origin === "preview") {
        const editor = previewBlockEl.createEl("textarea", { cls: "arbor-editor arbor-preview-editor" });
        this.wireEditorElement(editor, block, "preview");
        if (editor.value !== this.editingSession.value) {
          editor.value = this.editingSession.value;
        }
        this.resizeEditor(editor);
        if (this.editingSession.autofocus) {
          window.setTimeout(() => {
            editor.focus();
            editor.setSelectionRange(editor.value.length, editor.value.length);
            this.resizeEditor(editor);
            if (this.editingSession) {
              this.editingSession.autofocus = false;
            }
          }, 0);
        }
      } else {
        const bodyEl = previewBlockEl.createDiv({ cls: "arbor-preview-block-body markdown-rendered" });
        await MarkdownRenderer.render(this.app, block.content, bodyEl, this.file.path, this);
        if (bodyEl.innerText.trim().length === 0) {
          bodyEl.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
        }
      }

      const boundaryText = childCount > 0
        ? "Children continue in branches"
        : "Selected block preview";
      previewBlockEl.createDiv({
        cls: "arbor-preview-boundary",
        text: boundaryText
      });
    }
  }

  private buildPreviewItems(context: BranchViewContext): Array<
    | { type: "block"; block: BranchBlock; depth: number }
    | { type: "summary"; ownerId: BranchBlockId; depth: number; count: number; labels: string[] }
  > {
    if (!this.state?.selectedBlockId) {
      return [];
    }

    const selectedBlock = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!selectedBlock) {
      return [];
    }

    if (context.searchQuery.length > 0 && !context.searchMatchedIds.has(selectedBlock.id) && !context.searchRelatedIds.has(selectedBlock.id)) {
      return [];
    }

    const depth = getActivePath(this.state.metadata, selectedBlock.id).length - 1;
    return [{ type: "block", block: selectedBlock, depth }];
  }

  private syncPreviewMiniMap(container: HTMLElement, context: BranchViewContext): void {
    if (!this.state) {
      return;
    }

    container.empty();
    const headerEl = container.createDiv({ cls: "arbor-preview-minimap-header" });
    headerEl.createSpan({ text: "Path" });
    const metaEl = headerEl.createSpan({
      cls: "arbor-preview-minimap-meta",
      text: ""
    });
    const toggleButton = headerEl.createEl("button", {
      cls: "arbor-preview-minimap-toggle",
      text: this.showFullMiniMap ? "Visible only" : "Show all",
      attr: { type: "button" }
    });
    toggleButton.addEventListener("click", () => {
      this.showFullMiniMap = !this.showFullMiniMap;
      this.render();
    });

    const pathEl = container.createDiv({ cls: "arbor-preview-minimap-path" });
    this.buildPreviewPathLabels(this.state.selectedBlockId ?? "").forEach((label, index, labels) => {
      pathEl.createSpan({
        cls: `arbor-preview-chip${index === labels.length - 1 ? " is-current" : ""}`,
        text: label
      });
      if (index < labels.length - 1) {
        pathEl.createSpan({ cls: "arbor-preview-chip-separator", text: "→" });
      }
    });

    const listEl = container.createDiv({ cls: "arbor-preview-minimap-list" });
    const visibleNodeIds = new Set<BranchBlockId>([...context.activePathIds]);
    this.currentColumnMap.forEach((column) => {
      column.blocks.forEach((block) => visibleNodeIds.add(block.id));
    });
    const minimapNodes = context.searchQuery.length > 0
      ? context.overviewNodes.filter((node) => node.isSearchMatch || node.isSearchRelated || visibleNodeIds.has(node.id))
      : this.showFullMiniMap
        ? context.overviewNodes
        : context.overviewNodes.filter((node) => visibleNodeIds.has(node.id));

    metaEl.setText(`${minimapNodes.length} / ${context.overviewNodes.length} blocks`);

    minimapNodes.forEach((node) => {
      const rowEl = listEl.createEl("button", {
        cls: "arbor-preview-minimap-node",
        text: node.label,
        attr: { type: "button" }
      });
      rowEl.dataset.blockId = node.id;
      rowEl.style.setProperty("--bw-preview-depth", String(node.depth));
      rowEl.toggleClass("is-active", node.isSelected);
      rowEl.toggleClass("is-on-path", node.isOnActivePath);
      rowEl.toggleClass("is-selectable", node.isSelectable);
      rowEl.toggleClass("is-search-match", node.isSearchMatch);
      rowEl.toggleClass("is-search-related", node.isSearchRelated);
      rowEl.toggleClass("is-collapsed", node.collapsed);
      rowEl.addEventListener("click", () => this.selectBlock(node.id, { focus: true }));
      rowEl.addEventListener("mouseenter", () => this.setHoveredBlock(node.id));
      rowEl.addEventListener("mouseleave", () => this.setHoveredBlock(null));
      if (node.childCount > 0) {
        const countEl = rowEl.createSpan({ cls: "arbor-preview-minimap-count" });
        countEl.setText(`${node.childCount}`);
      }
    });
  }

  private buildPreviewPathLabels(blockId: BranchBlockId): string[] {
    if (!this.state) {
      return [];
    }

    return getActivePath(this.state.metadata, blockId).map((block) =>
      extractPathLabel(block.content, {
        preferredPrefix: this.plugin.settings.breadcrumbLabelPreferredPrefix,
        fallback: this.plugin.settings.breadcrumbLabelFallback,
        maxWords: 4,
        maxLength: 36
      })
    );
  }

  private setHoveredBlock(blockId: BranchBlockId | null): void {
    if (this.hoveredBlockId === blockId) {
      return;
    }

    this.hoveredBlockId = blockId;
    this.syncHoverLinkedState();
  }

  private openSearchOverlay(): void {
    if (this.isSearchOpen) {
      this.searchInputEl?.focus();
      this.searchInputEl?.select();
      return;
    }

    this.isSearchOpen = true;
    this.shouldFocusSearchInput = true;
    this.render();
  }

  private closeSearchOverlay(): void {
    this.isSearchOpen = false;
    this.shouldFocusSearchInput = false;
    this.previewSearchQuery = "";
    this.render();
  }

  private handleSearchShortcut(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
      return false;
    }

    if (event.code !== "KeyF") {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    this.openSearchOverlay();
    return true;
  }

  private handleHistoryShortcut(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.code !== "KeyZ") {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      void this.redo();
    } else {
      void this.undo();
    }

    return true;
  }

  private openViewMenu(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();

    const menu = new Menu();
    this.addViewToggleMenuItem(menu, "Selected block panel", this.plugin.settings.liveLinearPreview, async () => {
      await this.updateViewSetting("liveLinearPreview", !this.plugin.settings.liveLinearPreview);
    });
    this.addViewToggleMenuItem(menu, "Breadcrumb path", this.plugin.settings.showBreadcrumb, async () => {
      await this.updateViewSetting("showBreadcrumb", !this.plugin.settings.showBreadcrumb);
    });
    this.addViewToggleMenuItem(menu, "Breadcrumb flow", this.plugin.settings.showBreadcrumbFlow, async () => {
      await this.updateViewSetting("showBreadcrumbFlow", !this.plugin.settings.showBreadcrumbFlow);
    });
    this.addViewToggleMenuItem(menu, "Ctrl/Cmd + wheel zoom", this.plugin.settings.enableCtrlWheelZoom, async () => {
      await this.updateViewSetting("enableCtrlWheelZoom", !this.plugin.settings.enableCtrlWheelZoom, false);
    });
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Reset zoom to 100%").setIcon("maximize").onClick(() => this.updateZoomLevel(1))
    );
    menu.addItem((item) =>
      item.setTitle("Open Arbor settings").setIcon("settings-2").onClick(() => this.openArborSettings())
    );

    const anchor = this.viewMenuButtonEl;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right - 8, y: rect.bottom + 6 }, anchor.ownerDocument);
      return;
    }

    menu.showAtPosition({ x: 220, y: 120 }, this.contentEl.ownerDocument);
  }

  private addViewToggleMenuItem(menu: Menu, title: string, enabled: boolean, callback: () => void | Promise<void>): void {
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(enabled ? "check" : "circle")
        .onClick(() => void callback())
    );
  }

  private async updateViewSetting<Key extends keyof ArborSettings>(
    key: Key,
    value: ArborSettings[Key],
    refreshAll = true
  ): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    if (refreshAll) {
      this.plugin.refreshAllBranchViews();
      return;
    }

    this.render();
  }

  private openArborSettings(): void {
    const settingManager = (this.app as App & { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
    if (!settingManager?.open) {
      new Notice("Obsidian settings are not available right now.");
      return;
    }

    settingManager.open();
    settingManager.openTabById?.(this.plugin.manifest.id);
  }

  private syncHoverLinkedState(): void {
    if (!this.state || !this.contentEl) {
      return;
    }

    const hoveredPathIds = new Set(getActivePath(this.state.metadata, this.hoveredBlockId).map((block) => block.id));
    const hoveredSelectableIds = new Set(
      this.hoveredBlockId
        ? getChildren(this.state.metadata, this.hoveredBlockId).map((block) => block.id)
        : []
    );

    this.contentEl.querySelectorAll<HTMLElement>("[data-block-id]").forEach((element) => {
      const blockId = element.dataset.blockId;
      if (!blockId) {
        return;
      }

      element.toggleClass("is-hover-linked", this.hoveredBlockId === blockId);
      element.toggleClass(
        "is-hover-linked-path",
        this.hoveredBlockId !== null &&
          this.hoveredBlockId !== blockId &&
          (hoveredPathIds.has(blockId) || hoveredSelectableIds.has(blockId))
      );
    });
  }

  private applyPendingFocusAndScroll(preservedSceneWidth = 0): void {
    const pendingFocusBlockId = this.pendingFocusBlockId;
    const pendingScrollBlockId = this.pendingScrollBlockId;
    this.pendingFocusBlockId = null;
    this.pendingScrollBlockId = null;

    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
    }

    this.pendingFocusFrame = window.requestAnimationFrame(() => {
      this.pendingFocusFrame = null;
      const columnsEl = this.columnsEl;
      const columnsViewportEl = this.columnsViewportEl;
      if (!columnsEl || !columnsViewportEl) {
        return;
      }

      this.alignColumnsToActivePath();
      this.syncViewportEdgeFades();

      const activeCard = columnsEl.querySelector<HTMLElement>(".arbor-card.is-active");
      if (pendingFocusBlockId) {
        let focusHandled = false;
        if (this.editingSession?.blockId === pendingFocusBlockId && this.editingSession.origin === "preview") {
          const previewEditor = this.previewContentEl?.querySelector<HTMLTextAreaElement>(
            `.arbor-preview-block[data-block-id="${pendingFocusBlockId}"] textarea.arbor-editor`
          );
          if (previewEditor) {
            previewEditor.focus({ preventScroll: true });
            if (this.editingSession.autofocus) {
              previewEditor.setSelectionRange(previewEditor.value.length, previewEditor.value.length);
              this.editingSession.autofocus = false;
            }
            focusHandled = true;
          }
        }
        const focusCard = !focusHandled
          ? columnsEl.querySelector<HTMLElement>(`.arbor-card[data-block-id="${pendingFocusBlockId}"]`)
          : null;
        if (focusCard) {
          const editor = focusCard.querySelector<HTMLTextAreaElement>("textarea.arbor-editor");
          if (editor && this.editingSession?.blockId === pendingFocusBlockId && this.editingSession.origin === "card") {
            editor.focus({ preventScroll: true });
            if (this.editingSession.autofocus) {
              editor.setSelectionRange(editor.value.length, editor.value.length);
              this.editingSession.autofocus = false;
            }
          } else {
            focusCard.focus({ preventScroll: true });
          }
        } else if (!focusHandled) {
          columnsViewportEl.focus({ preventScroll: true });
        }
      }
      if (pendingScrollBlockId) {
        const scrollCard = columnsEl.querySelector<HTMLElement>(`.arbor-card[data-block-id="${pendingScrollBlockId}"]`) ?? activeCard;
        if (scrollCard) {
          this.scrollCardIntoHorizontalView(scrollCard, columnsViewportEl, preservedSceneWidth);
        }
      } else {
        this.releasePreservedSceneWidth();
      }
    });
  }

  private handleColumnDragOver(event: DragEvent): void {
    if (!this.plugin.settings.dragAndDrop) {
      return;
    }

    event.preventDefault();
    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const cardsEl = event.currentTarget as HTMLElement;
    const column = this.currentColumnMap.get(cardsEl.dataset.columnKey ?? "");
    const draggedBlockId = this.readDraggedBlockId(event);
    if (!column || !draggedBlockId || column.blocks.length > 0) {
      return;
    }

    this.updateDragState({
      draggedBlockId,
      targetParentId: column.parentId,
      targetIndex: 0,
      columnKey: column.key
    });
  }

  private handleViewportDragOver(event: DragEvent): void {
    if (!this.plugin.settings.dragAndDrop || !this.dragPreviewEl) {
      return;
    }

    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  private handleCardClick(event: MouseEvent): void {
    event.preventDefault();
    const card = event.currentTarget as HTMLElement;
    const blockId = card.dataset.blockId;
    if (!blockId) {
      return;
    }

    const isActive = this.state?.selectedBlockId === blockId;
    if (isActive && this.editingSession?.blockId !== blockId) {
      this.beginEditingBlock(blockId);
      return;
    }
    this.selectBlock(blockId, { focus: true });
  }

  private handleCardDoubleClick(event: MouseEvent): void {
    const blockId = (event.currentTarget as HTMLElement).dataset.blockId;
    if (blockId) {
      this.beginEditingBlock(blockId);
    }
  }

  private handleCardContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const blockId = (event.currentTarget as HTMLElement).dataset.blockId;
    if (!blockId) {
      return;
    }

    this.selectBlock(blockId);
    this.buildBlockMenu(blockId).showAtMouseEvent(event);
  }

  private handleCardKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (this.handleSearchShortcut(event)) {
      return;
    }
    if (this.handleHistoryShortcut(event)) {
      return;
    }
    if (event.altKey) {
      return;
    }

    const blockId = (event.currentTarget as HTMLElement).dataset.blockId;
    if (!blockId) {
      return;
    }

    if (this.state?.selectedBlockId !== blockId) {
      this.state!.selectedBlockId = blockId;
    }

    if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) {
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectPreviousSiblingBlock();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectNextSiblingBlock();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.selectParentBlock();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.selectPreferredChildBlock();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      this.selectFirstSiblingBlock();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      this.selectLastSiblingBlock();
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void this.deleteSelectedBlock();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this.beginEditingBlock(blockId);
    }
  }

  private handleViewportKeyDown(event: KeyboardEvent): void {
    if (this.handleSearchShortcut(event)) {
      return;
    }
    if (this.handleHistoryShortcut(event)) {
      return;
    }
    if (event.altKey) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea")) {
      return;
    }

    if (!this.state?.selectedBlockId) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) {
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectPreviousSiblingBlock();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectNextSiblingBlock();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.selectParentBlock();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.selectPreferredChildBlock();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      this.selectFirstSiblingBlock();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      this.selectLastSiblingBlock();
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void this.deleteSelectedBlock();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.beginEditingBlock(this.state.selectedBlockId);
    }
  }

  private handleCardDragStart(event: DragEvent): void {
    if (!this.plugin.settings.dragAndDrop) {
      return;
    }

    const card = event.currentTarget as HTMLElement;
    const blockId = card.dataset.blockId;
    const columnKey = card.dataset.columnKey ?? "";
    const blockIndex = Number(card.dataset.blockIndex ?? "-1");
    const column = this.currentColumnMap.get(columnKey);
    if (!blockId || !column || blockIndex < 0) {
      return;
    }

    event.dataTransfer?.setData("text/plain", blockId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setDragImage(this.getTransparentDragImage(), 0, 0);
    }

    this.dragState = {
      draggedBlockId: blockId,
      targetParentId: column.parentId,
      targetIndex: blockIndex,
      columnKey
    };
    card.addClass("is-drag-source");
    this.startDragPreview(card, blockId, event);
  }

  private handleCardDragOver(event: DragEvent): void {
    if (!this.plugin.settings.dragAndDrop) {
      return;
    }

    event.preventDefault();
    this.updateDragPreviewPointer(event);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const card = event.currentTarget as HTMLElement;
    const columnKey = card.dataset.columnKey ?? "";
    const blockIndex = Number(card.dataset.blockIndex ?? "-1");
    const column = this.currentColumnMap.get(columnKey);
    const draggedBlockId = this.readDraggedBlockId(event);
    if (!column || !draggedBlockId || blockIndex < 0) {
      return;
    }

    const rect = card.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    this.updateDragState({
      draggedBlockId,
      targetParentId: column.parentId,
      targetIndex: before ? blockIndex : blockIndex + 1,
      columnKey
    });
  }

  private handleCardDrop(event: DragEvent): void {
    event.preventDefault();
    const column = this.currentColumnMap.get((event.currentTarget as HTMLElement).dataset.columnKey ?? "");
    if (column) {
      void this.applyDrop(column);
    }
  }

  private handleCardDragEnd(): void {
    this.dragState = null;
    this.cleanupDragPreview();
    this.render();
  }

  private renderBreadcrumb(container: HTMLElement): void {
    if (!this.state) {
      return;
    }

    const strip = container.createDiv({ cls: "arbor-breadcrumbs" });
    const path = getActivePath(this.state.metadata, this.state.selectedBlockId);
    if (path.length === 0) {
      strip.createSpan({ cls: "arbor-breadcrumb-empty", text: this.file?.basename ?? "Arbor" });
      return;
    }

    this.renderBreadcrumbItems(strip, path);
  }

  private async renderColumn(container: HTMLElement, column: BranchColumnModel): Promise<void> {
    const columnEl = container.createDiv({ cls: "arbor-column" });
    columnEl.dataset.columnKey = column.key;
    columnEl.dataset.parentId = column.parentId ?? "";

    const cardsEl = columnEl.createDiv({ cls: "arbor-card-list" });

    if (this.plugin.settings.dragAndDrop) {
      cardsEl.addEventListener("dragover", (event) => this.handleColumnDragOver(event));
      cardsEl.addEventListener("drop", (event) => {
        event.preventDefault();
        void this.applyDrop(column);
      });
    }

    if (column.blocks.length === 0) {
      const empty = cardsEl.createDiv({ cls: "arbor-column-empty" });
      empty.setText(column.parentId ? "No child blocks yet." : "No root blocks yet.");
      empty.toggleClass("is-selectable-context", column.parentId === this.state?.selectedBlockId);
      if (column.parentId) {
        empty.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.state!.selectedBlockId = column.parentId;
          const menu = new Menu();
          menu.addItem((item) =>
            item.setTitle("Create child block").setIcon("arrow-right").onClick(() => void this.createChild())
          );
          menu.showAtMouseEvent(event);
        });
      }
      return;
    }

    column.blocks.forEach((block, index) => {
      if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === index) {
        cardsEl.createDiv({ cls: "arbor-drop-indicator" });
      }
    });

    for (let index = 0; index < column.blocks.length; index += 1) {
      await this.renderCard(cardsEl, column.blocks[index], column, index);
      if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === index + 1) {
        cardsEl.createDiv({ cls: "arbor-drop-indicator" });
      }
    }
  }

  private async renderCard(container: HTMLElement, block: BranchBlock, column: BranchColumnModel, index: number): Promise<void> {
    const card = container.createDiv({ cls: "arbor-card" });
    card.tabIndex = 0;
    card.dataset.blockId = block.id;
    card.dataset.columnKey = column.key;
    card.dataset.blockIndex = String(index);
    card.dataset.parentId = block.parentId ?? "";
    const activePathIds = new Set(getActivePath(this.state!.metadata, this.state!.selectedBlockId).map((item) => item.id));
    const selectableChildIds = new Set(
      this.state?.selectedBlockId
        ? getChildren(this.state.metadata, this.state.selectedBlockId).map((item) => item.id)
        : []
    );

    if (this.state?.selectedBlockId === block.id) {
      card.addClass("is-active");
    } else if (activePathIds.has(block.id)) {
      card.addClass("is-on-path");
    } else if (selectableChildIds.has(block.id)) {
      card.addClass("is-selectable");
    } else if (activePathIds.size > 0) {
      card.addClass("is-muted");
    }

    if (this.dragState?.draggedBlockId === block.id) {
      card.addClass("is-drag-source");
    }

    card.addEventListener("click", () => {
      const isActive = this.state?.selectedBlockId === block.id;
      if (isActive && this.editingSession?.blockId !== block.id) {
        this.beginEditingBlock(block.id);
        return;
      }
      this.selectBlock(block.id, { focus: true });
    });
    card.addEventListener("dblclick", () => {
      this.beginEditingBlock(block.id);
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (this.state) {
        this.state.selectedBlockId = block.id;
      }
      this.buildBlockMenu(block.id).showAtMouseEvent(event);
    });
    card.addEventListener("keydown", (event) => {
      if (this.handleHistoryShortcut(event)) {
        return;
      }
      if (event.altKey) {
        return;
      }

      if (this.state?.selectedBlockId !== block.id) {
        this.state!.selectedBlockId = block.id;
      }

      if ((event.ctrlKey || event.metaKey) && this.handleDirectionalCreateShortcut(event)) {
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.selectPreviousSiblingBlock();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.selectNextSiblingBlock();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.selectParentBlock();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.selectPreferredChildBlock();
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        this.selectFirstSiblingBlock();
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        this.selectLastSiblingBlock();
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        void this.deleteSelectedBlock();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        this.beginEditingBlock(block.id);
      }
    });

    if (this.plugin.settings.dragAndDrop) {
      card.draggable = true;
      card.addEventListener("dragstart", (event) => this.handleCardDragStart(event));
      card.addEventListener("dragend", () => this.handleCardDragEnd());
      card.addEventListener("dragover", (event) => this.handleCardDragOver(event));
      card.addEventListener("drop", (event) => this.handleCardDrop(event));
    }

    const isEditing = this.editingSession?.blockId === block.id;
    if (isEditing && this.editingSession) {
      card.addClass("is-editing");
      const editor = card.createEl("textarea", { cls: "arbor-editor" });
      editor.value = this.editingSession.value;
      this.resizeEditor(editor);
      ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach((eventName) => {
        editor.addEventListener(eventName, (event) => {
          event.stopPropagation();
        });
      });
      editor.addEventListener("input", () => {
        if (this.editingSession?.blockId === block.id) {
          this.editingSession.value = editor.value;
          this.resizeEditor(editor);
        }
      });
      editor.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          this.cancelEditingSession();
        } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          void this.commitEditingSession();
        }
      });
      editor.addEventListener("paste", (event) => {
        event.stopPropagation();
        void this.handleEditorPaste(event, editor);
      });
      editor.addEventListener("drop", (event) => {
        event.stopPropagation();
        void this.handleEditorDrop(event, editor);
      });
      editor.addEventListener("dragover", (event) => {
        event.stopPropagation();
        if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith("image/"))) {
          event.preventDefault();
        }
      });
      editor.addEventListener("focus", (event) => {
        event.stopPropagation();
      });

      if (this.editingSession.autofocus) {
        window.setTimeout(() => {
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
          this.resizeEditor(editor);
          if (this.editingSession) {
            this.editingSession.autofocus = false;
          }
        }, 0);
      }
      return;
    }

    const content = card.createDiv({ cls: "arbor-card-content markdown-rendered" });
    await MarkdownRenderer.render(this.app, block.content, content, this.file?.path ?? "", this);
    if (content.innerText.trim().length === 0) {
      content.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
    }
    content.querySelectorAll("img").forEach((image) => {
      image.addEventListener("load", () => this.scheduleColumnAlignment(), { once: true });
    });
  }

  private async applyDrop(column: BranchColumnModel): Promise<void> {
    if (!this.dragState || !this.state) {
      return;
    }

    const { draggedBlockId, targetIndex, targetParentId } = this.dragState;
    this.dragState = null;
    this.cleanupDragPreview();
    await this.applyMutation("Move block", (metadata) => ({
      metadata: moveBlockToParentAtIndex(metadata, draggedBlockId, targetParentId, targetIndex),
      selectedBlockId: draggedBlockId
    }));
  }

  private readDraggedBlockId(event: DragEvent): BranchBlockId | null {
    return event.dataTransfer?.getData("text/plain") || this.dragState?.draggedBlockId || null;
  }

  private getTransparentDragImage(): HTMLCanvasElement {
    if (!this.transparentDragImageEl) {
      const canvas = this.contentEl.ownerDocument.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      this.transparentDragImageEl = canvas;
    }

    return this.transparentDragImageEl;
  }

  private startDragPreview(card: HTMLElement, blockId: BranchBlockId, event: DragEvent): void {
    this.cleanupDragPreview();

    if (!this.columnsStageEl) {
      return;
    }

    const preview = card.cloneNode(true) as HTMLElement;
    preview.removeAttribute("tabindex");
    preview.draggable = false;
    preview.classList.remove("is-drag-source", "is-hover-linked", "is-hover-linked-path");
    preview.classList.add("arbor-drag-preview");
    preview.dataset.blockId = blockId;
    preview.setAttribute("aria-hidden", "true");
    preview.querySelectorAll<HTMLElement>("[tabindex]").forEach((element) => element.removeAttribute("tabindex"));
    preview.style.width = `${card.offsetWidth}px`;

    const rect = card.getBoundingClientRect();
    const stageRect = this.columnsStageEl.getBoundingClientRect();
    const initialLeft = rect.left - stageRect.left;
    const initialTop = rect.top - stageRect.top;
    preview.style.transform = `translate3d(${Math.round(initialLeft)}px, ${Math.round(initialTop)}px, 0)`;

    const rememberedPointer =
      this.lastCardPointerPosition?.blockId === blockId
        ? this.lastCardPointerPosition
        : null;
    const pointerX = rememberedPointer?.clientX ?? event.clientX;
    const pointerY = rememberedPointer?.clientY ?? event.clientY;
    const hasPointer = Number.isFinite(pointerX) && Number.isFinite(pointerY) && (pointerX !== 0 || pointerY !== 0);

    this.dragPreviewOffset = hasPointer
      ? {
          x: Math.max(0, Math.min(pointerX - rect.left, rect.width)),
          y: Math.max(0, Math.min(pointerY - rect.top, rect.height))
        }
      : {
          x: Math.min(rect.width * 0.34, 72),
          y: Math.min(rect.height * 0.28, 56)
        };
    this.dragPreviewPoint = hasPointer ? { x: pointerX, y: pointerY } : null;
    this.dragPreviewEl = preview;
    this.columnsStageEl.addClass("is-dragging");
    this.columnsStageEl.appendChild(preview);
    this.contentEl.ownerDocument.addEventListener("dragover", this.documentDragOverHandler);
    if (this.dragPreviewPoint) {
      this.scheduleDragPreviewPosition();
    }
  }

  private handleDocumentDragOver(event: DragEvent): void {
    if (!this.dragPreviewEl) {
      return;
    }

    this.updateDragPreviewPointer(event);
  }

  private updateDragPreviewPointer(event: Pick<DragEvent, "clientX" | "clientY">): void {
    if (!this.dragPreviewEl) {
      return;
    }

    this.dragPreviewPoint = { x: event.clientX, y: event.clientY };
    this.scheduleDragPreviewPosition();
  }

  private scheduleDragPreviewPosition(): void {
    if (this.dragPreviewFrame !== null) {
      return;
    }

    this.dragPreviewFrame = window.requestAnimationFrame(() => {
      this.dragPreviewFrame = null;
      this.syncDragPreviewPosition();
    });
  }

  private syncDragPreviewPosition(): void {
    if (!this.dragPreviewEl || !this.columnsStageEl || !this.dragPreviewPoint) {
      return;
    }

    const stageRect = this.columnsStageEl.getBoundingClientRect();
    const left = this.dragPreviewPoint.x - stageRect.left - this.dragPreviewOffset.x;
    const top = this.dragPreviewPoint.y - stageRect.top - this.dragPreviewOffset.y;
    this.dragPreviewEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  private cleanupDragPreview(): void {
    this.contentEl.ownerDocument.removeEventListener("dragover", this.documentDragOverHandler);
    if (this.dragPreviewFrame !== null) {
      window.cancelAnimationFrame(this.dragPreviewFrame);
      this.dragPreviewFrame = null;
    }

    this.dragPreviewEl?.remove();
    this.dragPreviewEl = null;
    this.dragPreviewPoint = null;
    this.dragPreviewOffset = { x: 0, y: 0 };
    this.lastCardPointerPosition = null;
    this.columnsStageEl?.removeClass("is-dragging");
    this.contentEl.querySelectorAll(".arbor-card.is-drag-source").forEach((element) => {
      element.classList.remove("is-drag-source");
    });
  }

  private rememberCardPointerPosition(blockId: BranchBlockId, clientX: number, clientY: number): void {
    this.lastCardPointerPosition = { blockId, clientX, clientY };
  }

  private async applyMutation(
    label: string,
    mutate: (metadata: BranchTreeMetadata) => { metadata: BranchTreeMetadata; selectedBlockId: BranchBlockId | null },
    autofocusSelection = false
  ): Promise<void> {
    if (!this.state) {
      return;
    }

    await this.commitEditIfNeeded();

    this.history.push(label, this.state.metadata, this.state.selectedBlockId);
    const result = mutate(cloneMetadata(this.state.metadata));
    this.state.metadata = applyBodyHash(result.metadata);
    this.state.selectedBlockId = ensureSelectedBlock(this.state.metadata, result.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.pendingScrollBlockId = this.state.selectedBlockId;

    if (autofocusSelection && this.state.selectedBlockId) {
      const block = getBlock(this.state.metadata, this.state.selectedBlockId);
      if (block) {
        this.editingSession = {
          blockId: block.id,
          originalContent: block.content,
          value: block.content,
          autofocus: true,
          origin: "card"
        };
      }
    }

    await this.persistState(label);
    this.render();
  }

  private currentHistorySnapshot(label: string): BranchHistoryEntry {
    return {
      label,
      metadata: cloneMetadata(this.state?.metadata ?? createEmptyTree()),
      selectedBlockId: this.state?.selectedBlockId ?? null
    };
  }

  private async commitEditIfNeeded(): Promise<void> {
    if (this.editingSession) {
      await this.commitEditingSession();
    }
  }

  private cancelEditingSession(): void {
    this.clearBlurCommitTimer();
    this.pendingFocusBlockId = this.state?.selectedBlockId ?? null;
    this.editingSession = null;
    this.render();
  }

  private async commitEditingSession(session: EditingSession | null = this.editingSession): Promise<void> {
    if (!this.state || !session || this.editingSession !== session) {
      return;
    }

    this.clearBlurCommitTimer();

    const { blockId, value } = session;
    if (value === session.originalContent) {
      this.pendingFocusBlockId = blockId;
      this.editingSession = null;
      this.render();
      return;
    }

    this.history.push("Edit block", this.state.metadata, this.state.selectedBlockId);
    this.state.metadata = applyBodyHash(updateBlockContent(this.state.metadata, blockId, value));
    this.state.selectedBlockId = blockId;
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.pendingFocusBlockId = blockId;
    this.editingSession = null;
    await this.persistState("Edit block");
    this.render();
  }

  private scheduleEditingSessionCommit(session: EditingSession): void {
    this.clearBlurCommitTimer();
    this.blurCommitTimer = window.setTimeout(() => {
      if (this.editingSession !== session) {
        return;
      }
      void this.commitEditingSession(session);
    }, 80);
  }

  private clearBlurCommitTimer(): void {
    if (this.blurCommitTimer !== null) {
      window.clearTimeout(this.blurCommitTimer);
      this.blurCommitTimer = null;
    }
  }

  private resetViewState(): void {
    this.clearBlurCommitTimer();
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
      this.pendingFocusFrame = null;
    }
    this.stopHorizontalScrollMotion();
    this.cleanupDragPreview();
    this.cleanupViewportPan();
    this.state = null;
    this.history.clear();
    this.editingSession = null;
    this.dragState = null;
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.teardownShell();
  }

  private async persistState(reason: string): Promise<void> {
    if (!this.file || !this.state) {
      return;
    }

    const metadata = applyBodyHash(this.state.metadata);
    this.state.metadata = metadata;
    this.state.linearized = linearizeTree(metadata);
    const document = buildBranchDocument(
      this.state.frontmatter,
      this.state.linearized.body,
      metadata,
      this.plugin.settings.metadataBlockStyle
    );

    this.isPersisting = true;
    try {
      this.plugin.markOwnWrite(this.file.path);
      await this.app.vault.modify(this.file, document);
      this.plugin.rememberManagedNote(this.file.path);
    } catch (error) {
      console.error(`[Arbor] Failed to persist state after ${reason}`, error);
      new Notice(`Arbor could not save the note after "${reason}".`);
    } finally {
      this.isPersisting = false;
    }
  }

  private applyCssVars(root: HTMLElement): void {
    root.style.setProperty("--bw-card-width", `${this.plugin.settings.cardWidth}px`);
    root.style.setProperty("--bw-card-min-height", `${this.plugin.settings.cardMinHeight}px`);
    root.style.setProperty("--bw-column-gap", `${this.plugin.settings.horizontalSpacing}px`);
    root.style.setProperty("--bw-card-gap", `${this.plugin.settings.verticalSpacing}px`);
    root.style.setProperty("--bw-zoom", `${this.plugin.settings.zoomLevel}`);
    root.style.setProperty("--bw-content-zoom", `${this.plugin.settings.zoomLevel}`);
    this.syncZoomIndicator();
  }

  private applyViewClasses(root: HTMLElement): void {
    root.classList.add("is-context-dim-mode");
  }

  private buildBlockMenu(blockId: BranchBlockId): Menu {
    const menu = new Menu();
    const canCreateLeft = this.state ? Boolean(getParentBlock(this.state.metadata, blockId)) : false;
    const childCount = this.state ? getChildren(this.state.metadata, blockId).length : 0;
    const block = this.state ? getBlock(this.state.metadata, blockId) : null;

    menu
      .addItem((item) =>
        item.setTitle("Continue to the right").setIcon("arrow-right").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createChild()))
      );

    if (canCreateLeft) {
      menu.addItem((item) =>
        item.setTitle("Create block to the left").setIcon("arrow-left").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createParentLevelBlock()))
      );
    }

    menu
      .addItem((item) =>
        item.setTitle("Create sibling above").setIcon("arrow-up").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createSiblingAbove()))
      )
      .addItem((item) =>
        item.setTitle("Create sibling below").setIcon("arrow-down").onClick(() => void this.runWithSelectedBlock(blockId, () => this.createSiblingBelow()))
      )
      .addSeparator()
      .addItem((item) =>
        item.setTitle("Select parent").setIcon("corner-up-left").onClick(() => this.runWithSelectedBlock(blockId, () => {
          this.selectParentBlock();
          return Promise.resolve();
        }))
      )
      .addItem((item) =>
        item.setTitle("Select previous sibling").setIcon("chevron-up").onClick(() => this.runWithSelectedBlock(blockId, () => {
          this.selectPreviousSiblingBlock();
          return Promise.resolve();
        }))
      )
      .addItem((item) =>
        item.setTitle("Select next sibling").setIcon("chevron-down").onClick(() => this.runWithSelectedBlock(blockId, () => {
          this.selectNextSiblingBlock();
          return Promise.resolve();
        }))
      )
      .addItem((item) =>
        item.setTitle("Select first child").setIcon("chevron-right").onClick(() => this.runWithSelectedBlock(blockId, () => {
          this.selectFirstChildBlock();
          return Promise.resolve();
        }))
      );

    if (childCount > 0 && block) {
      menu
        .addItem((item) =>
          item
            .setTitle(block.collapsed ? "Expand branch" : "Collapse branch")
            .setIcon(block.collapsed ? "chevrons-down-up" : "chevrons-up-down")
            .onClick(() => void this.runWithSelectedBlock(blockId, () => this.toggleCollapsedState(blockId)))
        );
    }

    menu
      .addSeparator()
      .addItem((item) =>
        item.setTitle("Duplicate subtree").setIcon("copy-plus").onClick(() => void this.runWithSelectedBlock(blockId, () => this.duplicateSelectedSubtree()))
      )
      .addItem((item) =>
        item.setTitle("Reveal in markdown").setIcon("file-text").onClick(() => void this.runWithSelectedBlock(blockId, () => this.revealCurrentBlockInMarkdown()))
      )
      .addSeparator()
      .addItem((item) =>
        item
          .setTitle("Delete block")
          .setIcon("trash")
          .setWarning(true)
          .onClick(() => void this.runWithSelectedBlock(blockId, () => this.deleteSelectedBlock()))
      )
      .addItem((item) =>
        item
          .setTitle("Delete subtree")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => void this.runWithSelectedBlock(blockId, () => this.deleteSelectedSubtree()))
      );

    this.applyDangerMenuItemStyles(menu);

    return menu;
  }

  private applyDangerMenuItemStyles(menu: Menu): void {
    const menuWithDom = menu as Menu & { dom?: HTMLElement };
    window.requestAnimationFrame(() => {
      const menuEl = menuWithDom.dom;
      if (!menuEl) {
        return;
      }

      menuEl.querySelectorAll<HTMLElement>(".menu-item-title").forEach((titleEl) => {
        const text = titleEl.textContent?.trim();
        if (text === "Delete block" || text === "Delete subtree") {
          titleEl.closest(".menu-item")?.addClass("arbor-menu-danger");
        }
      });
    });
  }

  private async runWithSelectedBlock(blockId: BranchBlockId, callback: () => Promise<void>): Promise<void> {
    this.selectBlock(blockId);
    await callback();
  }

  private updateDragState(nextDragState: DragState): void {
    const current = this.dragState;
    if (
      current?.draggedBlockId === nextDragState.draggedBlockId &&
      current?.targetParentId === nextDragState.targetParentId &&
      current?.targetIndex === nextDragState.targetIndex &&
      current?.columnKey === nextDragState.columnKey
    ) {
      return;
    }

    this.dragState = nextDragState;
    this.render();
  }

  private scheduleColumnAlignment(): void {
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
    }

    this.layoutFrame = window.requestAnimationFrame(() => {
      this.layoutFrame = null;
      this.alignColumnsToActivePath();
    });
  }

  private resizeEditor(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 180)}px`;
  }

  private handleViewportWheel(event: WheelEvent, viewport: HTMLElement): void {
    if ((event.ctrlKey || event.metaKey) && this.plugin.settings.enableCtrlWheelZoom) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
      this.updateZoomLevel(this.plugin.settings.zoomLevel * factor);
      return;
    }

    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.ctrlKey || event.metaKey) {
      return;
    }

    if (viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }

    event.preventDefault();
    viewport.scrollBy({
      left: event.deltaY,
      behavior: "auto"
    });
  }

  private syncViewportEdgeFades(): void {
    const stage = this.columnsStageEl;
    const viewport = this.columnsViewportEl;
    if (!stage || !viewport) {
      return;
    }

    const canScrollHorizontally = viewport.scrollWidth - viewport.clientWidth > 1;
    const hasHiddenLeft = canScrollHorizontally && viewport.scrollLeft > 2;
    const hasHiddenRight = canScrollHorizontally && viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2;

    stage.classList.toggle("has-hidden-left", hasHiddenLeft);
    stage.classList.toggle("has-hidden-right", hasHiddenRight);
  }

  private updateZoomLevel(nextZoomLevel: number): void {
    const clamped = Math.max(0.7, Math.min(1.6, Number(nextZoomLevel.toFixed(3))));
    if (Math.abs(clamped - this.plugin.settings.zoomLevel) < 0.001) {
      return;
    }

    this.plugin.settings.zoomLevel = clamped;
    this.applyCssVars(this.contentEl);
    this.scheduleColumnAlignment();
    this.scheduleZoomPersist();
    this.flashZoomIndicator();

    window.requestAnimationFrame(() => {
      this.alignColumnsToActivePath();
      const viewport = this.columnsViewportEl;
      const activeCard = this.columnsEl?.querySelector<HTMLElement>(".arbor-card.is-active");
      if (viewport && activeCard) {
        this.scrollCardIntoHorizontalView(activeCard, viewport);
      }
    });
  }

  private scheduleZoomPersist(): void {
    this.clearZoomPersistTimer();
    this.zoomPersistTimer = window.setTimeout(() => {
      this.zoomPersistTimer = null;
      void this.plugin.saveSettings();
    }, 180);
  }

  private clearZoomPersistTimer(): void {
    if (this.zoomPersistTimer !== null) {
      window.clearTimeout(this.zoomPersistTimer);
      this.zoomPersistTimer = null;
    }
  }

  private syncZoomIndicator(): void {
    if (!this.zoomIndicatorEl) {
      return;
    }

    const zoomPercent = Math.round(this.plugin.settings.zoomLevel * 100);
    this.zoomIndicatorEl.textContent = `${zoomPercent}%`;
    const isDefaultZoom = Math.abs(this.plugin.settings.zoomLevel - 1) < 0.001;
    this.zoomIndicatorEl.classList.toggle("is-default", isDefaultZoom);
    this.zoomIndicatorEl.title = isDefaultZoom
      ? "Zoom 100%. Ctrl/Cmd + wheel to zoom."
      : "Click to reset zoom to 100%. Ctrl/Cmd + wheel to zoom.";
  }

  private flashZoomIndicator(): void {
    if (!this.zoomIndicatorEl) {
      return;
    }

    this.zoomIndicatorEl.addClass("is-visible");
    this.clearZoomIndicatorTimer();
    this.zoomIndicatorTimer = window.setTimeout(() => {
      this.zoomIndicatorTimer = null;
      this.zoomIndicatorEl?.removeClass("is-visible");
    }, 1100);
  }

  private clearZoomIndicatorTimer(): void {
    if (this.zoomIndicatorTimer !== null) {
      window.clearTimeout(this.zoomIndicatorTimer);
      this.zoomIndicatorTimer = null;
    }
  }

  private handleViewportPointerDown(event: PointerEvent, viewport: HTMLElement): void {
    if (event.button !== 0 || viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        ".arbor-card, textarea, button, a, input, select"
      )
    ) {
      return;
    }

    this.viewportPanState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
      dragging: false
    };
    viewport.setPointerCapture(event.pointerId);
  }

  private handleDirectionalCreateShortcut(event: KeyboardEvent): boolean {
    if (!this.state?.selectedBlockId) {
      return false;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      void this.createChild();
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      void this.createSiblingAbove();
      return true;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      void this.createSiblingBelow();
      return true;
    }

    if (event.key === "ArrowLeft") {
      const parent = getParentBlock(this.state.metadata, this.state.selectedBlockId);
      if (!parent) {
        return false;
      }

      event.preventDefault();
      void this.createParentLevelBlock();
      return true;
    }

    return false;
  }

  private handleViewportPointerMove(event: PointerEvent, viewport: HTMLElement): void {
    if (!this.viewportPanState || this.viewportPanState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.viewportPanState.startClientX;
    if (!this.viewportPanState.dragging) {
      if (Math.abs(deltaX) < 4) {
        return;
      }

      this.viewportPanState.dragging = true;
      viewport.classList.add("is-panning");
    }

    viewport.scrollLeft = this.viewportPanState.startScrollLeft - deltaX;
    event.preventDefault();
  }

  private handleViewportPointerUp(event: PointerEvent, viewport: HTMLElement): void {
    if (!this.viewportPanState || this.viewportPanState.pointerId !== event.pointerId) {
      return;
    }

    this.cleanupViewportPan(viewport, event.pointerId);
  }

  private handleViewportPointerCaptureLost(event: PointerEvent, viewport: HTMLElement): void {
    if (!this.viewportPanState || this.viewportPanState.pointerId !== event.pointerId) {
      return;
    }

    this.cleanupViewportPan(viewport, event.pointerId, false);
  }

  private cleanupViewportPan(
    viewport = this.columnsViewportEl,
    pointerId?: number,
    releaseCapture = true
  ): void {
    const activePointerId = pointerId ?? this.viewportPanState?.pointerId;
    this.viewportPanState = null;
    viewport?.classList.remove("is-panning");

    if (!releaseCapture || !viewport || activePointerId === undefined) {
      return;
    }

    if (viewport.hasPointerCapture(activePointerId)) {
      viewport.releasePointerCapture(activePointerId);
    }
  }

  private armSceneWidthForPendingScroll(): number {
    if (!this.pendingScrollBlockId || !this.columnsEl || !this.columnsViewportEl) {
      return 0;
    }

    const preservedSceneWidth = Math.max(this.columnsEl.scrollWidth, this.columnsViewportEl.clientWidth);
    this.columnsEl.style.minWidth = `${preservedSceneWidth}px`;
    return preservedSceneWidth;
  }

  private releasePreservedSceneWidth(): void {
    if (this.columnsEl) {
      this.columnsEl.style.minWidth = "";
    }
  }

  private stopHorizontalScrollMotion(releasePreservedWidth = true): void {
    if (this.horizontalScrollFrame !== null) {
      window.cancelAnimationFrame(this.horizontalScrollFrame);
      this.horizontalScrollFrame = null;
    }

    if (releasePreservedWidth) {
      this.releasePreservedSceneWidth();
    }
  }

  private clearBreadcrumbScrollFrame(): void {
    if (this.breadcrumbScrollFrame !== null) {
      window.cancelAnimationFrame(this.breadcrumbScrollFrame);
      this.breadcrumbScrollFrame = null;
    }
  }

  private animateViewportScrollTo(viewport: HTMLElement, targetLeft: number): void {
    this.stopHorizontalScrollMotion(false);

    const startLeft = viewport.scrollLeft;
    const distance = targetLeft - startLeft;
    if (Math.abs(distance) < 1) {
      viewport.scrollLeft = targetLeft;
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
      return;
    }

    const duration = Math.max(180, Math.min(320, 170 + Math.abs(distance) * 0.18));
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      viewport.scrollLeft = startLeft + distance * eased;

      if (progress < 1) {
        this.horizontalScrollFrame = window.requestAnimationFrame(tick);
        return;
      }

      this.horizontalScrollFrame = null;
      viewport.scrollLeft = targetLeft;
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
    };

    this.horizontalScrollFrame = window.requestAnimationFrame(tick);
  }

  private scrollCardIntoHorizontalView(card: HTMLElement, viewport: HTMLElement, preservedSceneWidth = 0): void {
    const viewportRect = viewport.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const blockId = card.dataset.blockId ?? null;
    const activeBlock = this.state ? getBlock(this.state.metadata, this.state.selectedBlockId) : null;
    const shouldCenterSelectedBlock =
      Boolean(blockId) &&
      this.state?.selectedBlockId === blockId &&
      Boolean(activeBlock?.parentId);
    const safePadding = Math.min(96, viewport.clientWidth * 0.18);
    const shouldScrollLeft = cardRect.left < viewportRect.left + safePadding;
    const shouldScrollRight = cardRect.right > viewportRect.right - safePadding;

    if (!shouldCenterSelectedBlock && !shouldScrollLeft && !shouldScrollRight) {
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
      return;
    }

    if (preservedSceneWidth > 0 && this.columnsEl) {
      this.columnsEl.style.minWidth = `${Math.max(preservedSceneWidth, viewport.clientWidth)}px`;
    }

    const cardCenter =
      viewport.scrollLeft +
      (cardRect.left - viewportRect.left) +
      cardRect.width / 2;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const centeredTargetLeft = Math.max(0, Math.min(cardCenter - viewport.clientWidth / 2, maxScrollLeft));
    const targetLeft = shouldCenterSelectedBlock
      ? centeredTargetLeft
      : shouldScrollLeft
        ? Math.max(
            0,
            Math.min(
              viewport.scrollLeft - ((viewportRect.left + safePadding) - cardRect.left),
              maxScrollLeft
            )
          )
        : Math.max(
            0,
            Math.min(
              viewport.scrollLeft + (cardRect.right - (viewportRect.right - safePadding)),
              maxScrollLeft
            )
          );
    this.animateViewportScrollTo(viewport, targetLeft);
  }

  private alignColumnsToActivePath(): void {
    if (!this.state) {
      return;
    }

    const viewport = this.columnsViewportEl ?? this.contentEl.querySelector<HTMLElement>(".arbor-columns-viewport");
    const columnsRoot = this.columnsEl ?? this.contentEl.querySelector<HTMLElement>(".arbor-columns");
    if (!viewport || !columnsRoot) {
      return;
    }

    const columns = Array.from(columnsRoot.querySelectorAll<HTMLElement>(".arbor-column"));
    const path = getActivePath(this.state.metadata, this.state.selectedBlockId);
    if (columns.length === 0) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const columnsRootRect = columnsRoot.getBoundingClientRect();
    const rootAnchorCenterY = viewportRect.top - columnsRootRect.top + viewport.clientHeight * 0.44;
    const resolvedCenterYByColumn = new Map<number, number>();

    columns.forEach((columnEl, index) => {
      const listEl = columnEl.querySelector<HTMLElement>(".arbor-card-list");
      if (!listEl) {
        return;
      }

      const fallbackCards = Array.from(columnEl.querySelectorAll<HTMLElement>(".arbor-card"));
      const preferredFallbackCard =
        fallbackCards[Math.floor((Math.max(fallbackCards.length, 1) - 1) / 2)] ?? null;

      const pathBlock = path[index];
      const alignmentTarget =
        (pathBlock
          ? columnEl.querySelector<HTMLElement>(`.arbor-card[data-block-id="${pathBlock.id}"]`)
          : null) ??
        columnEl.querySelector<HTMLElement>(".arbor-column-empty") ??
        preferredFallbackCard;

      if (!alignmentTarget) {
        return;
      }

      const naturalCenterY =
        this.getElementOffsetTopWithin(alignmentTarget, columnsRoot) +
        alignmentTarget.offsetHeight / 2;
      const anchorCenterY = index === 0
        ? rootAnchorCenterY
        : (resolvedCenterYByColumn.get(index - 1) ?? naturalCenterY);
      const shift = anchorCenterY - naturalCenterY;

      if (Math.abs(shift) < 0.25) {
        listEl.style.transform = "";
      } else {
        listEl.style.transform = `translate3d(0, ${shift}px, 0)`;
      }

      if (listEl.hasClass("is-rebinding")) {
        window.requestAnimationFrame(() => {
          listEl.removeClass("is-rebinding");
        });
      }

      resolvedCenterYByColumn.set(index, naturalCenterY + shift);
    });
  }

  private getElementOffsetTopWithin(element: HTMLElement, ancestor: HTMLElement): number {
    let offset = 0;
    let current: HTMLElement | null = element;

    while (current && current !== ancestor) {
      offset += current.offsetTop;
      current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
    }

    return offset;
  }

  private async handleEditorPaste(event: ClipboardEvent, textarea: HTMLTextAreaElement): Promise<void> {
    const items = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (items.length === 0) {
      return;
    }

    event.preventDefault();
    for (const item of items) {
      const file = item.getAsFile();
      if (file) {
        await this.insertImageFileIntoEditor(file, textarea);
      }
    }
  }

  private async handleEditorDrop(event: DragEvent, textarea: HTMLTextAreaElement): Promise<void> {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    for (const file of files) {
      await this.insertImageFileIntoEditor(file, textarea);
    }
  }

  private async insertImageFileIntoEditor(file: File, textarea: HTMLTextAreaElement): Promise<void> {
    if (!this.file || !this.editingSession) {
      return;
    }

    try {
      const attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(this.buildAttachmentName(file), this.file.path);
      const created = await this.app.vault.createBinary(attachmentPath, await file.arrayBuffer());
      const baseLink = this.app.fileManager.generateMarkdownLink(created, this.file.path);
      const embedLink = baseLink.startsWith("!") ? baseLink : `!${baseLink}`;
      this.insertTextAtCursor(textarea, `${textarea.value.trim().length > 0 ? "\n\n" : ""}${embedLink}`);
      this.scheduleColumnAlignment();
    } catch (error) {
      console.error("[Arbor] Failed to save pasted image", error);
      new Notice("Arbor could not save the image into the vault.");
    }
  }

  private insertTextAtCursor(textarea: HTMLTextAreaElement, insertText: string): void {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const nextValue = `${textarea.value.slice(0, start)}${insertText}${textarea.value.slice(end)}`;
    textarea.value = nextValue;
    const nextCursor = start + insertText.length;
    textarea.setSelectionRange(nextCursor, nextCursor);
    textarea.dispatchEvent(new Event("input"));
  }

  private buildAttachmentName(file: File): string {
    if (file.name && file.name.trim().length > 0 && file.name !== "image.png") {
      return file.name;
    }

    const stamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const extension = file.type.split("/")[1] || "png";
    return `Pasted image ${stamp}.${extension}`;
  }
}
