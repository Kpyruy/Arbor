import {
  App,
  ButtonComponent,
  FileView,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Platform,
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
import { VIEW_TYPE_ARBOR } from "../constants";
import {
  BranchBlock,
  BranchBlockId,
  BranchColumnModel,
  BranchHistoryEntry,
  BranchTreeMetadata,
  ImportedBranchDocument,
  ArborPresentationMode,
  ArborOutputProfile,
  ArborOutputState,
  BranchTreeMutationResult,
  ArborSettings
} from "../types";
import {
  createDefaultOutputState,
  FULL_OUTPUT_PROFILE_ID,
  getActiveOutputProfile,
  reconcileProfilesAfterTreeChange,
  resolveOutputStates,
  setBlockOnlyState,
  setSubtreeState,
  setActiveOutputProfile
} from "../outputProfiles";
import { buildBranchDocument, parseBranchDocument } from "../storage/document";
import { loadImportedBranchDocument } from "../storage/reconcile";
import { linearizeTree, normalizeMetadata } from "../storage/serializer";
import { canOpenImportedBranchDocumentInArbor } from "../opening";
import { deepClone, extractPathLabel, extractSnippet, hashString } from "../utils";
import { buildArborBlockLink } from "../blockLinks";
import { projectOutput } from "../outputProjection";
import { getEnteringBreadcrumbIds } from "../breadcrumbAnimation";
import { MOBILE_TREE_OVERVIEW_EXPORT_LIMITS, resolveTreeOverviewExportSize, type TreeOverviewExportQuality } from "../treeOverviewExport";
import { getBreadcrumbScrollInsets, getChildArrowIcon, getHorizontalWheelDelta, getParentArrowIcon, getVisualBreadcrumbOrder } from "../layoutDirection";
import { buildOverviewLayout } from "../model/overviewLayout";
import {
  resolveOverviewCardSelectionState,
  startOverviewSelectionAnimation
} from "../overviewNavigation";
import { resolveColumnWheelTarget } from "../columnWheelNavigation";
import { ARBOR_THEME_VARIABLES, resolveArborThemeVariables } from "../theme";
import {
  canDragCard,
  canStartCardDrag,
  CARD_PREVIEW_MAX_HEIGHT_PX,
  clampCardCenter,
  hasVerticalOverflow,
  reserveSceneWidthForColumns,
  resolveColumnWheelNavigation
} from "../cardViewport";
import { toBlob } from "html-to-image";
import { clampZoomLevel, compactColumns, pinchViewport, resolvePinchZoom, useCompactLayout, TouchPoint } from "../mobile";
import {
  createOutputProfileButton,
  getOutputProfileButtonPresentation,
  OutputProfilesModal
} from "./OutputProfilesModal";
import { buildPreviewPathLabels, buildViewContext } from "./state/viewModel";
import type {
  BranchViewContext,
  EditingOrigin,
  EditingSession,
  LoadedFileState,
  LoadingOverlayState
} from "./state/viewTypes";
import {
  getBlockOutputMenuActions,
  getOutputCardPresentation,
  syncOutputCardPresentation
} from "./output/outputPresentation";
import { ArborConfirmModal } from "./modals/ArborConfirmModal";
import { CleanExportModal } from "./modals/CleanExportModal";
import { TreeOverviewExportModal } from "./modals/TreeOverviewExportModal";
import { applyOverviewLayout } from "./overview/overviewDom";
import { ExportController, type OverviewSnapshot } from "./export/ExportController";
import { createOverviewSnapshot } from "./export/overviewSnapshot";
import { BlockEditorController } from "./editor/BlockEditorController";
import { EditorAttachments } from "./editor/EditorAttachments";
import { NavigationController } from "./navigation/NavigationController";
export {
  getBlockOutputMenuActions,
  getOutputCardPresentation
} from "./output/outputPresentation";
export type {
  BlockOutputMenuActionId,
  BlockOutputMenuAction,
  OutputCardPresentation
} from "./output/outputPresentation";

interface DragState {
  draggedBlockId: BranchBlockId;
  targetParentId: BranchBlockId | null;
  targetIndex: number;
  columnKey: string;
}

export class ArborView extends FileView {
  private compactLayout = false;
  private touchDockEl: HTMLElement | null = null;
  private readonly touchPoints = new Map<number, TouchPoint>();
  private touchStart: { zoom: number; left: number; top: number; midpoint: TouchPoint; distance: number } | null = null;
  private touchMoved = false;
  private suppressTouchClickUntil = 0;
  private readonly branchTouchPoints = new Map<number, TouchPoint>();
  private branchTouchStart: { zoom: number; distance: number } | null = null;
  private branchTouchPinching = false;
  private touchZoomFrame: number | null = null;
  private pendingTouchZoom: number | null = null;
  navigation = true;

  private readonly history = new BranchHistory();
  private state: LoadedFileState | null = null;
  private readonly editor: BlockEditorController;
  private readonly attachments: EditorAttachments;
  private readonly navigationController: NavigationController;
  private dragState: DragState | null = null;
  private renderFrame: number | null = null;
  private layoutFrame: number | null = null;
  private isPersisting = false;
  private pendingFocusBlockId: BranchBlockId | null = null;
  private pendingScrollBlockId: BranchBlockId | null = null;
  private lastViewportScroll = { left: 0, top: 0 };
  private frameEl: HTMLElement | null = null;
  private breadcrumbsEl: HTMLElement | null = null;
  private breadcrumbExitLayerEl: HTMLElement | null = null;
  private zoomIndicatorEl: HTMLButtonElement | null = null;
  private modeControlsEl: HTMLElement | null = null;
  private outputProfileButtonEl: HTMLButtonElement | null = null;
  private overviewButtonEl: HTMLButtonElement | null = null;
  private markdownButtonEl: HTMLButtonElement | null = null;
  private themeButtonEl: HTMLButtonElement | null = null;
  private viewMenuButtonEl: HTMLButtonElement | null = null;
  private searchOverlayEl: HTMLElement | null = null;
  private searchDialogEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchMetaEl: HTMLElement | null = null;
  private searchClearEl: HTMLButtonElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private loadingOverlayEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private columnsStageEl: HTMLElement | null = null;
  private columnsViewportEl: HTMLElement | null = null;
  private columnsEl: HTMLElement | null = null;
  private previewPaneEl: HTMLElement | null = null;
  private previewMiniMapEl: HTMLElement | null = null;
  private previewContentEl: HTMLElement | null = null;
  private overviewStageEl: HTMLElement | null = null;
  private overviewViewportEl: HTMLElement | null = null;
  private overviewSceneEl: HTMLElement | null = null;
  private overviewSurfaceEl: HTMLElement | null = null;
  private outputStageEl: HTMLElement | null = null;
  private outputSurfaceEl: HTMLElement | null = null;
  private rootEmptyEl: HTMLElement | null = null;
  private renderedPreviewSignature = "";
  private previewSearchQuery = "";
  private isSearchOpen = false;
  private showFullMiniMap = false;
  private shouldFocusSearchInput = false;
  private hoveredBlockId: BranchBlockId | null = null;
  private viewContext: BranchViewContext | null = null;
  private loadingState: LoadingOverlayState | null = null;
  private presentationMode: ArborPresentationMode = "editor";
  private renderedLayoutDirection: ArborSettings["layoutDirection"] = "ltr";
  private shouldSnapViewportAfterDirectionChange = false;
  private shouldCenterOverviewOnNextRender = false;
  private shouldRestoreOverviewKeyboardFocusAfterMutation = false;
  private pendingOverviewViewportPosition: { left: number; top: number } | null = null;
  private overviewRenderVersion = 0;
  private overviewSelectionAnimation: Animation | null = null;
  private outputRenderVersion = 0;

  private get editingSession(): EditingSession | null {
    return this.editor.getSession();
  }
  private readonly exportController = new ExportController({
    getFile: () => this.file,
    getState: () => this.state,
    getSession: () => this.editor.getSession(),
    clearBlurCommitTimer: () => this.clearBlurCommitTimer(),
    commitEditIfNeeded: () => this.commitEditIfNeeded(),
    chooseClean: () => new CleanExportModal(this.app).waitForChoice(),
    chooseTree: () => new TreeOverviewExportModal(this.app).waitForChoice(),
    createCleanCopy: (source, contents) => this.plugin.createCleanExportCopy(source, contents),
    openMarkdown: (file) => this.plugin.openFileInMarkdownView(this.app.workspace.getLeaf("tab"), file),
    createTreeExport: (source, format, contents) => this.plugin.createTreeOverviewExport(source, format, contents),
    snapshot: () => this.createOverviewExportSnapshot(),
    encodePng: (snapshot, quality) => this.encodeOverviewExportPng(snapshot, quality),
    notify: (message) => new Notice(message),
    reportError: (message, error) => {
      console.error(`[Arbor] ${message}`, error);
      new Notice(message);
    }
  });
  private overviewPanState: {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null = null;
  private readonly columnElementMap = new Map<string, HTMLElement>();
  private readonly currentColumnMap = new Map<string, BranchColumnModel>();
  private pendingFocusFrame: number | null = null;
  private horizontalScrollFrame: number | null = null;
  private breadcrumbScrollFrame: number | null = null;
  private zoomPersistTimer: number | null = null;
  private zoomIndicatorTimer: number | null = null;
  private overviewZoomFrame: number | null = null;
  private pendingOverviewZoom: number | null = null;
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
    this.attachments = new EditorAttachments({
      getFilePath: () => this.file?.path ?? "",
      hasSession: () => this.editor.getSession() !== null,
      getAvailablePath: (name, sourcePath) => this.app.fileManager.getAvailablePathForAttachment(name, sourcePath),
      createBinary: (path, data) => this.app.vault.createBinary(path, data),
      generateLink: (file, sourcePath) => this.app.fileManager.generateMarkdownLink(file, sourcePath),
      onInserted: () => this.scheduleColumnAlignment(),
      notify: (message) => new Notice(message),
      reportError: (message, error) => console.error(message, error)
    });
    this.editor = new BlockEditorController({
      getState: () => this.state,
      usesTouchControls: () => this.usesTouchControls,
      getViewportHeight: () => (this.presentationMode === "overview" ? this.overviewViewportEl : this.columnsViewportEl)?.clientHeight ?? window.innerHeight,
      onBegin: (session) => this.onEditorBegin(session),
      onCancel: (session) => this.onEditorCancel(session),
      onUnchanged: (session) => this.onEditorUnchanged(session),
      saveEdit: (session) => this.saveEditorSession(session),
      onInput: () => this.scheduleColumnAlignment(),
      handleSearchShortcut: (event) => this.handleSearchShortcut(event),
      paste: (event, textarea) => this.attachments.handleEditorPaste(event, textarea),
      drop: (event, textarea) => this.attachments.handleEditorDrop(event, textarea)
    });
    this.navigationController = new NavigationController({
      getState: () => this.state,
      getSettings: () => this.plugin.settings,
      getMode: () => this.presentationMode,
      getFilePath: () => this.file?.path ?? ""
    }, { selectBlock: (id, options) => this.selectBlock(id, options) }, {
      beginEditingBlock: (id, origin) => this.beginEditingBlock(id, origin),
      createChild: () => this.createChild(),
      createSiblingAbove: () => this.createSiblingAbove(),
      createSiblingBelow: () => this.createSiblingBelow(),
      createParentLevelBlock: () => this.createParentLevelBlock(),
      createRootBlock: () => this.createRootBlock(),
      deleteSelectedBlock: () => this.deleteSelectedBlock(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      openSearchOverlay: () => this.openSearchOverlay(),
      closeSearchOverlay: () => this.closeSearchOverlay(),
      isSearchOpen: () => this.isSearchOpen,
      setKeyboardSelection: (id) => { if (this.state) this.state.selectedBlockId = id; },
      openBlockMenu: (id, event) => this.buildBlockMenu(id).showAtMouseEvent(event)
    });
    this.allowNoFile = false;
    const doc = this.contentEl.ownerDocument;
    this.registerDomEvent(doc, "visibilitychange", () => {
      if (doc.visibilityState === "hidden" && Platform.isMobile) {
        void this.commitEditIfNeeded();
      }
    });
    const observer = new ResizeObserver(() => this.handleMobileResize());
    observer.observe(this.contentEl);
    this.register(() => observer.disconnect());
    const visualViewport = doc.defaultView?.visualViewport;
    if (visualViewport) {
      const onResize = () => this.handleMobileResize();
      visualViewport.addEventListener("resize", onResize);
      this.register(() => visualViewport.removeEventListener("resize", onResize));
    }
  }

  private get usesTouchControls(): boolean {
    return this.compactLayout || Platform.isMobile;
  }

  private handleMobileResize(): void {
    const compact = useCompactLayout(this.contentEl.clientWidth);
    if (compact !== this.compactLayout) {
      this.compactLayout = compact;
      this.pendingScrollBlockId = this.state?.selectedBlockId ?? null;
      this.render();
    }
    if (!this.usesTouchControls) return;
    this.contentEl.querySelectorAll<HTMLTextAreaElement>("textarea.arbor-editor").forEach((editor) => this.resizeEditor(editor));
    const viewport = this.contentEl.ownerDocument.defaultView?.visualViewport;
    const rect = this.contentEl.getBoundingClientRect();
    let bottom = Math.min(rect.bottom - 8, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0));
    if (Platform.isMobile) {
      this.contentEl.ownerDocument.querySelectorAll<HTMLElement>(".mobile-navbar, .mobile-toolbar").forEach((bar) => {
        const bounds = bar.getBoundingClientRect();
        if (bounds.height > 0 && bounds.width > 0 && bounds.top > rect.top && bounds.top < bottom && bounds.right > rect.left && bounds.left < rect.right && getComputedStyle(bar).visibility !== "hidden") bottom = bounds.top - 8;
      });
    }
    this.contentEl.setCssProps({ "--arbor-mobile-height": `${Math.max(120, bottom - rect.top - 8)}px` });
    if (this.editingSession) {
      if (this.presentationMode === "overview") {
        const card = this.overviewSurfaceEl?.querySelector<HTMLElement>(".arbor-overview-card.is-active");
        if (card) this.revealOverviewSelectedCard(card);
      }
      else this.revealCompactSelection();
    }
  }

  private revealCompactSelection(): void {
    if (!this.compactLayout) return;
    const viewport = this.columnsViewportEl;
    const card = this.columnsEl?.querySelector<HTMLElement>(".arbor-card.is-active");
    if (!viewport || !card) return;
    const bounds = viewport.getBoundingClientRect();
    const target = card.getBoundingClientRect();
    const offset = target.top < bounds.top + 12 || target.height > bounds.height - 24
      ? target.top - bounds.top - 12
      : Math.max(0, target.bottom - bounds.bottom + 12);
    if (Math.abs(offset) > 1) viewport.scrollTop += offset;
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
    const prepared = await this.prepareLoadedFileState(file, this.state?.selectedBlockId ?? null);
    if (!prepared) {
      return;
    }

    this.state = prepared;
    if (this.state.origin === "reconciled") {
      new Notice("The tree was rebuilt from the visible Markdown body to avoid losing plain editor changes.");
    }

    this.resetLoadedUiState(this.state.selectedBlockId);
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
    this.clearOverviewZoomFrame();
    this.clearTouchZoomFrame();
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
    this.editor.reset();
    this.dragState = null;
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.loadingState = null;
    this.presentationMode = "editor";
    this.cleanupOverviewPan();
    this.pendingOverviewViewportPosition = null;
    this.teardownShell();
  }

  async onClose(): Promise<void> {
    this.navigationController.clearNumericNavigation();
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
    this.clearOverviewZoomFrame();
    this.clearTouchZoomFrame();
    this.clearBreadcrumbScrollFrame();
    if (this.pendingFocusFrame !== null) {
      window.cancelAnimationFrame(this.pendingFocusFrame);
      this.pendingFocusFrame = null;
    }
    this.stopHorizontalScrollMotion();
    this.cleanupDragPreview();
    this.cleanupOverviewPan();
    this.overviewSelectionAnimation?.cancel();
    this.overviewSelectionAnimation = null;
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

    const prepared = await this.prepareLoadedFileState(this.file, this.state?.selectedBlockId ?? null);
    if (!prepared) {
      return;
    }

    const directionChanged = this.renderedLayoutDirection !== this.plugin.settings.layoutDirection;
    this.state = prepared;
    this.shouldSnapViewportAfterDirectionChange = directionChanged;
    if (directionChanged && this.presentationMode === "overview") {
      this.shouldCenterOverviewOnNextRender = true;
    }
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    this.render();
  }

  async refreshLayoutDirection(): Promise<void> {
    if (!this.file || !this.state || this.renderedLayoutDirection === this.plugin.settings.layoutDirection) {
      return;
    }

    this.stopHorizontalScrollMotion();
    this.applyViewClasses(this.contentEl);

    if (this.presentationMode === "overview") {
      this.shouldCenterOverviewOnNextRender = true;
      this.render();
      return;
    }

    this.syncBreadcrumbs();
    this.syncViewportEdgeFades();
    window.requestAnimationFrame(() => {
      this.alignColumnsToActivePath();
      const viewport = this.columnsViewportEl;
      const activeCard = this.columnsEl?.querySelector<HTMLElement>(".arbor-card.is-active");
      if (viewport && activeCard) {
        this.scrollCardIntoHorizontalView(activeCard, viewport, 0, true);
      }
    });
  }

  private buildLoadedFileState(
    parsed: ReturnType<typeof parseBranchDocument>,
    loaded: ImportedBranchDocument,
    preferredSelectedBlockId: BranchBlockId | null
  ): LoadedFileState {
    const selectedBlockId = ensureSelectedBlock(loaded.metadata, preferredSelectedBlockId);
    return {
      frontmatter: parsed.frontmatter,
      metadata: loaded.metadata,
      outputState: loaded.outputState,
      outputRaw: loaded.outputRaw,
      outputError: loaded.outputError,
      selectedBlockId,
      staleMetadata: loaded.staleMetadata,
      origin: loaded.origin,
      linearized: linearizeTree(loaded.metadata)
    };
  }

  private resetLoadedUiState(selectedBlockId: BranchBlockId | null): void {
    this.history.clear();
    this.editor.reset();
    this.dragState = null;
    this.previewSearchQuery = "";
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.presentationMode = this.plugin.settings.defaultPresentationMode;
    this.shouldCenterOverviewOnNextRender = this.presentationMode === "overview";
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.pendingFocusBlockId = selectedBlockId;
    this.pendingScrollBlockId = selectedBlockId;
  }

  private async readLoadedFileState(
    file: TFile,
    preferredSelectedBlockId: BranchBlockId | null
  ): Promise<{
    state: LoadedFileState;
    loaded: ImportedBranchDocument;
    parsed: ReturnType<typeof parseBranchDocument>;
  }> {
    const text = await this.app.vault.cachedRead(file);
    const parsed = parseBranchDocument(text);
    const loaded = loadImportedBranchDocument(text);
    return {
      state: this.buildLoadedFileState(parsed, loaded, preferredSelectedBlockId),
      loaded,
      parsed
    };
  }

  private async prepareLoadedFileState(
    file: TFile,
    preferredSelectedBlockId: BranchBlockId | null
  ): Promise<LoadedFileState | null> {
    const initial = await this.readLoadedFileState(file, preferredSelectedBlockId);
    const expectedArborOpen = this.plugin.consumeExplicitArborOpen(file.path);
    const staysInArbor = Boolean(initial.parsed.metadata)
      || (expectedArborOpen && canOpenImportedBranchDocumentInArbor(initial.loaded));
    if (!staysInArbor) {
      await this.openFileInMarkdownView(file);
      return null;
    }

    this.state = initial.state;

    if (!initial.loaded.needsVisibleMarkerMigration) {
      return initial.state;
    }

    const loadingStartedAt = performance.now();
    this.loadingState = {
      title: "Upgrading note structure",
      description: "Rewriting this note to Arbor's precise block format."
    };
    this.ensureShell();
    this.syncLoadingOverlay();
    await this.waitForNextPaint();

    try {
      await this.persistState("Upgrade note structure");
      const remainingLoadingTime = 220 - (performance.now() - loadingStartedAt);
      if (remainingLoadingTime > 0) {
        await this.wait(remainingLoadingTime);
      }
      const migrated = await this.readLoadedFileState(file, initial.state.selectedBlockId);
      this.state = migrated.state;
      this.plugin.rememberManagedNote(file.path);
      return migrated.state;
    } finally {
      this.loadingState = null;
    }
  }

  private waitForNextPaint(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private async openFileInMarkdownView(file: TFile): Promise<void> {
    await this.plugin.openFileInMarkdownView(this.leaf, file);
  }

  private async openCurrentFileInMarkdown(): Promise<void> {
    if (!this.file) {
      return;
    }
    await this.commitEditIfNeeded();
    await this.openFileInMarkdownView(this.file);
  }

  async exportCleanCopy(): Promise<void> {
    await this.exportController.exportCleanCopy();
  }

  async exportTreeOverview(): Promise<void> {
    await this.exportController.exportTreeOverview();
  }

  private createOverviewExportSnapshot(): Promise<OverviewSnapshot> {
    const state = this.state;
    const file = this.file;
    if (!state || !file) {
      throw new Error("Tree Overview export requires a loaded note.");
    }
    const document = this.contentEl.ownerDocument;
    const theme = this.plugin.getEffectiveThemeState();
    const themeValues = resolveArborThemeVariables(theme.activeThemeId, theme.customThemes);
    const themeVariables = Object.fromEntries(
      ARBOR_THEME_VARIABLES.map((name) => [name, themeValues[name] ?? ""])
    );
    const textMuted = document.defaultView?.getComputedStyle(this.contentEl).getPropertyValue("--text-muted").trim() ?? "";
    return createOverviewSnapshot({
      document,
      metadata: state.metadata,
      selectedBlockId: state.selectedBlockId,
      sourcePath: file.path,
      cardWidth: this.plugin.settings.cardWidth,
      direction: this.plugin.settings.layoutDirection,
      snippetLength: this.plugin.settings.previewSnippetLength,
      themeVariables,
      textMuted,
      markdown: { render: (markdown, target, sourcePath) => MarkdownRenderer.render(this.app, markdown, target, sourcePath, this) },
      waitForNextPaint: () => this.waitForNextPaint()
    });
  }

  private async encodeOverviewExportPng(
    snapshot: OverviewSnapshot,
    quality: TreeOverviewExportQuality
  ): Promise<Uint8Array | null> {
    const size = resolveTreeOverviewExportSize(
      snapshot.width,
      snapshot.height,
      quality,
      Platform.isMobile ? MOBILE_TREE_OVERVIEW_EXPORT_LIMITS : undefined
    );
    if (!size) return null;
    const backgroundColor = this.contentEl.ownerDocument.defaultView?.getComputedStyle(this.contentEl).backgroundColor ?? "";
    const png = await toBlob(snapshot.frame, {
      backgroundColor: backgroundColor === "rgba(0, 0, 0, 0)" ? "#1e1e1e" : backgroundColor,
      cacheBust: true,
      height: snapshot.height,
      pixelRatio: size.scale,
      width: snapshot.width
    });
    if (!png) throw new Error("Tree Overview image renderer returned no output.");
    return new Uint8Array(await png.arrayBuffer());
  }

  openTreeOverview(): void {
    void this.commitEditIfNeeded().then(() => {
      this.shouldCenterOverviewOnNextRender = true;
      this.presentationMode = "overview";
      this.render();
    });
  }

  closeTreeOverview(): void {
    void this.commitEditIfNeeded().then(() => {
      this.presentationMode = "editor";
      this.render();
    });
  }

  openOutputPreview(): void {
    this.presentationMode = "output";
    this.render();
  }

  closeOutputPreview(): void {
    this.presentationMode = "editor";
    this.render();
  }

  selectBlock(blockId: BranchBlockId | null, options?: { focus?: boolean; reveal?: boolean }): void {
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
    this.syncTouchDock();

    if (options?.focus) {
      this.pendingFocusBlockId = this.state.selectedBlockId;
    }
    if (selectionChanged) {
      this.stopHorizontalScrollMotion(false);
      this.pendingScrollBlockId = this.state.selectedBlockId;
    }

    if (this.presentationMode === "overview") {
      this.pendingFocusBlockId = null;
      this.pendingScrollBlockId = null;
      this.syncBreadcrumbs();
      this.viewContext = buildViewContext(
        this.state.metadata,
        this.state.selectedBlockId,
        this.state.outputState,
        this.previewSearchQuery,
        this.plugin.settings
      );
      this.syncSearchOverlay(this.viewContext);
      this.syncOverviewSelection(selectionChanged && options?.reveal !== false);
      return;
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
      void this.editor.commitEditingSession();
      return;
    }

    const block = getBlock(this.state.metadata, this.state.selectedBlockId);
    if (!block) {
      return;
    }

    this.editor.prepareCreatedBlock(block, "card");
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
    this.editor.beginEditingBlock(blockId, origin);
  }

  selectParentBlock(): void {
    this.navigationController.selectParentBlock();
  }

  selectPreviousSiblingBlock(): void {
    this.navigationController.selectPreviousSiblingBlock();
  }

  selectNextSiblingBlock(): void {
    this.navigationController.selectNextSiblingBlock();
  }

  selectFirstChildBlock(): void {
    this.navigationController.selectFirstChildBlock();
  }

  selectPreferredChildBlock(): void {
    this.navigationController.selectPreferredChildBlock();
  }

  selectFirstSiblingBlock(): void {
    this.navigationController.selectFirstSiblingBlock();
  }

  selectLastSiblingBlock(): void {
    this.navigationController.selectLastSiblingBlock();
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
    this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
  }

  async rebuildLinearMarkdownFromTree(): Promise<void> {
    await this.commitEditIfNeeded();
      await this.persistState("Rebuild linear Markdown from tree");
  }

  async rebuildTreeFromMetadata(): Promise<void> {
    if (!this.file || !this.state) {
      return;
    }

    await this.commitEditIfNeeded();

    const text = await this.app.vault.cachedRead(this.file);
    const parsed = parseBranchDocument(text);
    if (!parsed.metadata && !this.state.staleMetadata) {
      new Notice("No stored metadata was found in this note.");
      return;
    }

    const restored = cloneMetadata(parsed.metadata ?? this.state.staleMetadata ?? createEmptyTree());
    const beforeMetadata = cloneMetadata(this.state.metadata);
    this.history.push(
      "Rebuild tree from metadata",
      this.state.metadata,
      this.state.outputState,
      this.state.selectedBlockId
    );
    this.state.metadata = restored;
    this.state.outputState = reconcileProfilesAfterTreeChange(
      beforeMetadata,
      restored,
      this.state.outputState
    );
    this.state.selectedBlockId = ensureSelectedBlock(restored, this.state.selectedBlockId);
    this.state.linearized = linearizeTree(restored);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.editor.reset();
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
    this.state.outputState = previous.outputState;
    this.state.selectedBlockId = ensureSelectedBlock(previous.metadata, previous.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.editor.reset();
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
    this.state.outputState = next.outputState;
    this.state.selectedBlockId = ensureSelectedBlock(next.metadata, next.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.editor.reset();
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    await this.persistState("Redo");
    this.render();
  }

  render(): void {
    this.overviewRenderVersion += 1;
    this.outputRenderVersion += 1;
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
      contentEl.createDiv({ cls: "arbor-empty", text: "Open a Markdown note to use this view." });
      return;
    }

    this.ensureShell();
    this.syncOutputProfileButton();
    this.syncOverviewModeButton();
    this.syncTouchDock();
    this.syncViewportEdgeFades();
    this.syncBreadcrumbs();
    this.viewContext = buildViewContext(
      this.state.metadata,
      this.state.selectedBlockId,
      this.state.outputState,
      this.previewSearchQuery,
      this.plugin.settings
    );
    this.syncSearchOverlay(this.viewContext);
    this.syncBanner();
    this.syncLoadingOverlay();
    if (this.presentationMode === "output") {
      this.overviewStageEl?.setCssStyles({ display: "none" });
      this.columnsStageEl?.setCssStyles({ display: "none" });
      this.previewPaneEl?.setCssStyles({ display: "none" });
      this.outputStageEl?.setCssStyles({ display: "" });
      await this.syncOutputPreview();
      return;
    }

    this.outputStageEl?.setCssStyles({ display: "none" });
    if (this.presentationMode === "overview") {
      this.columnsStageEl?.setCssStyles({ display: "none" });
      this.previewPaneEl?.setCssStyles({ display: "none" });
      await this.syncTreeOverview();
      return;
    }

    this.overviewStageEl?.setCssStyles({ display: "none" });
    this.columnsStageEl?.setCssStyles({ display: "" });
    this.previewPaneEl?.setCssStyles({ display: "" });
    const allColumns = buildColumnModels(this.state.metadata, this.state.selectedBlockId, this.plugin.settings.previewSnippetLength);
    const columns = this.compactLayout ? compactColumns(allColumns, this.state.selectedBlockId) : allColumns;
    const preservedSceneWidth = this.armSceneWidthForPendingScroll(columns.length);
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
      this.breadcrumbExitLayerEl &&
      this.modeControlsEl &&
      this.outputProfileButtonEl &&
      this.bannerEl &&
      this.loadingOverlayEl &&
      this.outputStageEl
    ) {
      return;
    }

    const state = this.state;
    if (!state) {
      return;
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("arbor-view");
    this.applyViewClasses(contentEl);

    this.frameEl = contentEl.createDiv({ cls: "arbor-frame" });
    this.breadcrumbsEl = this.frameEl.createDiv({ cls: "arbor-breadcrumbs" });
    this.breadcrumbExitLayerEl = this.frameEl.createDiv({ cls: "arbor-breadcrumb-exit-layer" });
    this.zoomIndicatorEl = this.frameEl.createEl("button", {
      cls: "arbor-zoom-indicator",
      attr: {
        type: "button",
        "aria-label": "Reset zoom to 100%"
      }
    });
    this.zoomIndicatorEl.addEventListener("click", () => this.resetViewFromZoomIndicator());
    this.zoomIndicatorEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.markdownButtonEl = this.frameEl.createEl("button", {
      cls: "arbor-markdown-button",
      attr: { type: "button", "aria-label": "Open in Markdown" }
    });
    setIcon(this.markdownButtonEl, "file-text");
    this.markdownButtonEl.addEventListener("click", () => void this.openCurrentFileInMarkdown());
    this.markdownButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.themeButtonEl = this.frameEl.createEl("button", {
      cls: "arbor-theme-button",
      attr: { type: "button", "aria-label": "Open theme studio" }
    });
    setIcon(this.themeButtonEl, "palette");
    this.themeButtonEl.addEventListener("click", () => this.plugin.openThemeStudio());
    this.themeButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.viewMenuButtonEl = this.frameEl.createEl("button", {
      cls: "arbor-view-menu-button",
      attr: {
        type: "button",
        "aria-label": "Open view menu"
      }
    });
    setIcon(this.viewMenuButtonEl, "sliders-horizontal");
    this.viewMenuButtonEl.addEventListener("click", (event) => this.openViewMenu(event));
    this.viewMenuButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.bannerEl = this.frameEl.createDiv({ cls: "arbor-banner" });
    this.loadingOverlayEl = this.frameEl.createDiv({ cls: "arbor-loading-overlay" });
    this.bodyEl = this.frameEl.createDiv({ cls: "arbor-body" });
    this.modeControlsEl = this.bodyEl.createDiv({ cls: "arbor-mode-controls" });
    this.outputProfileButtonEl = createOutputProfileButton(this.modeControlsEl, state.outputState);
    this.outputProfileButtonEl.addEventListener("click", (event) => this.openOutputProfileMenu(event));
    this.outputProfileButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    this.overviewButtonEl = this.modeControlsEl.createEl("button", {
      cls: "arbor-overview-button",
      attr: { type: "button", "aria-label": "Open tree overview" }
    });
    setIcon(this.overviewButtonEl, "map");
    this.overviewButtonEl.addEventListener("click", () => {
      if (this.presentationMode === "overview") {
        this.closeTreeOverview();
        return;
      }
      this.openTreeOverview();
    });
    this.overviewButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
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
    this.bindBranchTouch(this.columnsViewportEl);
    this.columnsEl = this.columnsViewportEl.createDiv({ cls: "arbor-columns" });
    const viewportFadesEl = this.columnsStageEl.createDiv({ cls: "arbor-viewport-fades" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-top" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-right" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-bottom" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-left" });
    this.outputStageEl = this.bodyEl.createDiv({ cls: "arbor-output-preview-stage" });
    this.outputStageEl.setCssStyles({ display: "none" });
    this.syncZoomIndicator();
  }

  private syncTouchDock(): void {
    if (!this.frameEl || !this.state) return;
    this.contentEl.toggleClass("is-compact", this.compactLayout);
    this.contentEl.toggleClass("has-touch-controls", this.usesTouchControls);
    const controlsHost = this.usesTouchControls ? this.frameEl : this.bodyEl;
    if (this.modeControlsEl && this.modeControlsEl.parentElement !== controlsHost) {
      controlsHost?.appendChild(this.modeControlsEl);
    }
    if (this.presentationMode === "output") {
      this.touchDockEl?.remove();
      this.touchDockEl = null;
      return;
    }
    if (!this.usesTouchControls) {
      this.touchDockEl?.remove();
      this.touchDockEl = null;
      return;
    }
    const dock = this.touchDockEl ?? this.frameEl.createDiv({ cls: "arbor-touch-dock", attr: { role: "toolbar", "aria-label": "Block actions" } });
    this.touchDockEl = dock;
    this.contentEl.toggleClass("is-touch-editing", Boolean(this.editingSession));
    window.requestAnimationFrame(() => this.handleMobileResize());
    dock.empty();
    const button = (label: string, icon: string, action: () => void, disabled = false, text = false) => {
      const el = dock.createEl("button", { cls: "arbor-touch-action", attr: { type: "button", "aria-label": label } });
      setIcon(el, icon);
      if (text) el.createSpan({ text: label });
      el.disabled = disabled;
      el.addEventListener("pointerdown", (event) => { event.preventDefault(); this.clearBlurCommitTimer(); });
      el.addEventListener("click", action);
      return el;
    };
    if (this.editingSession) {
      dock.addClass("is-editing");
      button("Cancel", "x", () => this.cancelEditingSession(), false, true);
      button("Save", "check", () => void this.commitEditingSession(), false, true).addClass("mod-cta");
      return;
    }
    dock.removeClass("is-editing");
    const id = this.state.selectedBlockId;
    const tree = this.state.metadata;
    button("Parent block", getParentArrowIcon(this.plugin.settings.layoutDirection), () => this.selectParentBlock(), !getParentBlock(tree, id));
    button("Previous block", "chevron-up", () => this.selectPreviousSiblingBlock(), !getPreviousSibling(tree, id));
    button("Next block", "chevron-down", () => this.selectNextSiblingBlock(), !getNextSibling(tree, id));
    button("Child block", getChildArrowIcon(this.plugin.settings.layoutDirection), () => this.selectPreferredChildBlock(), !getPreferredChildBlock(tree, id));
    button("Edit block", "pencil", () => { if (id) this.beginEditingBlock(id, this.presentationMode === "overview" ? "overview" : "card"); }, !id);
    const add = button("Add block", "plus", () => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(id ? "Create child" : "Create root block").setIcon("git-branch").onClick(() => void (id ? this.createChild() : this.createRootBlock())));
      if (id) menu.addItem((item) => item.setTitle("Create sibling below").setIcon("plus").onClick(() => void this.createSiblingBelow()));
      const rect = add.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.top }, add.ownerDocument);
    });
    button("Block menu", "ellipsis", () => this.openActiveBlockMenu(), !id);
  }

  private teardownShell(): void {
    this.cleanupDragPreview();
    this.cleanupViewportPan();
    this.cleanupOverviewPan();
    this.overviewSelectionAnimation?.cancel();
    this.overviewSelectionAnimation = null;
    this.contentEl.empty();
    this.frameEl = null;
    this.touchDockEl = null;
    this.touchPoints.clear();
    this.touchStart = null;
    this.branchTouchPoints.clear();
    this.branchTouchStart = null;
    this.branchTouchPinching = false;
    this.breadcrumbsEl = null;
    this.breadcrumbExitLayerEl = null;
    this.zoomIndicatorEl = null;
    this.modeControlsEl = null;
    this.outputProfileButtonEl = null;
    this.markdownButtonEl = null;
    this.themeButtonEl = null;
    this.overviewButtonEl = null;
    this.viewMenuButtonEl = null;
    this.searchOverlayEl = null;
    this.searchDialogEl = null;
    this.searchInputEl = null;
    this.searchMetaEl = null;
    this.searchClearEl = null;
    this.bannerEl = null;
    this.loadingOverlayEl = null;
    this.bodyEl = null;
    this.columnsStageEl = null;
    this.columnsViewportEl = null;
    this.columnsEl = null;
    this.previewPaneEl = null;
    this.previewMiniMapEl = null;
    this.previewContentEl = null;
    this.overviewStageEl = null;
    this.overviewViewportEl = null;
    this.overviewSceneEl = null;
    this.overviewSurfaceEl = null;
    this.outputStageEl = null;
    this.outputSurfaceEl = null;
    this.rootEmptyEl = null;
    this.renderedPreviewSignature = "";
    this.columnElementMap.clear();
    this.currentColumnMap.clear();
  }

  private syncBreadcrumbs(): void {
    if (!this.breadcrumbsEl || !this.state) {
      return;
    }

    const hideBreadcrumbContent =
      !this.plugin.settings.showBreadcrumb || this.presentationMode === "output";
    this.breadcrumbsEl.toggleClass("is-reserved-hidden", hideBreadcrumbContent);
    this.breadcrumbsEl.setAttr("aria-hidden", hideBreadcrumbContent ? "true" : "false");
    if (hideBreadcrumbContent) {
      return;
    }

    const path = getActivePath(this.state.metadata, this.state.selectedBlockId);
    const previousPathIds = Array.from(
      this.breadcrumbsEl.querySelectorAll<HTMLElement>("[data-block-id]")
    ).map((element) => element.dataset.blockId ?? "");
    const enteringBlockIds = getEnteringBreadcrumbIds(previousPathIds, path.map((block) => block.id));
    this.animateRemovedBreadcrumbs(path);
    this.breadcrumbsEl.empty();
    if (path.length === 0) {
      this.breadcrumbsEl.createSpan({ cls: "arbor-breadcrumb-empty", text: this.file?.basename ?? "Arbor" });
      return;
    }

    this.renderBreadcrumbItems(this.breadcrumbsEl, path, enteringBlockIds);
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

  private renderBreadcrumbItems(
    container: HTMLElement,
    path: BranchBlock[],
    enteringBlockIds: ReadonlySet<BranchBlockId> = new Set<BranchBlockId>()
  ): void {
    const visualPath = getVisualBreadcrumbOrder(path, this.plugin.settings.layoutDirection);
    visualPath.forEach((block, index) => {
      const button = container.createEl("button", {
        cls: block.id === this.state?.selectedBlockId ? "is-active" : "",
        text: this.getBreadcrumbLabel(block.content),
        attr: { "data-block-id": block.id }
      });
      button.toggleClass("is-entering", enteringBlockIds.has(block.id));
      button.setCssProps({ "--bw-crumb-index": String(index) });
      button.addEventListener("click", () => this.selectBlock(block.id, { focus: true }));

      if (this.plugin.settings.showBreadcrumbFlow && index < visualPath.length - 1) {
        const connector = container.createSpan({ cls: "arbor-breadcrumb-connector" });
        connector.setCssProps({ "--bw-crumb-index": String(index + 0.45) });
      }
    });
  }

  private animateRemovedBreadcrumbs(nextPath: BranchBlock[]): void {
    const breadcrumbsEl = this.breadcrumbsEl;
    const exitLayerEl = this.breadcrumbExitLayerEl;
    const frameEl = this.frameEl;
    if (!breadcrumbsEl || !exitLayerEl || !frameEl) {
      return;
    }

    exitLayerEl.empty();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const nextPathIds = new Set(nextPath.map((block) => block.id));
    const frameRect = frameEl.getBoundingClientRect();
    breadcrumbsEl.querySelectorAll<HTMLButtonElement>("button[data-block-id]").forEach((button) => {
      if (nextPathIds.has(button.dataset.blockId ?? "")) {
        return;
      }

      const buttonRect = button.getBoundingClientRect();
      const exitButton = exitLayerEl.createEl("button", {
        cls: "arbor-breadcrumb-exiting",
        text: button.textContent ?? ""
      });
      exitButton.toggleClass("is-active", button.hasClass("is-active"));
      exitButton.setCssProps({
        left: `${buttonRect.left - frameRect.left}px`,
        top: `${buttonRect.top - frameRect.top}px`,
        width: `${buttonRect.width}px`,
        height: `${buttonRect.height}px`
      });
      exitButton.addEventListener("animationend", () => exitButton.remove(), { once: true });
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
      const { left: leftInset, right: rightInset } = getBreadcrumbScrollInsets(this.plugin.settings.layoutDirection);
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
    this.bannerEl.setCssStyles({ display: showBanner ? "" : "none" });
    if (showBanner) {
      this.bannerEl.empty();
      this.bannerEl.createSpan({
        text: "This note changed in plain Markdown mode. The branch tree was rebuilt from the visible note body."
      });
    }
  }

  private syncLoadingOverlay(): void {
    if (!this.loadingOverlayEl) {
      return;
    }

    const activeState = this.loadingState;
    this.loadingOverlayEl.empty();
    this.loadingOverlayEl.setCssStyles({ display: activeState ? "flex" : "none" });
    if (!activeState) {
      return;
    }

    const panel = this.loadingOverlayEl.createDiv({ cls: "arbor-loading-overlay-panel" });
    panel.createEl("h2", {
      cls: "arbor-loading-overlay-title",
      text: activeState.title
    });
    panel.createEl("p", {
      cls: "arbor-loading-overlay-description",
      text: activeState.description
    });
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
          "aria-label": "Clear search"
        }
      });
      this.searchClearEl.addEventListener("click", () => {
        this.previewSearchQuery = "";
        this.render();
        this.searchInputEl?.focus();
      });
      const go = footerEl.createEl("button", { text: "Go to match", attr: { type: "button" } });
      go.addEventListener("click", () => {
        const match = this.viewContext?.overviewNodes.find((node) => node.isSearchMatch);
        if (match) {
          this.selectBlock(match.id, { focus: true });
          this.closeSearchOverlay();
        }
      });
      const close = footerEl.createEl("button", { text: "Close", attr: { type: "button", "aria-label": "Close search" } });
      close.addEventListener("click", () => this.closeSearchOverlay());
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
      columnEl.dataset.columnDepth = String(index);

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
      cardsEl.setCssProps({ "--arbor-card-list-offset-y": "0px" });
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
            item.setTitle("Create child block").setIcon(getChildArrowIcon(this.plugin.settings.layoutDirection)).onClick(() => void this.createChild())
          );
          menu.showAtMouseEvent(event);
        });
      }
      return;
    }

    const existingChildren = new Map<string, HTMLElement>();
    Array.from(cardsEl.children).forEach((child) => {
      if (child.instanceOf(HTMLElement) && child.dataset.nodeKey) {
        existingChildren.set(child.dataset.nodeKey, child);
      }
    });

    const desiredNodes: HTMLElement[] = [];
    for (let index = 0; index < column.blocks.length; index += 1) {
      if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === index) {
        desiredNodes.push(this.ensureIndicatorNode(cardsEl, existingChildren, `indicator-${column.key}-${index}`));
      }

      const block = column.blocks[index];
      const card = this.ensureCardNode(cardsEl, existingChildren, block.id);
      await this.syncCardNode(card, block, column, index, context);
      desiredNodes.push(card);
    }

    if (this.dragState && this.dragState.columnKey === column.key && this.dragState.targetIndex === column.blocks.length) {
      desiredNodes.push(this.ensureIndicatorNode(cardsEl, existingChildren, `indicator-${column.key}-${column.blocks.length}`));
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

  private ensureIndicatorNode(cardsEl: HTMLElement, existingChildren: Map<string, HTMLElement>, key: string): HTMLElement {
    const existing = existingChildren.get(key);
    if (existing) {
      existing.className = "arbor-drop-indicator";
      existing.dataset.nodeKey = key;
      return existing;
    }

    const indicator = cardsEl.createDiv({ cls: "arbor-drop-indicator" });
    indicator.dataset.nodeKey = key;
    return indicator;
  }

  private ensureCardNode(cardsEl: HTMLElement, existingChildren: Map<string, HTMLElement>, blockId: BranchBlockId): HTMLElement {
    const key = `card-${blockId}`;
    const existing = existingChildren.get(key);
    if (existing) {
      existing.dataset.nodeKey = key;
      return existing;
    }

    const card = cardsEl.createDiv({ cls: "arbor-card" });
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
    const isEditingCard = this.editingSession?.blockId === block.id && this.editingSession.origin === "card";
    card.draggable = canDragCard(this.plugin.settings.dragAndDrop && !this.usesTouchControls, isEditingCard);
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

    if (isEditingCard) {
      card.addClass("is-editing");
      this.syncEditorNode(card, block);
      this.syncOutputCardPresentation(card, block.id, context);
      return;
    }

    await this.syncCardContentNode(card, block);
    if (context !== this.viewContext) {
      return;
    }
    this.syncOutputCardPresentation(card, block.id, context);
  }

  private wireEditorElement(editor: HTMLTextAreaElement, block: BranchBlock, origin: EditingOrigin): void {
    this.editor.wireEditorElement(editor, block, origin);
  }

  private syncEditorNode(card: HTMLElement, block: BranchBlock): void {
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
      const editorEl = editor;
      window.requestAnimationFrame(() => {
        editorEl.focus({ preventScroll: true });
        editorEl.setSelectionRange(editorEl.value.length, editorEl.value.length);
        this.resizeEditor(editorEl);
        if (this.editingSession) {
          this.editor.consumeAutofocus(this.editingSession);
        }
      });
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

    if (content) {
      const isCompactPreview = !card.hasClass("is-active") && !card.hasClass("is-editing");
      card.toggleClass(
        "has-truncated-content",
        isCompactPreview && hasVerticalOverflow(content.scrollHeight, content.clientHeight)
      );
    }
    card.dataset.renderMode = "content";
  }

  private async syncTreeOverview(): Promise<void> {
    if (!this.bodyEl || !this.state) {
      return;
    }

    if (!this.overviewStageEl || !this.overviewViewportEl || !this.overviewSceneEl || !this.overviewSurfaceEl) {
      this.overviewStageEl = this.bodyEl.createDiv({ cls: "arbor-overview-stage" });
      this.overviewViewportEl = this.overviewStageEl.createDiv({ cls: "arbor-overview-viewport" });
      this.overviewViewportEl.tabIndex = 0;
      this.overviewSceneEl = this.overviewViewportEl.createDiv({ cls: "arbor-overview-scene" });
      this.overviewSurfaceEl = this.overviewSceneEl.createDiv({ cls: "arbor-overview-surface" });
      this.overviewViewportEl.addEventListener("pointerdown", (event) => this.handleOverviewPointerDown(event));
      this.overviewViewportEl.addEventListener("pointermove", (event) => this.handleOverviewPointerMove(event));
      this.overviewViewportEl.addEventListener("pointerup", (event) => this.handleOverviewPointerUp(event));
      this.overviewViewportEl.addEventListener("pointercancel", (event) => this.handleOverviewPointerUp(event));
      this.overviewViewportEl.addEventListener("lostpointercapture", () => this.cleanupOverviewPan());
      this.overviewViewportEl.addEventListener("wheel", (event) => this.handleOverviewWheel(event), { passive: false });
      this.overviewViewportEl.addEventListener("keydown", (event) => this.handleOverviewKeyDown(event));
      this.bindOverviewTouch(this.overviewViewportEl);
    }

    const stage = this.overviewStageEl;
    const viewport = this.overviewViewportEl;
    const scene = this.overviewSceneEl;
    // Markdown rendering yields before layout measurement. If a newer render starts
    // while that work is pending, discard its hidden staging surface immediately so
    // repeated settings changes cannot leave duplicate card trees in the scene.
    scene.querySelectorAll<HTMLElement>(".arbor-overview-surface.is-staging").forEach((staleSurface) => staleSurface.remove());
    const previousSurface = this.overviewSurfaceEl;
    const surface = scene.createDiv({ cls: "arbor-overview-surface is-staging" });
    const overviewRenderVersion = this.overviewRenderVersion;
    stage.setCssStyles({ display: "" });
    const zoom = this.plugin.settings.zoomLevel;

    const initialLayout = buildOverviewLayout(this.state.metadata, {
      cardWidth: this.plugin.settings.cardWidth,
      direction: this.plugin.settings.layoutDirection
    });
    const selectedBlockId = this.state.selectedBlockId;
    const activePathIds = new Set(getActivePath(this.state.metadata, selectedBlockId).map((block) => block.id));
    const cardsById = new Map<BranchBlockId, HTMLElement>();
    const measuredHeights = new Map<BranchBlockId, number>();

    for (const node of initialLayout.nodes) {
      const block = getBlock(this.state.metadata, node.id);
      if (!block) {
        continue;
      }
      const card = surface.createDiv({ cls: "arbor-overview-card" });
      card.dataset.blockId = node.id;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.addClass("is-measuring");
      card.setCssProps({ "--arbor-overview-card-width": `${node.width}px` });
      card.toggleClass("is-active", node.id === selectedBlockId);
      card.toggleClass("is-on-path", node.id !== selectedBlockId && activePathIds.has(node.id));
      card.toggleClass("is-zoomed-out", zoom < 0.78);
      const isEditingCard = this.editingSession?.blockId === block.id && this.editingSession.origin === "overview";
      if (isEditingCard) {
        card.addClass("is-editing");
        const editor = card.createEl("textarea", { cls: "arbor-editor arbor-overview-editor-input" });
        this.wireEditorElement(editor, block, "overview");
        editor.value = this.editingSession.value;
        this.resizeEditor(editor);
        if (this.editingSession?.autofocus) {
          window.requestAnimationFrame(() => {
            editor.focus({ preventScroll: true });
            editor.setSelectionRange(editor.value.length, editor.value.length);
            this.resizeEditor(editor);
            if (this.editingSession) {
              this.editor.consumeAutofocus(this.editingSession);
            }
          });
        }
      } else {
        const content = card.createDiv({ cls: "arbor-overview-card-content markdown-rendered" });
        await MarkdownRenderer.render(this.app, block.content, content, this.file?.path ?? "", this);
        if (content.innerText.trim().length === 0) {
          content.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
        }
        content.querySelectorAll("img").forEach((image) => {
          image.addEventListener("load", () => this.render(), { once: true });
        });
      }
      this.syncOutputCardPresentation(card, block.id, this.viewContext);
      card.addEventListener("pointerdown", (event) => event.stopPropagation());
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("a, button, input, textarea")) {
          return;
        }
        this.selectBlock(node.id, { focus: false, reveal: false });
      });
      card.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        this.beginEditingBlock(node.id, "overview");
      });
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectBlock(node.id, { focus: false });
        this.buildBlockMenu(node.id).showAtMouseEvent(event);
      });
      card.addEventListener("mouseenter", () => this.setHoveredBlock(node.id));
      card.addEventListener("mouseleave", () => this.setHoveredBlock(null));
      cardsById.set(node.id, card);
    }

    await this.waitForNextPaint();
    if (overviewRenderVersion !== this.overviewRenderVersion) {
      surface.remove();
      return;
    }
    cardsById.forEach((card, blockId) => {
      measuredHeights.set(blockId, card.scrollHeight);
      card.removeClass("is-measuring");
    });

    const layout = buildOverviewLayout(this.state.metadata, {
      cardWidth: this.plugin.settings.cardWidth,
      cardHeights: measuredHeights,
      direction: this.plugin.settings.layoutDirection
    });
    applyOverviewLayout(scene, surface, cardsById, layout, zoom, this.plugin.settings.layoutDirection);
    previousSurface.remove();
    surface.removeClass("is-staging");
    this.overviewSurfaceEl = surface;

    viewport.toggleClass("is-zoomed-out", zoom < 0.78);
    this.restoreOverviewViewportPosition();
    if (this.shouldCenterOverviewOnNextRender) {
      this.shouldCenterOverviewOnNextRender = false;
      window.requestAnimationFrame(() => this.centerOverviewOnSelectedBlock());
    }
    this.restoreOverviewKeyboardFocusAfterMutation();
    this.syncTouchDock();
  }

  private openOverviewEditorInPlace(block: BranchBlock): boolean {
    const card = this.overviewSurfaceEl?.querySelector<HTMLElement>(`.arbor-overview-card[data-block-id="${block.id}"]`);
    const session = this.editingSession;
    if (!card || !session || session.blockId !== block.id || session.origin !== "overview") {
      return false;
    }

    card.empty();
    card.addClass("is-editing");
    const editor = card.createEl("textarea", { cls: "arbor-editor arbor-overview-editor-input" });
    this.wireEditorElement(editor, block, "overview");
    editor.value = session.value;
    this.resizeEditor(editor);
    this.syncOutputCardPresentation(card, block.id, this.viewContext);
    window.requestAnimationFrame(() => {
      if (this.editingSession !== session) {
        return;
      }
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(editor.value.length, editor.value.length);
      this.resizeEditor(editor);
      this.revealOverviewSelectedCard(card);
      this.editor.consumeAutofocus(session);
    });
    return true;
  }

  private async restoreOverviewCardContentInPlace(blockId: BranchBlockId): Promise<void> {
    const card = this.overviewSurfaceEl?.querySelector<HTMLElement>(`.arbor-overview-card[data-block-id="${blockId}"]`);
    const block = this.state ? getBlock(this.state.metadata, blockId) : null;
    if (!card || !block) {
      return;
    }

    card.empty();
    card.removeClass("is-editing");
    const content = card.createDiv({ cls: "arbor-overview-card-content markdown-rendered" });
    await MarkdownRenderer.render(this.app, block.content, content, this.file?.path ?? "", this);
    if (content.innerText.trim().length === 0) {
      content.setText(extractSnippet(block.content, this.plugin.settings.previewSnippetLength));
    }
    content.querySelectorAll("img").forEach((image) => {
      image.addEventListener("load", () => this.render(), { once: true });
    });
    this.syncOutputCardPresentation(card, block.id, this.viewContext);
    card.focus({ preventScroll: true });
  }

  private handleOverviewPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const viewport = this.overviewViewportEl;
    if (!viewport || event.button !== 0 || event.target instanceof HTMLButtonElement) {
      return;
    }
    this.overviewPanState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.addClass("is-panning");
  }

  private handleOverviewPointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const viewport = this.overviewViewportEl;
    const panState = this.overviewPanState;
    if (!viewport || !panState || panState.pointerId !== event.pointerId) {
      return;
    }
    viewport.scrollLeft = panState.startScrollLeft - (event.clientX - panState.startClientX);
    viewport.scrollTop = panState.startScrollTop - (event.clientY - panState.startClientY);
  }

  private handleOverviewPointerUp(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    if (this.overviewPanState?.pointerId === event.pointerId) {
      this.cleanupOverviewPan();
    }
  }

  private handleOverviewWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey) || !this.plugin.settings.enableCtrlWheelZoom) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
    this.pendingOverviewZoom = (this.pendingOverviewZoom ?? this.plugin.settings.zoomLevel) * factor;
    if (this.overviewZoomFrame !== null) {
      return;
    }
    this.overviewZoomFrame = window.requestAnimationFrame(() => {
      this.overviewZoomFrame = null;
      const nextZoom = this.pendingOverviewZoom;
      this.pendingOverviewZoom = null;
      if (nextZoom === null) {
        return;
      }
      this.updateZoomLevel(nextZoom);
      this.syncOverviewZoom();
    });
  }

  private bindOverviewTouch(viewport: HTMLElement): void {
    const geometry = () => {
      const points = Array.from(this.touchPoints.values());
      const a = points[0];
      const b = points[1] ?? a;
      const rect = viewport.getBoundingClientRect();
      return { midpoint: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const rebase = () => {
      this.touchStart = this.touchPoints.size ? {
        zoom: this.plugin.settings.zoomLevel,
        left: viewport.scrollLeft - (this.overviewSceneEl?.offsetLeft ?? 0),
        top: viewport.scrollTop - (this.overviewSceneEl?.offsetTop ?? 0),
        ...geometry()
      } : null;
    };
    viewport.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || this.editingSession || (event.target as HTMLElement)?.closest("textarea, input, button, a, [contenteditable='true']")) return;
      if (!this.touchPoints.size) this.touchMoved = false;
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      rebase();
      if (this.touchPoints.size > 1) this.touchMoved = true;
    }, { capture: true });
    viewport.addEventListener("pointermove", (event) => {
      if (!this.touchPoints.has(event.pointerId) || !this.touchStart) return;
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const { midpoint, distance } = geometry();
      const dx = midpoint.x - this.touchStart.midpoint.x;
      const dy = midpoint.y - this.touchStart.midpoint.y;
      if (!this.touchMoved && Math.hypot(dx, dy) < 8) return;
      this.touchMoved = true;
      this.suppressTouchClickUntil = Date.now() + 500;
      viewport.setPointerCapture(event.pointerId);
      viewport.addClass("is-panning");
      event.preventDefault();
      if (this.touchPoints.size > 1) {
        const next = pinchViewport(this.touchStart, midpoint, distance);
        this.scheduleTouchZoom(next.zoom);
        viewport.scrollLeft = next.left + (this.overviewSceneEl?.offsetLeft ?? 0);
        viewport.scrollTop = next.top + (this.overviewSceneEl?.offsetTop ?? 0);
      } else {
        viewport.scrollLeft = this.touchStart.left + (this.overviewSceneEl?.offsetLeft ?? 0) - dx;
        viewport.scrollTop = this.touchStart.top + (this.overviewSceneEl?.offsetTop ?? 0) - dy;
      }
    }, { capture: true, passive: false });
    const end = (event: PointerEvent) => {
      if (event.type === "lostpointercapture" && event.target !== viewport) return;
      if (!this.touchPoints.delete(event.pointerId)) return;
      if (this.touchMoved) this.suppressTouchClickUntil = Date.now() + 500;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (!this.touchPoints.size) viewport.removeClass("is-panning");
      rebase();
    };
    viewport.addEventListener("pointerup", end, true);
    viewport.addEventListener("pointercancel", end, true);
    viewport.addEventListener("lostpointercapture", end, true);
    for (const type of ["click", "dblclick", "contextmenu"]) {
      viewport.addEventListener(type, (event) => {
        if (Date.now() < this.suppressTouchClickUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  }

  private bindBranchTouch(viewport: HTMLElement): void {
    const distance = () => {
      const [a, b] = Array.from(this.branchTouchPoints.values());
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const rebase = () => {
      this.branchTouchStart = this.branchTouchPoints.size > 1
        ? { zoom: this.plugin.settings.zoomLevel, distance: distance() }
        : null;
    };
    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("textarea, input, button, a, [contenteditable='true']"));

    viewport.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || !this.usesTouchControls || this.editingSession || isInteractiveTarget(event.target)) {
        return;
      }
      this.branchTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      rebase();
    }, { capture: true });
    viewport.addEventListener("pointermove", (event) => {
      if (!this.branchTouchPoints.has(event.pointerId) || !this.branchTouchStart || this.branchTouchPoints.size < 2) {
        return;
      }
      this.branchTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const nextZoom = resolvePinchZoom(this.branchTouchStart.zoom, this.branchTouchStart.distance, distance());
      this.suppressTouchClickUntil = Date.now() + 500;
      this.branchTouchPinching = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.addClass("is-touch-pinching");
      event.preventDefault();
      this.scheduleTouchZoom(nextZoom);
    }, { capture: true, passive: false });
    const end = (event: PointerEvent) => {
      if (!this.branchTouchPoints.delete(event.pointerId)) {
        return;
      }
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      if (this.branchTouchPoints.size < 2) {
        viewport.removeClass("is-touch-pinching");
        if (this.branchTouchPinching) {
          this.branchTouchPinching = false;
          window.requestAnimationFrame(() => this.revealCompactSelection());
        }
      }
      rebase();
    };
    viewport.addEventListener("pointerup", end, true);
    viewport.addEventListener("pointercancel", end, true);
    viewport.addEventListener("lostpointercapture", end, true);
    for (const type of ["click", "dblclick", "contextmenu"]) {
      viewport.addEventListener(type, (event) => {
        if (Date.now() < this.suppressTouchClickUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  }

  private handleOverviewKeyDown(event: KeyboardEvent): void {
    this.navigationController.handleOverviewKeyDown(event);
  }

  private syncOverviewZoom(): void {
    const scene = this.overviewSceneEl;
    if (!scene) {
      return;
    }
    const width = Number(scene.dataset.overviewWidth);
    const height = Number(scene.dataset.overviewHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }
    const zoom = this.plugin.settings.zoomLevel;
    scene.setCssProps({
      "--arbor-overview-zoom": String(zoom),
      "--arbor-overview-width": `${width * zoom}px`,
      "--arbor-overview-height": `${height * zoom}px`
    });
    this.overviewViewportEl?.toggleClass("is-zoomed-out", zoom < 0.78);
  }

  private resetViewFromZoomIndicator(): void {
    this.clearOverviewZoomFrame();
    this.updateZoomLevel(1);
    if (this.presentationMode !== "overview") {
      return;
    }
    this.syncOverviewZoom();
    window.requestAnimationFrame(() => this.centerOverviewOnSelectedBlock());
  }

  private centerOverviewOnSelectedBlock(): void {
    const viewport = this.overviewViewportEl;
    const scene = this.overviewSceneEl;
    const selectedCard = this.overviewSurfaceEl?.querySelector<HTMLElement>(".arbor-overview-card.is-active");
    if (!viewport || !scene || !selectedCard) {
      return;
    }
    const zoom = this.plugin.settings.zoomLevel;
    const centerX = scene.offsetLeft + (selectedCard.offsetLeft + selectedCard.offsetWidth / 2) * zoom;
    const centerY = scene.offsetTop + (selectedCard.offsetTop + selectedCard.offsetHeight / 2) * zoom;
    viewport.scrollTo({
      left: Math.max(0, centerX - viewport.clientWidth / 2),
      top: Math.max(0, centerY - viewport.clientHeight / 2),
      behavior: "smooth"
    });
  }

  private syncOverviewSelection(selectionChanged: boolean): void {
    if (!this.state || !this.overviewSurfaceEl) {
      return;
    }

    const selectedBlockId = this.state.selectedBlockId;
    const activePathIds = new Set(getActivePath(this.state.metadata, selectedBlockId).map((block) => block.id));
    const cards = this.overviewSurfaceEl.querySelectorAll<HTMLElement>(".arbor-overview-card");
    let selectedCard: HTMLElement | null = null;
    let shouldAnimateSelectedCard = false;
    cards.forEach((card) => {
      const blockId = card.dataset.blockId;
      if (!blockId) {
        return;
      }
      const presentation = resolveOverviewCardSelectionState(
        blockId,
        selectedBlockId,
        activePathIds,
        selectionChanged
      );
      card.toggleClass("is-active", presentation.active);
      card.toggleClass("is-on-path", presentation.onPath);
      if (presentation.active) {
        selectedCard = card;
        shouldAnimateSelectedCard = presentation.animate;
      }
    });

    if (shouldAnimateSelectedCard && selectedCard) {
      this.animateOverviewSelectedCard(selectedCard);
    }
    if (selectionChanged && selectedCard) {
      this.revealOverviewSelectedCard(selectedCard);
    }
  }

  private animateOverviewSelectedCard(selectedCard: HTMLElement): void {
    this.overviewSelectionAnimation = startOverviewSelectionAnimation(
      selectedCard,
      this.overviewSelectionAnimation,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  private revealOverviewSelectedCard(selectedCard: HTMLElement): void {
    const viewport = this.overviewViewportEl;
    const scene = this.overviewSceneEl;
    if (!viewport || !scene) {
      return;
    }

    const zoom = this.plugin.settings.zoomLevel;
    const padding = 36;
    const cardLeft = scene.offsetLeft + selectedCard.offsetLeft * zoom;
    const cardTop = scene.offsetTop + selectedCard.offsetTop * zoom;
    const cardRight = cardLeft + selectedCard.offsetWidth * zoom;
    const cardBottom = cardTop + selectedCard.offsetHeight * zoom;
    const viewportRight = viewport.scrollLeft + viewport.clientWidth;
    const viewportBottom = viewport.scrollTop + viewport.clientHeight;
    const isOutsideViewport =
      cardLeft < viewport.scrollLeft + padding ||
      cardRight > viewportRight - padding ||
      cardTop < viewport.scrollTop + padding ||
      cardBottom > viewportBottom - padding;

    if (!isOutsideViewport) {
      return;
    }

    let targetLeft = viewport.scrollLeft;
    let targetTop = viewport.scrollTop;
    if (cardLeft < viewport.scrollLeft + padding) {
      targetLeft = cardLeft - padding;
    } else if (cardRight > viewportRight - padding) {
      targetLeft = cardRight - viewport.clientWidth + padding;
    }
    if (cardTop < viewport.scrollTop + padding) {
      targetTop = cardTop - padding;
    } else if (cardBottom > viewportBottom - padding) {
      targetTop = cardBottom - viewport.clientHeight + padding;
    }

    viewport.scrollTo({
      left: Math.max(0, Math.min(targetLeft, viewport.scrollWidth - viewport.clientWidth)),
      top: Math.max(0, Math.min(targetTop, viewport.scrollHeight - viewport.clientHeight)),
      behavior: "smooth"
    });
  }

  private restoreOverviewKeyboardFocusAfterMutation(): void {
    if (!this.shouldRestoreOverviewKeyboardFocusAfterMutation) {
      return;
    }
    this.shouldRestoreOverviewKeyboardFocusAfterMutation = false;
    this.pendingFocusBlockId = null;
    window.requestAnimationFrame(() => {
      this.overviewViewportEl?.focus({ preventScroll: true });
    });
  }

  private preserveOverviewViewportPosition(): void {
    const viewport = this.overviewViewportEl;
    if (!viewport) {
      return;
    }
    viewport.scrollTo({ left: viewport.scrollLeft, top: viewport.scrollTop, behavior: "auto" });
    this.pendingOverviewViewportPosition = { left: viewport.scrollLeft, top: viewport.scrollTop };
  }

  private restoreOverviewViewportPosition(): void {
    const viewport = this.overviewViewportEl;
    const position = this.pendingOverviewViewportPosition;
    if (!viewport || !position) {
      return;
    }
    this.pendingOverviewViewportPosition = null;
    viewport.scrollTo({
      left: Math.max(0, Math.min(position.left, viewport.scrollWidth - viewport.clientWidth)),
      top: Math.max(0, Math.min(position.top, viewport.scrollHeight - viewport.clientHeight)),
      behavior: "auto"
    });
  }

  private clearOverviewZoomFrame(): void {
    if (this.overviewZoomFrame !== null) {
      window.cancelAnimationFrame(this.overviewZoomFrame);
      this.overviewZoomFrame = null;
    }
    this.pendingOverviewZoom = null;
  }

  private scheduleTouchZoom(nextZoom: number): void {
    this.pendingTouchZoom = nextZoom;
    if (this.touchZoomFrame !== null) {
      return;
    }
    this.touchZoomFrame = window.requestAnimationFrame(() => {
      this.touchZoomFrame = null;
      const zoom = this.pendingTouchZoom;
      this.pendingTouchZoom = null;
      if (zoom === null) {
        return;
      }
      this.updateZoomLevel(zoom);
      if (this.presentationMode === "overview") {
        this.syncOverviewZoom();
      }
    });
  }

  private clearTouchZoomFrame(): void {
    if (this.touchZoomFrame !== null) {
      window.cancelAnimationFrame(this.touchZoomFrame);
      this.touchZoomFrame = null;
    }
    this.pendingTouchZoom = null;
  }

  private cleanupOverviewPan(): void {
    const viewport = this.overviewViewportEl;
    const pointerId = this.overviewPanState?.pointerId;
    if (viewport && pointerId !== undefined && viewport.hasPointerCapture(pointerId)) {
      viewport.releasePointerCapture(pointerId);
    }
    viewport?.removeClass("is-panning");
    this.overviewPanState = null;
  }

  private async syncOutputPreview(): Promise<void> {
    const stage = this.outputStageEl;
    if (!stage || !this.state) {
      return;
    }

    stage.querySelectorAll<HTMLElement>(".arbor-output-preview-surface.is-staging")
      .forEach((surface) => surface.remove());
    const renderVersion = this.outputRenderVersion;
    let metadata = cloneMetadata(this.state.metadata);
    if (this.editingSession) {
      metadata = updateBlockContent(metadata, this.editingSession.blockId, this.editingSession.value);
    }
    const projection = projectOutput(metadata, this.state.outputState);
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
    returnButton.addEventListener("click", () => this.closeOutputPreview());
    const exportButton = actions.createEl("button", {
      cls: "mod-cta",
      attr: { type: "button" }
    });
    setIcon(exportButton, "file-output");
    exportButton.createSpan({ text: "Export clean copy" });
    exportButton.addEventListener("click", () => void this.exportCleanCopy());

    const content = surface.createDiv({
      cls: "arbor-output-preview-content",
      attr: { "aria-label": `Output preview: ${projection.profile.name}` }
    });
    if (projection.prefix.trim().length > 0) {
      const prefix = content.createDiv({ cls: "arbor-output-preview-prefix markdown-rendered" });
      await MarkdownRenderer.render(this.app, projection.prefix, prefix, this.file?.path ?? "", this);
    }

    for (const entry of projection.included) {
      if (renderVersion !== this.outputRenderVersion) {
        surface.remove();
        return;
      }
      const block = content.createDiv({ cls: "arbor-output-preview-block markdown-rendered" });
      block.dataset.blockId = entry.block.id;
      block.dataset.depth = String(entry.depth);
      await MarkdownRenderer.render(this.app, entry.block.content, block, this.file?.path ?? "", this);
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
      this.previewPaneEl.createDiv({ cls: "arbor-preview-title", text: "Selected block" });
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

    for (const item of previewItems) {
      if (item.type === "summary") {
        const summaryEl = container.createDiv({ cls: "arbor-preview-summary" });
        summaryEl.setCssProps({ "--bw-preview-depth": String(item.depth) });
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
      previewBlockEl.setCssProps({ "--bw-preview-depth": String(depth) });
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
      headerEl.createDiv({
        cls: "arbor-preview-index",
        text: `Block ${String(linearIndex).padStart(2, "0")}`
      });
      const pathLabels = buildPreviewPathLabels(
        this.state.metadata,
        block.id,
        this.plugin.settings
      );

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
              this.editor.consumeAutofocus(this.editingSession);
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
    buildPreviewPathLabels(this.state.metadata, this.state.selectedBlockId ?? "", this.plugin.settings).forEach((label, index, labels) => {
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
      rowEl.setCssProps({ "--bw-preview-depth": String(node.depth) });
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
    return this.navigationController.handleSearchShortcut(event);
  }

  private handleHistoryShortcut(event: KeyboardEvent): boolean {
    return this.navigationController.handleHistoryShortcut(event);
  }

  private openViewMenu(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();

    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Search blocks").setIcon("search").onClick(() => this.openSearchOverlay()));
    for (const [label, icon, factor] of [["Zoom in", "zoom-in", 1.15], ["Zoom out", "zoom-out", 1 / 1.15]] as const) {
      menu.addItem((item) => item.setTitle(label).setIcon(icon).onClick(() => {
        this.updateZoomLevel(this.plugin.settings.zoomLevel * factor);
        this.syncOverviewZoom();
      }));
    }
    menu.addItem((item) =>
      item.setTitle("Open in Markdown").setIcon("file-text").onClick(() => void this.openCurrentFileInMarkdown())
    );
    menu.addItem((item) =>
      this.presentationMode === "output"
        ? item.setTitle("Return to branch editor").setIcon("git-fork").onClick(() => this.closeOutputPreview())
        : item.setTitle("Output preview").setIcon("file-check-2").onClick(() => this.openOutputPreview())
    );
    menu.addItem((item) =>
      item.setTitle("Export clean copy…").setIcon("file-output").onClick(() => void this.exportCleanCopy())
    );
    menu.addItem((item) =>
      item.setTitle("Export tree overview…").setIcon("image-down").onClick(() => void this.exportTreeOverview())
    );
    menu.addItem((item) =>
      this.presentationMode === "overview"
        ? item.setTitle("Return to branch editor").setIcon("git-fork").onClick(() => this.closeTreeOverview())
        : item.setTitle("Tree overview").setIcon("map").onClick(() => this.openTreeOverview())
    );
    menu.addSeparator();
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
      item.setTitle("Open settings").setIcon("settings-2").onClick(() => this.openArborSettings())
    );

    const anchor = this.viewMenuButtonEl;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right - 8, y: rect.bottom + 6 }, anchor.ownerDocument);
      return;
    }

    menu.showAtPosition({ x: 220, y: 120 }, this.contentEl.ownerDocument);
  }

  private syncOutputProfileButton(): void {
    if (!this.outputProfileButtonEl || !this.state) {
      return;
    }
    const presentation = getOutputProfileButtonPresentation(this.state.outputState);
    this.outputProfileButtonEl.setText(presentation.text);
    this.outputProfileButtonEl.setAttr("aria-label", presentation.ariaLabel);
  }

  private syncOverviewModeButton(): void {
    if (!this.overviewButtonEl) {
      return;
    }
    const isOverview = this.presentationMode === "overview";
    this.overviewButtonEl.setAttr("aria-label", isOverview ? "Return to branch editor" : "Open tree overview");
    setIcon(this.overviewButtonEl, isOverview ? "git-fork" : "map");
  }

  private openOutputProfileMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.state) {
      return;
    }

    const menu = new Menu();
    const profiles = [
      { id: FULL_OUTPUT_PROFILE_ID, name: "Full tree" },
      ...this.state.outputState.profiles.map((profile) => ({ id: profile.id, name: profile.name }))
    ];
    profiles.forEach((profile) => {
      menu.addItem((item) =>
        item
          .setTitle(profile.name)
          .setIcon(profile.id === this.state?.outputState.activeProfileId ? "check" : "circle")
          .setDisabled(Boolean(this.state?.outputError))
          .onClick(() => void this.activateOutputProfile(profile.id))
      );
    });
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Manage output profiles…")
        .setIcon("list-tree")
        .onClick(() => this.openOutputProfilesManager())
    );

    const anchor = this.outputProfileButtonEl;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 6 }, anchor.ownerDocument);
    }
  }

  private openOutputProfilesManager(): void {
    if (!this.state) {
      return;
    }
    new OutputProfilesModal(this.app, {
      initialState: deepClone(this.state.outputState),
      metadata: cloneMetadata(this.state.metadata),
      selectedBlockId: this.state.selectedBlockId,
      outputError: this.state.outputError,
      activate: (state) => this.applyActiveOutputProfile(state),
      mutate: (label, state) => this.applyOutputProfileMutation(label, state),
      reset: () => this.resetInvalidOutputProfiles(),
      closed: () => undefined
    }).open();
  }

  private async activateOutputProfile(profileId: string): Promise<ArborOutputState> {
    if (!this.state) {
      return createDefaultOutputState();
    }
    const next = setActiveOutputProfile(this.state.outputState, profileId, this.state.metadata);
    return this.applyActiveOutputProfile(next);
  }

  private async applyActiveOutputProfile(next: ArborOutputState): Promise<ArborOutputState> {
    if (!this.state || this.state.outputError) {
      return deepClone(this.state?.outputState ?? createDefaultOutputState());
    }
    await this.commitEditIfNeeded();
    if (!this.state) {
      return createDefaultOutputState();
    }
    this.state.outputState = deepClone(next);
    this.syncVisibleOutputCardPresentations();
    this.render();
    await this.persistState("Switch output profile");
    return deepClone(this.state.outputState);
  }

  private async applyOutputProfileMutation(
    label: string,
    next: ArborOutputState
  ): Promise<ArborOutputState> {
    if (!this.state || this.state.outputError) {
      return deepClone(this.state?.outputState ?? createDefaultOutputState());
    }
    await this.commitEditIfNeeded();
    if (!this.state) {
      return createDefaultOutputState();
    }
    this.history.push(label, this.state.metadata, this.state.outputState, this.state.selectedBlockId);
    this.state.outputState = deepClone(next);
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    this.shouldRestoreOverviewKeyboardFocusAfterMutation =
      this.presentationMode === "overview" &&
      this.overviewViewportEl?.contains(this.contentEl.ownerDocument.activeElement) === true;
    await this.persistState(label);
    this.render();
    return deepClone(this.state.outputState);
  }

  private async resetInvalidOutputProfiles(): Promise<ArborOutputState> {
    if (!this.state || !this.state.outputError) {
      return deepClone(this.state?.outputState ?? createDefaultOutputState());
    }
    await this.commitEditIfNeeded();
    if (!this.state) {
      return createDefaultOutputState();
    }
    this.state.outputState = createDefaultOutputState();
    this.state.outputRaw = "";
    this.state.outputError = null;
    await this.persistState("Reset output profiles");
    this.render();
    return deepClone(this.state.outputState);
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
    const snapViewport = this.shouldSnapViewportAfterDirectionChange;
    this.pendingFocusBlockId = null;
    this.pendingScrollBlockId = null;
    this.shouldSnapViewportAfterDirectionChange = false;

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
              this.editor.consumeAutofocus(this.editingSession);
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
              this.editor.consumeAutofocus(this.editingSession);
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
          this.animateSelectedCard(pendingScrollBlockId);
          this.scrollCardIntoHorizontalView(scrollCard, columnsViewportEl, preservedSceneWidth, snapViewport);
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
    this.navigationController.handleCardClick(event);
  }

  private handleCardDoubleClick(event: MouseEvent): void {
    this.navigationController.handleCardDoubleClick(event);
  }

  private handleCardContextMenu(event: MouseEvent): void {
    this.navigationController.handleCardContextMenu(event);
  }

  private handleCardKeyDown(event: KeyboardEvent): void {
    this.navigationController.handleCardKeyDown(event);
  }

  private handleViewportKeyDown(event: KeyboardEvent): void {
    this.navigationController.handleViewportKeyDown(event);
  }

  private handleCardDragStart(event: DragEvent): void {
    const card = event.currentTarget as HTMLElement;
    const blockId = card.dataset.blockId;
    if (!canStartCardDrag(this.plugin.settings.dragAndDrop, this.editingSession?.blockId ?? null, blockId)) {
      event.preventDefault();
      return;
    }

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

  private async applyDrop(_column: BranchColumnModel): Promise<void> {
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
      const canvas = this.contentEl.createEl("canvas");
      canvas.remove();
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
    preview.setCssProps({ "--arbor-drag-preview-width": `${card.offsetWidth}px` });

    const rect = card.getBoundingClientRect();
    const stageRect = this.columnsStageEl.getBoundingClientRect();
    const initialLeft = rect.left - stageRect.left;
    const initialTop = rect.top - stageRect.top;
    preview.setCssProps({
      "--arbor-drag-preview-x": `${Math.round(initialLeft)}px`,
      "--arbor-drag-preview-y": `${Math.round(initialTop)}px`
    });

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
    this.dragPreviewEl.setCssProps({
      "--arbor-drag-preview-x": `${Math.round(left)}px`,
      "--arbor-drag-preview-y": `${Math.round(top)}px`
    });
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
    mutate: (metadata: BranchTreeMetadata) => BranchTreeMutationResult,
    autofocusSelection = false
  ): Promise<void> {
    if (!this.state) {
      return;
    }

    await this.commitEditIfNeeded();

    const beforeMetadata = cloneMetadata(this.state.metadata);
    this.history.push(label, beforeMetadata, this.state.outputState, this.state.selectedBlockId);
    const result = mutate(cloneMetadata(beforeMetadata));
    this.state.metadata = normalizeMetadata(result.metadata);
    this.state.outputState = reconcileProfilesAfterTreeChange(
      beforeMetadata,
      this.state.metadata,
      this.state.outputState,
      result.duplicateMap
    );
    this.state.selectedBlockId = ensureSelectedBlock(this.state.metadata, result.selectedBlockId);
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.pendingFocusBlockId = this.state.selectedBlockId;
    this.pendingScrollBlockId = this.state.selectedBlockId;
    this.shouldRestoreOverviewKeyboardFocusAfterMutation =
      this.presentationMode === "overview" &&
      this.overviewViewportEl?.contains(this.contentEl.ownerDocument.activeElement) === true;

    if (autofocusSelection && this.state.selectedBlockId) {
      const block = getBlock(this.state.metadata, this.state.selectedBlockId);
      if (block) {
        this.editor.prepareCreatedBlock(block, this.presentationMode === "overview" ? "overview" : "card");
      }
    }

    await this.persistState(label);
    this.render();
  }

  private currentHistorySnapshot(label: string): BranchHistoryEntry {
    return {
      label,
      metadata: cloneMetadata(this.state?.metadata ?? createEmptyTree()),
      outputState: deepClone(this.state?.outputState ?? createDefaultOutputState()),
      selectedBlockId: this.state?.selectedBlockId ?? null
    };
  }

  private async commitEditIfNeeded(): Promise<void> {
    await this.editor.commitEditIfNeeded();
  }

  private cancelEditingSession(): void {
    this.editor.cancelEditingSession();
  }

  private async commitEditingSession(session: EditingSession | null = this.editingSession): Promise<void> {
    await this.editor.commitEditingSession(session);
  }

  private scheduleEditingSessionCommit(session: EditingSession): void {
    this.editor.scheduleEditingSessionCommit(session);
  }

  private clearBlurCommitTimer(): void {
    this.editor.clearBlurCommitTimer();
  }

  private onEditorBegin(session: EditingSession): void {
    if (!this.state) return;
    if (this.state.selectedBlockId !== session.blockId) this.pendingScrollBlockId = session.blockId;
    this.stopHorizontalScrollMotion();
    this.state.selectedBlockId = session.blockId;
    this.pendingFocusBlockId = session.blockId;
    this.syncTouchDock();
    const block = getBlock(this.state.metadata, session.blockId);
    if (session.origin === "overview" && block && this.openOverviewEditorInPlace(block)) return;
    if (session.origin === "overview") this.preserveOverviewViewportPosition();
    this.render();
  }

  private onEditorCancel(session: EditingSession | null): void {
    this.pendingFocusBlockId = this.state?.selectedBlockId ?? null;
    this.syncTouchDock();
    if (session?.origin === "overview") {
      void this.restoreOverviewCardContentInPlace(session.blockId);
      return;
    }
    this.render();
  }

  private async onEditorUnchanged(session: EditingSession): Promise<void> {
    this.pendingFocusBlockId = session.blockId;
    this.syncTouchDock();
    if (session.origin === "overview") {
      await this.restoreOverviewCardContentInPlace(session.blockId);
      return;
    }
    this.render();
  }

  private async saveEditorSession(session: EditingSession): Promise<void> {
    if (!this.state) return;
    if (session.origin === "overview") this.preserveOverviewViewportPosition();
    this.history.push("Edit block", this.state.metadata, this.state.outputState, this.state.selectedBlockId);
    this.state.metadata = normalizeMetadata(updateBlockContent(this.state.metadata, session.blockId, session.value));
    this.state.selectedBlockId = session.blockId;
    this.state.linearized = linearizeTree(this.state.metadata);
    this.state.origin = "metadata";
    this.state.staleMetadata = null;
    this.pendingFocusBlockId = session.blockId;
    await this.persistState("Edit block");
    this.render();
  }

  private resetViewState(): void {
    this.navigationController.clearNumericNavigation();
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
    this.editor.reset();
    this.dragState = null;
    this.isSearchOpen = false;
    this.showFullMiniMap = false;
    this.shouldFocusSearchInput = false;
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.loadingState = null;
    this.teardownShell();
  }

  private async persistState(reason: string): Promise<void> {
    if (!this.file || !this.state) {
      return;
    }

    const metadata = normalizeMetadata(this.state.metadata);
    this.state.metadata = metadata;
    this.state.linearized = linearizeTree(metadata);
    const document = buildBranchDocument(
      this.state.frontmatter,
      this.state.linearized.body,
      metadata,
      this.state.outputState,
      this.state.outputError ? this.state.outputRaw : undefined
    );

    this.isPersisting = true;
    try {
      this.plugin.markOwnWrite(this.file.path);
      await this.app.vault.process(this.file, () => document);
      this.plugin.rememberManagedNote(this.file.path);
      this.state.origin = "metadata";
      this.state.staleMetadata = null;
    } catch (error) {
      console.error(`[Arbor] Failed to persist state after ${reason}`, error);
      new Notice(`Arbor could not save the note after "${reason}".`);
    } finally {
      this.isPersisting = false;
    }
  }

  private applyCssVars(root: HTMLElement): void {
    root.setCssProps({
      "--bw-card-width": `${this.plugin.settings.cardWidth}px`,
      "--bw-card-min-height": `${this.plugin.settings.cardMinHeight}px`,
      "--bw-column-gap": `${this.plugin.settings.horizontalSpacing}px`,
      "--bw-card-gap": `${this.plugin.settings.verticalSpacing}px`,
      "--bw-zoom": `${this.plugin.settings.zoomLevel}`,
      "--bw-content-zoom": `${this.plugin.settings.zoomLevel}`,
      "--arbor-card-preview-max-height": `${CARD_PREVIEW_MAX_HEIGHT_PX}px`
    });
    this.syncZoomIndicator();
  }

  private applyViewClasses(root: HTMLElement): void {
    this.compactLayout = useCompactLayout(root.clientWidth);
    root.toggleClass("is-compact", this.compactLayout);
    root.toggleClass("has-touch-controls", this.usesTouchControls);
    root.classList.add("is-context-dim-mode");
    root.classList.toggle("is-rtl", this.plugin.settings.layoutDirection === "rtl");
    this.applyThemeVariables(root);
    this.renderedLayoutDirection = this.plugin.settings.layoutDirection;
  }

  private applyThemeVariables(root: HTMLElement): void {
    const theme = this.plugin.getEffectiveThemeState();
    const customVariables = resolveArborThemeVariables(
      theme.activeThemeId,
      theme.customThemes
    );
    root.setCssProps(Object.fromEntries(
      ARBOR_THEME_VARIABLES.map((name) => [name, customVariables[name] ?? ""])
    ));
  }

  private buildBlockMenu(blockId: BranchBlockId): Menu {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Edit block").setIcon("pencil").onClick(() => this.beginEditingBlock(blockId, this.presentationMode === "overview" ? "overview" : "card")));
    const canCreateLeft = this.state ? Boolean(getParentBlock(this.state.metadata, blockId)) : false;
    const childCount = this.state ? getChildren(this.state.metadata, blockId).length : 0;
    const block = this.state ? getBlock(this.state.metadata, blockId) : null;

    menu
      .addItem((item) =>
        item.setTitle("Create child").setIcon(getChildArrowIcon(this.plugin.settings.layoutDirection)).onClick(() => void this.runWithSelectedBlock(blockId, () => this.createChild()))
      );

    if (canCreateLeft) {
      menu.addItem((item) =>
        item.setTitle("Create at parent level").setIcon(getParentArrowIcon(this.plugin.settings.layoutDirection)).onClick(() => void this.runWithSelectedBlock(blockId, () => this.createParentLevelBlock()))
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

    menu.addSeparator();
    this.addBlockOutputMenuItems(menu, blockId);

    menu
      .addSeparator()
      .addItem((item) =>
        item.setTitle("Copy block link").setIcon("link").onClick(() => void this.copyBlockLink(blockId))
      )
      .addItem((item) =>
        item.setTitle("Duplicate subtree").setIcon("copy-plus").onClick(() => void this.runWithSelectedBlock(blockId, () => this.duplicateSelectedSubtree()))
      )
      .addItem((item) =>
        item.setTitle("Reveal in Markdown").setIcon("file-text").onClick(() => void this.runWithSelectedBlock(blockId, () => this.revealCurrentBlockInMarkdown()))
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

  private addBlockOutputMenuItems(menu: Menu, blockId: BranchBlockId): void {
    if (!this.state) {
      return;
    }

    getBlockOutputMenuActions(this.state.outputState).forEach((action) => {
      menu.addItem((item) => {
        item
          .setTitle(action.label)
          .setIcon(action.icon)
          .setDisabled(Boolean(this.state?.outputError));

        if (action.id === "create-profile") {
          item.onClick(() => this.openOutputProfilesManager());
          return;
        }

        item.onClick(() => void this.applyOutputMutation(action.label, (profile) => {
          if (!action.state || !action.scope || !this.state) {
            return profile;
          }
          return action.scope === "block"
            ? setBlockOnlyState(this.state.metadata, profile, blockId, action.state)
            : setSubtreeState(this.state.metadata, profile, blockId, action.state);
        }));
      });
    });
  }

  private async applyOutputMutation(
    label: string,
    mutate: (profile: ArborOutputProfile) => ArborOutputProfile
  ): Promise<void> {
    if (!this.state || this.state.outputError) {
      return;
    }

    await this.commitEditIfNeeded();
    if (!this.state || this.state.outputError) {
      return;
    }

    const activeProfile = getActiveOutputProfile(this.state.outputState);
    if (activeProfile.id === FULL_OUTPUT_PROFILE_ID) {
      return;
    }

    const selectedBlockId = this.state.selectedBlockId;
    this.history.push(label, this.state.metadata, this.state.outputState, selectedBlockId);
    const updatedProfile = mutate(activeProfile);
    this.state.outputState = deepClone({
      ...this.state.outputState,
      profiles: this.state.outputState.profiles.map((profile) =>
        profile.id === activeProfile.id ? updatedProfile : profile
      )
    });
    this.pendingFocusBlockId = selectedBlockId;
    this.pendingScrollBlockId = selectedBlockId;
    this.shouldRestoreOverviewKeyboardFocusAfterMutation =
      this.presentationMode === "overview" &&
      this.overviewViewportEl?.contains(this.contentEl.ownerDocument.activeElement) === true;
    await this.persistState(label);
    this.render();
  }

  private syncOutputCardPresentation(
    card: HTMLElement,
    blockId: BranchBlockId,
    context: BranchViewContext | null = this.viewContext
  ): void {
    if (!this.state) {
      syncOutputCardPresentation(card, null);
      return;
    }

    syncOutputCardPresentation(card, getOutputCardPresentation(
      this.state.metadata,
      this.state.outputState,
      blockId,
      context?.outputProfile,
      context?.outputResolutions
    ));
  }

  private syncVisibleOutputCardPresentations(): void {
    if (!this.state) {
      return;
    }

    const outputProfile = getActiveOutputProfile(this.state.outputState);
    const outputResolutions = resolveOutputStates(this.state.metadata, outputProfile);
    const context = this.viewContext
      ? { ...this.viewContext, outputProfile, outputResolutions }
      : null;
    if (context) {
      this.viewContext = context;
    }
    this.syncOutputProfileButton();

    const syncCard = (card: HTMLElement): void => {
      const blockId = card.dataset.blockId;
      if (blockId) {
        this.syncOutputCardPresentation(card, blockId, context);
      }
    };
    this.columnsEl?.querySelectorAll<HTMLElement>(".arbor-card[data-block-id]").forEach(syncCard);
    this.overviewSurfaceEl
      ?.querySelectorAll<HTMLElement>(".arbor-overview-card[data-block-id]")
      .forEach(syncCard);
  }

  private async copyBlockLink(blockId: BranchBlockId): Promise<void> {
    const block = this.state ? getBlock(this.state.metadata, blockId) : null;
    if (!this.file || !block) {
      return;
    }
    const link = buildArborBlockLink(this.file.path, blockId, extractPathLabel(block.content));
    try {
      await navigator.clipboard.writeText(link);
    } catch (error) {
      console.error("[Arbor] Failed to copy block link", error);
      const modal = new Modal(this.app);
      modal.modalEl.addClass("arbor-export-modal");
      modal.contentEl.createEl("h3", { text: "Copy block link" });
      modal.contentEl.createEl("p", { text: "Select and copy this link." });
      const input = modal.contentEl.createEl("textarea", { cls: "arbor-copy-link", attr: { readonly: "", "aria-label": "Block link" } });
      input.value = link;
      new ButtonComponent(modal.contentEl).setButtonText("Close").onClick(() => modal.close());
      modal.open();
      input.focus();
      input.select();
    }
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
    this.editor.resizeEditor(textarea);
  }

  private handleViewportWheel(event: WheelEvent, viewport: HTMLElement): void {
    if (this.compactLayout) return;
    if ((event.ctrlKey || event.metaKey) && this.plugin.settings.enableCtrlWheelZoom) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
      this.updateZoomLevel(this.plugin.settings.zoomLevel * factor);
      return;
    }

    const hoveredColumn = this.getColumnAtPointerX(event.clientX);
    const wheelNavigation = resolveColumnWheelNavigation(
      event.deltaX,
      event.deltaY,
      event.ctrlKey,
      event.metaKey,
      hoveredColumn !== null
    );
    if (wheelNavigation) {
      event.preventDefault();
      const columnTarget = this.state && hoveredColumn
        ? resolveColumnWheelTarget(this.state.metadata, this.state.selectedBlockId, hoveredColumn)
        : null;
      if (columnTarget) {
        this.selectBlock(columnTarget, { focus: true });
        return;
      }
      if (wheelNavigation === "previous") {
        this.selectPreviousSiblingBlock();
      } else {
        this.selectNextSiblingBlock();
      }
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
      left: getHorizontalWheelDelta(event.deltaY, this.plugin.settings.layoutDirection),
      behavior: "auto"
    });
  }

  private getColumnAtPointerX(clientX: number): BranchColumnModel | null {
    for (const [columnKey, columnEl] of this.columnElementMap) {
      const bounds = columnEl.getBoundingClientRect();
      if (clientX >= bounds.left && clientX <= bounds.right) {
        return this.currentColumnMap.get(columnKey) ?? null;
      }
    }
    return null;
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
    const clamped = clampZoomLevel(Number(nextZoomLevel.toFixed(3)));
    if (Math.abs(clamped - this.plugin.settings.zoomLevel) < 0.001) {
      return;
    }

    this.plugin.settings.zoomLevel = clamped;
    this.applyCssVars(this.contentEl);
    this.scheduleZoomPersist();
    this.flashZoomIndicator();
    if (this.presentationMode === "overview") {
      return;
    }
    if (this.compactLayout) {
      this.syncViewportEdgeFades();
      if (!this.branchTouchPinching) {
        window.requestAnimationFrame(() => this.revealCompactSelection());
      }
      return;
    }

    this.scheduleColumnAlignment();

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
    if (event.pointerType === "touch" || this.compactLayout) return;
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

  private armSceneWidthForPendingScroll(nextColumnCount: number): number {
    if (this.compactLayout) return 0;
    if (!this.pendingScrollBlockId || !this.columnsEl || !this.columnsViewportEl) {
      return 0;
    }

    const existingColumnCount = this.columnsEl.querySelectorAll(".arbor-column").length;
    const preservedSceneWidth = reserveSceneWidthForColumns(
      this.columnsEl.scrollWidth,
      this.columnsViewportEl.clientWidth,
      existingColumnCount,
      nextColumnCount,
      this.plugin.settings.cardWidth,
      this.plugin.settings.horizontalSpacing,
      this.plugin.settings.zoomLevel
    );
    this.columnsEl.setCssProps({ "--arbor-columns-min-width": `${preservedSceneWidth}px` });
    return preservedSceneWidth;
  }

  private releasePreservedSceneWidth(): void {
    if (this.columnsEl) {
      this.columnsEl.setCssProps({ "--arbor-columns-min-width": "max-content" });
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

  private animateSelectedCard(blockId: BranchBlockId): void {
    this.contentEl.querySelectorAll<HTMLElement>(".arbor-card.is-selection-entering").forEach((card) => {
      card.removeClass("is-selection-entering");
    });

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const card = this.columnsEl?.querySelector<HTMLElement>(`.arbor-card[data-block-id="${blockId}"]`);
    if (!card) {
      return;
    }

    card.addClass("is-selection-entering");
    card.addEventListener("animationend", () => card.removeClass("is-selection-entering"), { once: true });
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

  private scrollCardIntoHorizontalView(card: HTMLElement, viewport: HTMLElement, preservedSceneWidth = 0, snap = false): void {
    if (this.compactLayout) {
      this.revealCompactSelection();
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const safePadding = Math.min(96, viewport.clientWidth * 0.18);
    const shouldScrollLeft = cardRect.left < viewportRect.left + safePadding;
    const shouldScrollRight = cardRect.right > viewportRect.right - safePadding;

    if (!shouldScrollLeft && !shouldScrollRight) {
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
      return;
    }

    if (preservedSceneWidth > 0 && this.columnsEl) {
      this.columnsEl.setCssProps({
        "--arbor-columns-min-width": `${Math.max(preservedSceneWidth, viewport.clientWidth)}px`
      });
    }

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const targetLeft = shouldScrollLeft
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
    if (snap) {
      this.stopHorizontalScrollMotion(false);
      viewport.scrollLeft = targetLeft;
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
      return;
    }

    this.animateViewportScrollTo(viewport, targetLeft);
  }

  private alignColumnsToActivePath(): void {
    if (this.compactLayout) {
      this.columnsEl?.querySelectorAll<HTMLElement>(".arbor-card-list").forEach((list) => {
        list.setCssProps({ "--arbor-card-list-offset-y": "0px" });
        list.removeClass("is-rebinding");
      });
      return;
    }
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

    columns.forEach((columnEl) => {
      const listEl = columnEl.querySelector<HTMLElement>(".arbor-card-list");
      if (!listEl) {
        return;
      }

      const fallbackCards = Array.from(columnEl.querySelectorAll<HTMLElement>(".arbor-card"));
      const preferredFallbackCard =
        fallbackCards[Math.floor((Math.max(fallbackCards.length, 1) - 1) / 2)] ?? null;

      const depth = Number(columnEl.dataset.columnDepth);
      const pathBlock = path[depth];
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
      const preferredCenterY = depth === 0
        ? rootAnchorCenterY
        : (resolvedCenterYByColumn.get(depth - 1) ?? naturalCenterY);
      const anchorCenterY = alignmentTarget.hasClass("is-active")
        ? clampCardCenter(
            preferredCenterY,
            alignmentTarget.offsetHeight,
            viewportRect.top - columnsRootRect.top,
            viewport.clientHeight
          )
        : preferredCenterY;
      const shift = anchorCenterY - naturalCenterY;

      if (Math.abs(shift) < 0.25) {
        listEl.setCssProps({ "--arbor-card-list-offset-y": "0px" });
      } else {
        listEl.setCssProps({ "--arbor-card-list-offset-y": `${shift}px` });
      }

      if (listEl.hasClass("is-rebinding")) {
        window.requestAnimationFrame(() => {
          listEl.removeClass("is-rebinding");
        });
      }

      resolvedCenterYByColumn.set(depth, naturalCenterY + shift);
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
    await this.attachments.handleEditorPaste(event, textarea);
  }

  private async handleEditorDrop(event: DragEvent, textarea: HTMLTextAreaElement): Promise<void> {
    await this.attachments.handleEditorDrop(event, textarea);
  }
}
