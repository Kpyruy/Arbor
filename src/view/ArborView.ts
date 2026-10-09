import { runAsyncAction } from "./runtime/asyncActions";
import {
  App,
  ButtonComponent,
  FileView,
  Keymap,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Platform,
  parseLinktext,
  resolveSubpath,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import type { ViewStateResult } from "obsidian";
import type ArborPlugin from "../main";
import { setBlockColor } from "../model/blockAppearance";
import { syncCardColour } from "./appearance/cardColours";
import { BlockColorModal } from "./modals/BlockColorModal";
import {
  addChild,
  addRootBlock,
  addSibling,
  buildColumnModels,
  deleteBlockAndLiftChildren,
  deleteSubtree,
  duplicateBlock,
  duplicateSubtree,
  ensureSelectedBlock,
  getActivePath,
  getBlock,
  getChildren,
  getDescendantIds,
  getParentBlock,
  moveBlockDown,
  moveBlockLeft,
  moveBlockRight,
  moveBlockUp,
  setBlockCollapsed,
  toggleBlockCollapsed,
} from "../model/tree";
import { VIEW_TYPE_ARBOR } from "../constants";
import {
  BranchBlock,
  BranchBlockId,
  BranchTreeMetadata,
  BranchTreeMutationResult,
  ArborPresentationMode,
  ArborOverviewOrientation,
  ArborOutputProfile,
  ArborOutputState,
  ArborSettings
} from "../types";
import {
  createDefaultOutputState,
  getActiveOutputProfile,
  resolveOutputStates,
  setActiveOutputProfile
} from "../outputProfiles";
import { canOpenImportedBranchDocumentInArbor } from "../opening";
import { extractPathLabel } from "../utils";
import { MOBILE_TREE_OVERVIEW_EXPORT_LIMITS, resolveTreeOverviewExportSize, type TreeOverviewExportQuality } from "../treeOverviewExport";
import { ARBOR_THEME_VARIABLES, resolveArborThemeVariables } from "../theme";
import { OutputProfilesModal, type OutputProfilesController } from "./OutputProfilesModal";
import { toBlob } from "html-to-image";
import { compactColumns } from "../mobile";
import { buildViewContext } from "./state/viewModel";
import type {
  BranchViewContext,
  EditingOrigin,
  EditingSession,
  LoadedFileIdentity,
  LoadedFileState,
  LoadingOverlayState,
  OverviewEditorSelectionSnapshot
} from "./state/viewTypes";
import {
  getOutputCardPresentation,
  syncOutputCardPresentation
} from "./output/outputPresentation";
import { ArborConfirmModal } from "./modals/ArborConfirmModal";
import { CleanExportModal } from "./modals/CleanExportModal";
import { TreeOverviewExportModal } from "./modals/TreeOverviewExportModal";
import { TreeOverviewController } from "./overview/TreeOverviewController";
import { ExportController, type OverviewSnapshot } from "./export/ExportController";
import { createOverviewSnapshot } from "./export/overviewSnapshot";
import { BlockEditorController } from "./editor/BlockEditorController";
import { EditorAttachments } from "./editor/EditorAttachments";
import { NavigationController } from "./navigation/NavigationController";
import { CardLinkController } from "./navigation/CardLinkController";
import { HeadingLinkController } from "./navigation/HeadingLinkController";
import { LocalHeadingLinks, readHeadingLinker, readHeadingLinkerObserver, type HeadingProviderSnapshot } from "./navigation/LocalHeadingLinks";
import { BranchViewportController } from "./branch/BranchViewportController";
import { OverviewViewportController } from "./overview/OverviewViewportController";
import { ZoomController } from "./interaction/ZoomController";
import { TouchController } from "./interaction/TouchController";
import { BranchRenderer, routeBranchViewportWheel } from "./branch/BranchRenderer";
import { DragDropController } from "./branch/DragDropController";
import { LinearPreviewController } from "./preview/LinearPreviewController";
import { OutputPreviewController } from "./preview/OutputPreviewController";
import { SearchController } from "./chrome/SearchController";
import { BreadcrumbsController } from "./chrome/BreadcrumbsController";
import { ViewShell } from "./chrome/ViewShell";
import { ViewMenus } from "./chrome/ViewMenus";
import { DocumentController, DocumentLoadChangedError } from "./state/DocumentController";
import { ViewWorkScope } from "./runtime/ViewWorkScope";
import { normalizeOverviewOrientation, resolveOverviewOrientation } from "../overviewOrientation";
export {
  getBlockOutputMenuActions,
  getOutputCardPresentation
} from "./output/outputPresentation";
export type {
  BlockOutputMenuActionId,
  BlockOutputMenuAction,
  OutputCardPresentation
} from "./output/outputPresentation";

export class ArborView extends FileView {
  navigation = true;

  private readonly documentController: DocumentController;
  private readonly editor: BlockEditorController;
  private readonly attachments: EditorAttachments;
  private readonly navigationController: NavigationController;
  private readonly cardLinks: CardLinkController;
  private readonly headingLinks: HeadingLinkController;
  private readonly localHeadingLinks: LocalHeadingLinks;
  private headingSnapshotCache: { path: string; snapshot: HeadingProviderSnapshot | null } | null = null;
  private headingProviderIdentity: object | null = null;
  private disposeHeadingSubscription: (() => void) | null = null;
  private readonly branchViewport: BranchViewportController;
  private readonly overviewViewport: OverviewViewportController;
  private readonly overview: TreeOverviewController;
  private readonly zoomController: ZoomController;
  private readonly touchController: TouchController;
  private readonly branchRenderer: BranchRenderer;
  private readonly dragDropController: DragDropController;
  private readonly preview: LinearPreviewController;
  private readonly output: OutputPreviewController;
  private readonly search: SearchController;
  private readonly shell: ViewShell;
  private readonly breadcrumbs: BreadcrumbsController;
  private readonly menus: ViewMenus;
  private readonly work = new ViewWorkScope();
  private renderGeneration = 0;
  private cancelRenderFrame: (() => void) | null = null;
  private loadGeneration = 0;
  private overviewOrientationChangeGeneration = 0;
  private overviewOrientationWrites = 0;
  private overviewOrientationRefreshPending = false;
  private overviewWorkspaceState: Record<string, unknown> = {};
  private overviewEditorSelectionContext: {
    selection: OverviewEditorSelectionSnapshot;
    file: TFile | null;
    load: number;
    requested: number;
    token: number;
  } | null = null;
  private pendingFocusBlockId: BranchBlockId | null = null;
  private pendingScrollBlockId: BranchBlockId | null = null;
  private lastViewportScroll = { left: 0, top: 0 };
  private hoveredBlockId: BranchBlockId | null = null;
  private viewContext: BranchViewContext | null = null;
  private loadingState: LoadingOverlayState | null = null;
  private presentationMode: ArborPresentationMode = "editor";
  private renderedLayoutDirection: ArborSettings["layoutDirection"] = "ltr";
  private shouldSnapViewportAfterDirectionChange = false;

  private get editingSession(): EditingSession | null {
    return this.editor.getSession();
  }
  private get state(): Readonly<LoadedFileState> | null {
    return this.documentController.getState();
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
  private get frameEl(): HTMLElement | null { return this.shell.getElements().frameEl; }
  private get breadcrumbsEl(): HTMLElement | null { return this.shell.getElements().breadcrumbsEl; }
  private get breadcrumbExitLayerEl(): HTMLElement | null { return this.shell.getElements().breadcrumbExitLayerEl; }
  private get zoomIndicatorEl(): HTMLButtonElement | null { return this.shell.getElements().zoomIndicatorEl; }
  private get modeControlsEl(): HTMLElement | null { return this.shell.getElements().modeControlsEl; }
  private get outputProfileButtonEl(): HTMLButtonElement | null { return this.shell.getElements().outputProfileButtonEl; }
  private get overviewButtonEl(): HTMLButtonElement | null { return this.shell.getElements().overviewButtonEl; }
  private get markdownButtonEl(): HTMLButtonElement | null { return this.shell.getElements().markdownButtonEl; }
  private get themeButtonEl(): HTMLButtonElement | null { return this.shell.getElements().themeButtonEl; }
  private get viewMenuButtonEl(): HTMLButtonElement | null { return this.shell.getElements().viewMenuButtonEl; }
  private get bodyEl(): HTMLElement | null { return this.shell.getElements().bodyEl; }
  private get columnsStageEl(): HTMLElement | null { return this.shell.getElements().columnsStageEl; }
  private get columnsViewportEl(): HTMLElement | null { return this.shell.getElements().columnsViewportEl; }
  private get columnsEl(): HTMLElement | null { return this.shell.getElements().columnsEl; }
  private get outputStageEl(): HTMLElement | null { return this.shell.getElements().outputStageEl; }
  private get compactLayout(): boolean { return this.shell.isCompact(); }

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ArborPlugin) {
    super(leaf);
    this.documentController = new DocumentController({
      getFile: () => this.file,
      cachedRead: (file) => this.app.vault.cachedRead(file),
      process: (file, transform) => this.app.vault.process(file, transform),
      markOwnWrite: (path) => this.plugin.markOwnWrite(path),
      rememberManagedNote: (path) => this.plugin.rememberManagedNote(path),
      commitEditIfNeeded: () => this.commitEditIfNeeded(),
      clearEditingSession: () => this.editor.reset(),
      beforeOverviewEditSave: () => this.preserveOverviewViewportPosition(),
      onMutationPrepared: (autofocusSelection) => this.prepareDocumentMutation(autofocusSelection),
      onSelectionRestored: () => {
        const selectedBlockId = this.state?.selectedBlockId ?? null;
        this.pendingFocusBlockId = selectedBlockId;
        this.pendingScrollBlockId = selectedBlockId;
      },
      onEditedBlockSaved: (session) => {
        this.pendingFocusBlockId = session.blockId;
        if (session.origin === "overview") this.overview.requestRevealOnNextRender();
      },
      onProfileActivated: () => this.syncVisibleOutputCardPresentations(),
      requestRender: () => this.render(),
      notify: (message) => new Notice(message),
      reportError: (message, error) => console.error(message, error)
    });
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
      getFilePath: () => this.file?.path ?? "",
      getLoadedFileIdentity: () => this.documentController.getLoadedFileIdentity(),
      recoveryStore: this.plugin.draftRecoveryStore,
      onCommitted: (session) => this.onEditorCommitted(session),
      onError: (error) => this.reportActionError(error),
      getState: () => this.state,
      getWindow: () => this.contentEl.win,
      usesTouchControls: () => this.usesTouchControls,
      getViewportHeight: () => (this.presentationMode === "overview" ? this.overview.getElements().viewport : this.columnsViewportEl)?.clientHeight ?? window.innerHeight,
      onBegin: (session) => this.onEditorBegin(session),
      onCancel: (session) => this.onEditorCancel(session),
      onUnchanged: (session) => this.onEditorUnchanged(session),
      saveEdit: (session) => this.saveEditorSession(session),
      onInput: () => {
        const session = this.editor.getSession();
        if (session?.origin === "overview") this.overview.reflowOverviewCard(session.blockId);
        else this.scheduleColumnAlignment();
      },
      handleSearchShortcut: (event) => this.handleSearchShortcut(event),
      paste: (event, textarea) => this.attachments.handleEditorPaste(event, textarea),
      drop: (event, textarea) => this.attachments.handleEditorDrop(event, textarea)
    });
    this.localHeadingLinks = new LocalHeadingLinks((path) => this.getLocalHeadingProvider(path));
    const selectLinkTarget = (blockId: string): boolean => {
      if (!this.state || !getBlock(this.state.metadata, blockId)) return false;
      this.selectBlock(blockId, { focus: true, reveal: true });
      return true;
    };
    this.headingLinks = new HeadingLinkController({
      getState: () => this.state,
      getSourcePath: () => this.file?.path ?? "",
      resolveLocalHeading: (linktext, sourcePath) => {
        const parsed = parseLinktext(linktext);
        if (!parsed.subpath || !this.file || this.file.path !== sourcePath) return null;
        const target = parsed.path ? this.app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath) : this.file;
        if (target?.path !== sourcePath) return null;
        const cache = this.app.metadataCache.getFileCache(target);
        const resolved = cache ? resolveSubpath(cache, parsed.subpath) : null;
        return cache && resolved?.type === "heading" ? { cache, heading: resolved.current } : null;
      },
      readSource: (sourcePath) => {
        const file = this.file;
        if (!file || file.path !== sourcePath) throw new Error("Arbor link source is no longer open");
        return this.app.vault.cachedRead(file);
      },
      selectLocalBlock: selectLinkTarget,
      openInternal: (linktext, sourcePath, pane) => this.app.workspace.openLinkText(linktext, sourcePath, pane)
    });
    this.register(() => this.clearHeadingSubscription());
    this.cardLinks = new CardLinkController({
      getSourcePath: () => this.file?.path ?? "",
      paneForEvent: (event) => Keymap.isModEvent(event),
      openInternal: (linktext, sourcePath, pane) => this.headingLinks.open(linktext, sourcePath, pane),
      selectLocalBlock: selectLinkTarget,
      reportOpenError: () => { new Notice("Could not open this link."); }
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
      isSearchOpen: () => this.search.isOpen(),
      setKeyboardSelection: (id) => this.documentController.setSelection(id),
      openBlockMenu: (id, event) => this.buildBlockMenu(id).showAtMouseEvent(event),
      tryHandleCardLink: (event, card) => this.cardLinks.handleActivation(event, card)
    }, () => this.getOverviewOrientation(), () => this.contentEl.win);
    this.branchViewport = new BranchViewportController({
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      getElements: () => ({ root: this.contentEl, stage: this.columnsStageEl, viewport: this.columnsViewportEl, columns: this.columnsEl, previewContent: this.preview.getContent() }),
      getSession: () => this.editor.getSession(),
      isCompact: () => this.compactLayout,
      consumeAutofocus: (session) => this.editor.consumeAutofocus(session)
    });
    this.overviewViewport = new OverviewViewportController({
      getElements: () => {
        const { viewport, scene, surface } = this.overview.getElements();
        return { viewport, scene, surface };
      },
      getZoom: () => this.plugin.settings.zoomLevel
    });
    this.zoomController = new ZoomController({
      getZoom: () => this.plugin.settings.zoomLevel,
      setZoom: (value) => { this.plugin.settings.zoomLevel = value; },
      saveSettings: () => this.plugin.saveSettings(),
      applyZoom: () => {
        this.applyCssVars(this.contentEl);
      },
      flashIndicator: () => this.flashZoomIndicator(),
      hideIndicator: () => this.hideZoomIndicator(),
      afterZoom: () => this.afterZoom()
    });
    this.touchController = new TouchController({
      getZoom: () => this.plugin.settings.zoomLevel,
      scheduleZoom: (value) => this.zoomController.scheduleTouchZoom(value),
      hasEditingSession: () => this.editor.getSession() !== null,
      usesTouchControls: () => this.usesTouchControls,
      getOverviewSceneOffset: () => ({
        left: this.overview.getElements().scene?.offsetLeft ?? 0,
        top: this.overview.getElements().scene?.offsetTop ?? 0
      }),
      revealCompactSelection: () => this.revealCompactSelection()
    });
    this.dragDropController = new DragDropController({
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      getDocument: () => this.contentEl.ownerDocument,
      getRoot: () => this.contentEl,
      getStage: () => this.columnsStageEl,
      getColumn: (key) => this.branchRenderer.getColumn(key),
      usesTouchControls: () => this.usesTouchControls,
      isEditing: (id) => this.editor.getSession()?.blockId === id,
      selectBlock: (id, options) => this.selectBlock(id, options),
      move: (label, mutate) => this.applyMutation(label, mutate),
      requestRender: () => this.render()
    });
    this.branchRenderer = new BranchRenderer({
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      editor: this.editor,
      markdown: { render: (markdown, target, sourcePath) => this.renderCardMarkdown(markdown, target, sourcePath) },
      events: {
        click: (event) => this.handleCardClick(event),
        auxClick: (event) => this.navigationController.handleCardAuxClick(event),
        doubleClick: (event) => this.handleCardDoubleClick(event),
        contextMenu: (event) => this.handleCardContextMenu(event),
        keyDown: (event) => this.handleCardKeyDown(event),
        pointer: (id, x, y) => this.dragDropController.rememberCardPointerPosition(id, x, y),
        hover: (id) => this.setHoveredBlock(id),
        dragStart: (event) => this.dragDropController.handleCardDragStart(event),
        dragEnd: () => this.dragDropController.handleCardDragEnd(),
        dragOver: (event) => this.dragDropController.handleCardDragOver(event),
        drop: (event) => this.dragDropController.handleCardDrop(event),
        columnDragOver: (event) => this.dragDropController.handleColumnDragOver(event),
        columnDrop: (column) => this.dragDropController.applyDrop(column)
      },
      getColumnsRoot: () => this.columnsEl,
      getContext: () => this.viewContext,
      getDragState: () => this.dragDropController.getDragState(),
      usesTouchControls: () => this.usesTouchControls,
      selectBlock: (id, options) => this.selectBlock(id, options),
      consumeAutofocus: (session) => this.editor.consumeAutofocus(session),
      scheduleColumnAlignment: () => this.scheduleColumnAlignment(),
      createRootBlock: () => this.createRootBlock(),
      createChild: () => this.createChild(),
      setCollapsedState: (id, collapsed) => this.setCollapsedState(id, collapsed)
    });
    this.overview = new TreeOverviewController({
      getOverviewOrientation: () => this.getOverviewOrientation(),
      captureOverviewEditorSelection: () => this.captureOverviewEditorSelection(),
      restoreOverviewEditorSelection: (saved) => this.restoreOverviewEditorSelection(saved),
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      editor: this.editor,
      markdown: { render: (markdown, target, sourcePath) => this.renderCardMarkdown(markdown, target, sourcePath) },
      selection: { selectBlock: (id, options) => this.selectBlock(id, options) },
      getBody: () => this.bodyEl,
      getContext: () => this.viewContext,
      bindViewport: (viewport) => this.bindOverviewViewport(viewport),
      openBlockMenu: (id, event) => this.buildBlockMenu(id).showAtMouseEvent(event),
      setHoveredBlock: (id) => this.setHoveredBlock(id),
      restoreViewport: () => this.restoreOverviewViewportPosition(),
      centerSelected: () => this.centerOverviewOnSelectedBlock(),
      revealSelected: (card) => this.revealOverviewSelectedCard(card),
      syncTouchDock: () => this.syncTouchDock(),
      requestRender: () => this.render(),
      waitForNextPaint: () => this.waitForNextPaint(),
      syncOutputCardPresentation: (card, id, context) => this.syncOutputCardPresentation(card, id, context),
      consumeAutofocus: (session) => this.editor.consumeAutofocus(session),
      clearPendingFocus: () => { this.pendingFocusBlockId = null; },
      tryHandleCardLink: (event, card) => this.cardLinks.handleActivation(event, card)
    });
    this.output = new OutputPreviewController({
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      markdown: { render: (markdown, target, sourcePath) => MarkdownRenderer.render(this.app, markdown, target, sourcePath, this) },
      getStage: () => this.outputStageEl,
      getSession: () => this.editor.getSession(),
      closeOutputPreview: () => this.closeOutputPreview(),
      exportCleanCopy: () => this.exportCleanCopy()
    });
    this.preview = new LinearPreviewController({
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      markdown: { render: (markdown, target, sourcePath) => MarkdownRenderer.render(this.app, markdown, target, sourcePath, this) },
      editor: this.editor,
      selection: { selectBlock: (id, options) => this.selectBlock(id, options) },
      getBody: () => this.bodyEl,
      getVisibleBlockIds: () => this.branchRenderer.getVisibleBlockIds(),
      setHoveredBlock: (id) => this.setHoveredBlock(id),
      setCollapsedState: (id, collapsed) => this.setCollapsedState(id, collapsed),
      toggleCollapsedState: (id) => this.toggleCollapsedState(id),
      consumeAutofocus: (session) => this.editor.consumeAutofocus(session),
      requestRender: () => this.render()
    });
    this.search = new SearchController({
      getFrame: () => this.frameEl,
      // Input can arrive before the scheduled render updates viewContext.
      getContext: () => this.state ? buildViewContext(
        this.state.metadata, this.state.selectedBlockId, this.state.outputState,
        this.search.getQuery(), this.plugin.settings
      ) : null,
      selectBlock: (id, options) => this.selectBlock(id, options),
      handleSearchShortcut: (event) => this.navigationController.handleSearchShortcut(event),
      requestRender: () => this.render()
    });
    this.shell = new ViewShell(this.contentEl, {
      getOverviewOrientation: () => this.getOverviewOrientation(),
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      getSession: () => this.editor.getSession(),
      getLoadingState: () => this.loadingState,
      getThemeVariables: () => {
        const theme = this.plugin.getEffectiveThemeState();
        return resolveArborThemeVariables(theme.activeThemeId, theme.customThemes);
      },
      getLastScroll: () => this.lastViewportScroll,
      onScroll: (position) => {
        this.lastViewportScroll = position;
        this.syncViewportEdgeFades();
      },
      bindBranchViewport: (element) => this.bindBranchViewport(element),
      toolbar: {
        resetZoom: () => this.resetViewFromZoomIndicator(),
        openMarkdown: () => this.openCurrentFileInMarkdown(),
        openThemeStudio: () => this.plugin.openThemeStudio(),
        openViewMenu: (event) => this.openViewMenu(event),
        openOutputProfileMenu: (event) => this.openOutputProfileMenu(event),
        toggleOverview: () => {
          if (this.presentationMode === "overview") this.closeTreeOverview();
          else this.openTreeOverview();
        }
      },
      dock: {
        selectParent: () => this.selectParentBlock(),
        selectPrevious: () => this.selectPreviousSiblingBlock(),
        selectNext: () => this.selectNextSiblingBlock(),
        selectChild: () => this.selectPreferredChildBlock(),
        edit: () => {
          const id = this.state?.selectedBlockId;
          if (id) this.beginEditingBlock(id, this.presentationMode === "overview" ? "overview" : "card");
        },
        cancel: () => this.cancelEditingSession(),
        save: () => this.commitEditingSession(),
        createRoot: () => this.createRootBlock(),
        createChild: () => this.createChild(),
        createSibling: () => this.createSiblingBelow(),
        openBlockMenu: () => this.openActiveBlockMenu(),
        clearBlurCommitTimer: () => this.clearBlurCommitTimer()
      },
      onCompactChange: () => {
        this.pendingScrollBlockId = this.state?.selectedBlockId ?? null;
        this.render();
      },
      resizeEditors: () => this.resizeEditors(),
      onResizeDuringEdit: () => this.revealSelectionAfterShellResize(),
      onDirectionApplied: (direction) => { this.renderedLayoutDirection = direction; }
    });
    this.breadcrumbs = new BreadcrumbsController(
      { getState: () => this.state, getSettings: () => this.plugin.settings, getMode: () => this.presentationMode, getFilePath: () => this.file?.path ?? "" },
      { selectBlock: (id, options) => this.selectBlock(id, options) },
      () => ({ frame: this.frameEl, breadcrumbs: this.breadcrumbsEl, exitLayer: this.breadcrumbExitLayerEl }),
      () => this.file?.basename ?? ""
    );
    this.menus = new ViewMenus({
      getOverviewOrientation: () => this.getOverviewOrientation(),
      getOverviewOrientationOverride: () => this.getOverviewOrientationOverride(),
      setOverviewOrientationOverride: (value) => this.setOverviewOrientationOverride(value),
      read: { getState: () => this.state, getSettings: () => this.plugin.settings, getMode: () => this.presentationMode, getFilePath: () => this.file?.path ?? "" },
      selection: { selectBlock: (id, options) => this.selectBlock(id, options) },
      editor: this.editor,
      commands: {
        createChild: () => this.createChild(), createParentLevelBlock: () => this.createParentLevelBlock(),
        createSiblingAbove: () => this.createSiblingAbove(), createSiblingBelow: () => this.createSiblingBelow(),
        selectParentBlock: () => this.selectParentBlock(), selectPreviousSiblingBlock: () => this.selectPreviousSiblingBlock(),
        selectNextSiblingBlock: () => this.selectNextSiblingBlock(), selectFirstChildBlock: () => this.selectFirstChildBlock(),
        toggleCollapsedState: (id) => this.toggleCollapsedState(id), duplicateSelectedSubtree: () => this.duplicateSelectedSubtree(),
        revealCurrentBlockInMarkdown: () => this.revealCurrentBlockInMarkdown(), deleteSelectedBlock: () => this.deleteSelectedBlock(),
        deleteSelectedSubtree: () => this.deleteSelectedSubtree(), openTreeOverview: () => this.openTreeOverview(), closeTreeOverview: () => this.closeTreeOverview(),
        openOutputPreview: () => this.openOutputPreview(), closeOutputPreview: () => this.closeOutputPreview(),
        exportCleanCopy: () => this.exportCleanCopy(), exportTreeOverview: () => this.exportTreeOverview()
      },
      getRoot: () => this.contentEl,
      getViewMenuButton: () => this.viewMenuButtonEl,
      getProfileButton: () => this.outputProfileButtonEl,
      runWithSelectedBlock: (id, action) => this.runWithSelectedBlock(id, action),
      openSearchOverlay: () => this.openSearchOverlay(),
      updateZoomLevel: (value) => this.zoomController.updateZoomLevel(value),
      syncOverviewZoom: () => this.syncOverviewZoom(),
      openCurrentFileInMarkdown: () => this.openCurrentFileInMarkdown(),
      updateViewSetting: (key, value, refreshAll) => this.updateViewSetting(key, value, refreshAll),
      openArborSettings: () => this.openArborSettings(),
      activateOutputProfile: (id) => this.activateOutputProfile(id),
      applyActiveOutputProfile: (state) => this.applyActiveOutputProfile(state),
      applyOutputProfileMutation: (label, state) => this.applyOutputProfileMutation(label, state),
      resetInvalidOutputProfiles: () => this.resetInvalidOutputProfiles(),
      applyOutputMutation: (label, mutate) => this.applyOutputMutation(label, mutate),
      openProfiles: (controller) => this.openOutputProfilesManager(controller),
      chooseBlockColor: (options) => new BlockColorModal(this.app, options).waitForChoice(),
      applyBlockColor: (id, scope, color) => this.applyMutation("Change block color", metadata => ({
        metadata: setBlockColor(metadata, id, scope, color),
        selectedBlockId: this.state?.selectedBlockId ?? null
      })),
      writeClipboard: (text) => navigator.clipboard.writeText(text),
      showCopyLinkFallback: (text) => this.showCopyLinkFallback(text),
      reportError: (message, error) => console.error(message, error)
    });
    this.allowNoFile = false;
    const doc = this.contentEl.ownerDocument;
    this.registerDomEvent(doc, "visibilitychange", () => {
      if (doc.visibilityState === "hidden" && Platform.isMobile) {
        runAsyncAction(this.commitEditIfNeeded(), error => this.reportActionError(error));
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
    return this.shell.usesTouchControls();
  }

  private handleMobileResize(): void {
    this.shell.handleMobileResize();
  }

  private resizeEditors(): void {
    this.contentEl.querySelectorAll<HTMLTextAreaElement>("textarea.arbor-editor").forEach((editor) => this.resizeEditor(editor));
  }

  private revealSelectionAfterShellResize(): void {
    if (!this.usesTouchControls || !this.editingSession) return;
    if (this.presentationMode === "overview") {
      const card = this.overview.getElements().surface?.querySelector<HTMLElement>(".arbor-overview-card.is-active");
      if (card) this.revealOverviewSelectedCard(card);
    }
    else this.revealCompactSelection();
  }

  private applyCssVars(root: HTMLElement): void { this.shell.applyCssVars(root); }
  private applyViewClasses(root: HTMLElement): void { this.shell.applyViewClasses(root); }
  private syncTouchDock(): void { this.shell.syncTouchDock(); }
  private syncBanner(): void { this.shell.syncBanner(); }
  private syncLoadingOverlay(): void { this.shell.syncLoadingOverlay(); }
  private syncBreadcrumbs(): void { this.breadcrumbs.syncBreadcrumbs(); }
  private clearBreadcrumbScrollFrame(): void { this.breadcrumbs.clearBreadcrumbScrollFrame(); }
  private syncZoomIndicator(): void { this.shell.syncZoomIndicator(); }
  private syncOutputProfileButton(): void {
    this.shell.syncOutputProfileButton();
  }
  private syncOverviewModeButton(): void {
    this.shell.syncOverviewModeButton();
  }
  private openViewMenu(event?: MouseEvent): void { this.menus.openViewMenu(event); }
  private openOutputProfileMenu(event: MouseEvent): void { this.menus.openOutputProfileMenu(event); }
  private buildBlockMenu(blockId: BranchBlockId): Menu { return this.menus.buildBlockMenu(blockId); }

  private teardownShell(): void {
    this.dragDropController.reset();
    this.cleanupViewportPan();
    this.cleanupOverviewPan();
    this.overview.reset();
    this.touchController.reset();
    this.search.reset();
    this.preview.reset();
    this.output.reset();
    this.breadcrumbs.reset();
    this.menus.reset();
    this.shell.teardownShell();
    this.branchRenderer.reset();
    this.dragDropController.reset();
  }

  private openOutputProfilesManager(controller: OutputProfilesController): void {
    new OutputProfilesModal(this.app, controller).open();
  }

  private async activateOutputProfile(profileId: string): Promise<ArborOutputState> {
    if (!this.state) {
      return createDefaultOutputState();
    }
    const next = setActiveOutputProfile(this.state.outputState, profileId, this.state.metadata);
    return this.applyActiveOutputProfile(next);
  }

  private async applyActiveOutputProfile(next: ArborOutputState): Promise<ArborOutputState> {
    await this.awaitDeferredReload();
    return this.documentController.applyActiveOutputProfile(next);
  }

  private async applyOutputProfileMutation(label: string, next: ArborOutputState): Promise<ArborOutputState> {
    await this.awaitDeferredReload();
    return this.documentController.applyOutputProfileMutation(label, next);
  }

  private async resetInvalidOutputProfiles(): Promise<ArborOutputState> {
    await this.awaitDeferredReload();
    return this.documentController.resetInvalidOutputProfiles();
  }

  private async updateViewSetting<Key extends keyof ArborSettings>(key: Key, value: ArborSettings[Key], refreshAll = true): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    if (refreshAll) {
      this.plugin.refreshAllBranchViews();
      return;
    }
    this.render();
  }

  private showCopyLinkFallback(link: string): void {
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
    const generation = this.beginLoad();
    const prepared = await this.prepareLoadedFileState(
      file,
      this.state?.selectedBlockId ?? null,
      generation
    );
    if (!prepared || !this.isCurrentLoad(generation, file)) {
      return;
    }

    this.documentController.replaceLoadedState(prepared, file);
    const state = this.state;
    if (state?.origin === "reconciled") {
      new Notice("The tree was rebuilt from the visible Markdown body to avoid losing plain editor changes.");
    }

    this.resetLoadedUiState(state?.selectedBlockId ?? null);
    this.render();
    this.showDraftRecovery();
  }

  async onUnloadFile(): Promise<void> {
    this.headingLinks?.cancelPending();
    this.clearHeadingSubscription();
    this.invalidatePendingLoads();
    const generation = this.loadGeneration;
    try {
      await this.commitEditIfNeeded();
    } finally {
      if (generation === this.loadGeneration) this.resetViewState();
    }
  }

  clear(): void {
    this.invalidatePendingLoads();
    this.work.reset();
    this.clearBlurCommitTimer();
    this.zoomController.reset();
    this.clearBreadcrumbScrollFrame();
    this.branchViewport.reset();
    this.overviewViewport.reset();
    this.overview.reset();
    this.dragDropController.reset();
    this.cleanupViewportPan();
    this.documentController.reset();
    this.editor.reset();
    this.search.reset();
    this.preview.reset();
    this.output.reset();
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.loadingState = null;
    this.presentationMode = "editor";
    this.teardownShell();
  }

  async onClose(): Promise<void> {
    this.headingLinks?.cancelPending();
    this.clearHeadingSubscription();
    this.invalidatePendingLoads();
    let saveError: unknown;
    let saveFailed = false;
    try { await this.commitEditIfNeeded(); }
    catch (error) { saveFailed = true; saveError = error; this.editor.retainCurrentDraft(); }
    this.work.dispose();
    this.navigationController.clearNumericNavigation();
    this.zoomController.reset();
    this.touchController.reset();
    this.clearBreadcrumbScrollFrame();
    this.branchViewport.reset();
    this.overviewViewport.reset();
    this.dragDropController.reset();
    this.cleanupOverviewPan();
    this.overview.reset();
    this.documentController.reset();
    this.editor.reset();
    this.search.reset();
    this.preview.reset();
    this.output.reset();
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.loadingState = null;
    this.presentationMode = "editor";
    this.teardownShell();
    await super.onClose();
    if (saveFailed) throw saveError;
  }

  async handleFileModified(file: TFile): Promise<void> {
    if (!this.file || file.path !== this.file.path) {
      return;
    }

    this.plugin.consumeOwnWrite(file.path);

    const state = this.state;
    const text = await this.app.vault.cachedRead(file);
    if (this.file !== file || this.state !== state) return;
    const orientation = this.getOverviewOrientation();
    if (this.documentController.syncOrientationOnlyChange(text)) {
      if (this.getOverviewOrientation() !== orientation) this.refreshOverviewOrientation();
      return;
    }

    if (this.editingSession || this.documentController.isWriting()) {
      this.reloadRequired = true;
      new Notice("The note changed on disk while a block was being edited. Finish or cancel the card edit before reloading.");
      return;
    }

    await this.onLoadFile(file);
  }

  async refreshView(): Promise<void> {
    if (!this.file) {
      return;
    }

    const file = this.file;
    const generation = this.beginLoad();
    const prepared = await this.prepareLoadedFileState(
      file,
      this.state?.selectedBlockId ?? null,
      generation
    );
    if (!prepared || !this.isCurrentLoad(generation, file)) {
      return;
    }

    const directionChanged = this.renderedLayoutDirection !== this.plugin.settings.layoutDirection;
    this.documentController.replaceLoadedState(prepared, file);
    const state = this.state;
    this.shouldSnapViewportAfterDirectionChange = directionChanged;
    if (directionChanged && this.presentationMode === "overview") {
      this.overview.requestCenterOnNextRender();
    }
    this.pendingFocusBlockId = state?.selectedBlockId ?? null;
    this.pendingScrollBlockId = state?.selectedBlockId ?? null;
    this.render();
  }

  async refreshLayoutDirection(): Promise<void> {
    if (!this.file || !this.state || this.renderedLayoutDirection === this.plugin.settings.layoutDirection) {
      return;
    }

    this.stopHorizontalScrollMotion();
    this.applyViewClasses(this.contentEl);

    if (this.presentationMode === "overview") {
      this.overview.requestCenterOnNextRender();
      this.render();
      return;
    }

    this.syncBreadcrumbs();
    this.syncViewportEdgeFades();
    this.work.frame(window, () => {
      this.alignColumnsToActivePath();
      const viewport = this.columnsViewportEl;
      const activeCard = this.columnsEl?.querySelector<HTMLElement>(".arbor-card.is-active");
      if (viewport && activeCard) {
        this.scrollCardIntoHorizontalView(activeCard, viewport, 0, true);
      }
    });
  }

  private resetLoadedUiState(selectedBlockId: BranchBlockId | null): void {
    this.documentController.clearHistory();
    this.editor.reset();
    this.dragDropController.reset();
    this.search.reset();
    this.preview.reset();
    this.presentationMode = this.plugin.settings.defaultPresentationMode;
    this.overview.requestCenterOnNextRender(this.presentationMode === "overview");
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.pendingFocusBlockId = selectedBlockId;
    this.pendingScrollBlockId = selectedBlockId;
  }

  private async prepareLoadedFileState(
    file: TFile,
    preferredSelectedBlockId: BranchBlockId | null,
    generation: number
  ): Promise<LoadedFileState | null> {
    const initial = await this.documentController.readLoadedFileState(file, preferredSelectedBlockId);
    if (!this.isCurrentLoad(generation, file)) {
      return null;
    }

    const expectedArborOpen = this.plugin.consumeExplicitArborOpen(file.path);
    const staysInArbor = Boolean(initial.parsed.metadata)
      || (expectedArborOpen && canOpenImportedBranchDocumentInArbor(initial.loaded));
    if (!staysInArbor) {
      if (!this.isCurrentLoad(generation, file)) {
        return null;
      }
      await this.openFileInMarkdownView(file);
      return null;
    }

    if (!this.isCurrentLoad(generation, file)) {
      return null;
    }
    this.documentController.replaceLoadedState(initial.state, file);

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
    if (!this.isCurrentLoad(generation, file)) {
      return null;
    }

    try {
      await this.persistState("Upgrade note structure");
      if (!this.isCurrentLoad(generation, file)) {
        return null;
      }

      const remainingLoadingTime = 220 - (performance.now() - loadingStartedAt);
      if (remainingLoadingTime > 0) {
        await this.wait(remainingLoadingTime);
      }
      if (!this.isCurrentLoad(generation, file)) {
        return null;
      }

      const migrated = await this.documentController.readLoadedFileState(file, initial.state.selectedBlockId);
      if (!this.isCurrentLoad(generation, file)) {
        return null;
      }

      this.documentController.replaceLoadedState(migrated.state, file);
      if (!this.isCurrentLoad(generation, file)) {
        return null;
      }
      this.plugin.rememberManagedNote(file.path);
      return migrated.state;
    } finally {
      if (this.isCurrentLoad(generation, file)) {
        this.loadingState = null;
      }
    }
  }

  private beginLoad(): number {
    const generation = ++this.loadGeneration;
    this.documentController.invalidateLoad();
    this.overview.invalidate();
    if (this.loadingState) {
      this.loadingState = null;
      this.syncLoadingOverlay();
    }
    return generation;
  }

  private invalidatePendingLoads(): void {
    this.loadGeneration += 1;
    this.overview.invalidate();
  }

  private isCurrentLoad(generation: number, file: TFile): boolean {
    return this.loadGeneration === generation && this.file === file;
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
    const loadedFileIdentity = this.documentController.getLoadedFileIdentity();
    if (!this.file || !loadedFileIdentity) {
      return;
    }
    await this.commitEditIfNeeded();
    if (!this.isSameLoadedFile(loadedFileIdentity)) return;
    await this.openFileInMarkdownView(this.file);
  }

  async exportCleanCopy(): Promise<void> {
    await this.exportController.exportCleanCopy();
  }

  async exportTreeOverview(): Promise<void> {
    await this.exportController.exportTreeOverview();
  }

  getOverviewOrientation(): ArborOverviewOrientation {
    return resolveOverviewOrientation(this.plugin.settings.overviewOrientation, this.getOverviewOrientationOverride());
  }

  getOverviewOrientationOverride(): ArborOverviewOrientation | null {
    return normalizeOverviewOrientation(this.state?.metadata.overviewOrientation);
  }

  override getState(): Record<string, unknown> {
    const state = { ...this.overviewWorkspaceState, ...super.getState() };
    delete state.arborOverviewOrientation;
    return state;
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const supplied = state && typeof state === "object" ? { ...state } as Record<string, unknown> : {};
    const previous = this.getOverviewOrientation();
    const requested = ++this.overviewOrientationChangeGeneration;
    const token = this.work.token();
    delete supplied.arborOverviewOrientation;
    this.overviewWorkspaceState = supplied;
    const loading = super.setState(supplied, result);
    const load = this.loadGeneration;
    await loading;
    if (requested !== this.overviewOrientationChangeGeneration || load !== this.loadGeneration
      || !this.work.isCurrent(token) || (this.file && this.file.path !== supplied.file)) return;
    this.overviewOrientationRefreshPending ||= this.getOverviewOrientation() !== previous;
    if (this.overviewOrientationRefreshPending) this.refreshOverviewOrientation();
  }

  async setOverviewOrientationOverride(value: ArborOverviewOrientation | null): Promise<void> {
    if (value === this.getOverviewOrientationOverride() && this.overviewOrientationWrites === 0) return;
    const file = this.file;
    const load = this.loadGeneration;
    const requested = ++this.overviewOrientationChangeGeneration;
    this.overviewOrientationWrites += 1;
    try { await this.documentController.saveOverviewOrientation(value); }
    finally { this.overviewOrientationWrites -= 1; }
    if (this.file !== file || this.loadGeneration !== load || requested !== this.overviewOrientationChangeGeneration) return;
    for (const view of this.plugin.getBranchViews()) {
      if (view.file?.path !== file?.path) continue;
      view.documentController.acceptOverviewOrientation(value);
      view.refreshOverviewOrientation();
    }
  }

  refreshOverviewOrientation(): void {
    this.overviewOrientationRefreshPending = false;
    this.overview.invalidate();
    this.overviewViewport.discardPendingRestore();
    this.overview.requestCenterOnNextRender();
    this.render();
  }

  private captureOverviewEditorSelection(): OverviewEditorSelectionSnapshot | null {
    this.overviewEditorSelectionContext = null;
    const session = this.editor.getSession();
    const textarea = this.overview.getElements().surface?.querySelector<HTMLTextAreaElement>("textarea.arbor-overview-editor-input");
    if (!session || session.origin !== "overview" || !textarea
      || textarea.closest<HTMLElement>("[data-block-id]")?.dataset.blockId !== session.blockId) return null;
    const selection: OverviewEditorSelectionSnapshot = {
      session, start: textarea.selectionStart, end: textarea.selectionEnd,
      direction: textarea.selectionDirection, focused: textarea.ownerDocument.activeElement === textarea
    };
    this.overviewEditorSelectionContext = {
      selection, file: this.file, load: this.loadGeneration,
      requested: this.overviewOrientationChangeGeneration, token: this.work.token()
    };
    return selection;
  }

  private restoreOverviewEditorSelection(saved: OverviewEditorSelectionSnapshot): void {
    const context = this.overviewEditorSelectionContext;
    this.overviewEditorSelectionContext = null;
    if (!context || context.selection !== saved || this.file !== context.file || this.loadGeneration !== context.load
      || this.overviewOrientationChangeGeneration !== context.requested || !this.work.isCurrent(context.token)
      || this.editor.getSession() !== saved.session) return;
    const surface = this.overview.getElements().surface;
    const textarea = surface?.querySelector<HTMLTextAreaElement>("textarea.arbor-overview-editor-input");
    if (!textarea?.isConnected || textarea.closest<HTMLElement>("[data-block-id]")?.dataset.blockId !== saved.session.blockId) return;
    this.editor.clearBlurCommitTimer();
    if (saved.focused) textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(saved.start, saved.end, saved.direction);
    const card = textarea.closest<HTMLElement>(".arbor-overview-card");
    if (saved.focused && card) this.revealOverviewSelectedCard(card);
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
      orientation: this.getOverviewOrientation(),
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
    const loadedFileIdentity = this.documentController.getLoadedFileIdentity();
    runAsyncAction(this.commitEditIfNeeded().then(() => {
      if (!this.isSameLoadedFile(loadedFileIdentity)) return;
      this.overview.requestCenterOnNextRender();
      this.presentationMode = "overview";
      this.render();
    }), error => this.reportActionError(error));
  }

  closeTreeOverview(): void {
    const loadedFileIdentity = this.documentController.getLoadedFileIdentity();
    runAsyncAction(this.commitEditIfNeeded().then(() => {
      if (!this.isSameLoadedFile(loadedFileIdentity)) return;
      this.presentationMode = "editor";
      this.render();
    }), error => this.reportActionError(error));
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
    this.headingLinks?.cancelPending();
    this.syncLocalHeadingLinks();
    if (!this.state) {
      return;
    }

    const nextSelectedBlockId = ensureSelectedBlock(this.state.metadata, blockId);
    if (this.editingSession && this.editingSession.blockId !== nextSelectedBlockId) {
      const pendingSession = this.editingSession;
      const loadedFileIdentity = this.documentController.getLoadedFileIdentity();
      runAsyncAction(this.commitEditingSession(pendingSession).then(() => {
        if (this.isSameLoadedFile(loadedFileIdentity) && this.state) {
          this.selectBlock(nextSelectedBlockId, options);
        }
      }), error => this.reportActionError(error));
      return;
    }

    const selectionChanged = this.state.selectedBlockId !== nextSelectedBlockId;
    this.documentController.setSelection(nextSelectedBlockId);
    this.syncTouchDock();

    if (options?.focus) {
      this.pendingFocusBlockId = this.state.selectedBlockId;
    }
    if (selectionChanged || options?.reveal === true) {
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
        this.search.getQuery(),
        this.plugin.settings
      );
      this.search.syncSearchOverlay(this.viewContext);
      this.overview.syncOverviewSelection((selectionChanged || options?.reveal === true) && options?.reveal !== false);
      if (options?.focus) this.overview.getElements().viewport?.focus({ preventScroll: true });
      return;
    }

    if (!selectionChanged && !options?.focus && options?.reveal !== true) {
      return;
    }

    if (!selectionChanged && options?.focus && options?.reveal !== true && this.state.selectedBlockId) {
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
      runAsyncAction(this.editor.commitEditingSession(), error => this.reportActionError(error));
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
    const loadedFileIdentity = this.documentController.getLoadedFileIdentity();
    if (!this.file || !loadedFileIdentity || !this.state?.selectedBlockId) {
      return;
    }

    await this.commitEditIfNeeded();
    if (!this.isSameLoadedFile(loadedFileIdentity)) return;

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
    const loadedFileIdentity = this.documentController.getLoadedFileIdentity();
    await this.commitEditIfNeeded();
    if (!this.isSameLoadedFile(loadedFileIdentity)) return;
    await this.persistState("Rebuild linear Markdown from tree");
  }

  private isSameLoadedFile(identity: LoadedFileIdentity | null): boolean {
    return identity !== null && this.documentController.getLoadedFileIdentity() === identity;
  }

  async rebuildTreeFromMetadata(): Promise<void> {
    await this.documentController.rebuildTreeFromMetadata();
  }

  async undo(): Promise<void> {
    await this.documentController.undo();
  }

  async redo(): Promise<void> {
    await this.documentController.redo();
  }

  render(): void {
    if (!this.work.isCurrent(this.work.token())) return;
    this.renderGeneration += 1;
    this.branchRenderer.invalidate();
    this.preview.invalidate();
    this.overview.invalidate();
    this.output.invalidate();
    this.cancelRenderFrame?.();
    this.cancelRenderFrame = this.work.frame(window, () => {
      this.cancelRenderFrame = null;
      runAsyncAction(this.renderNow(), error => this.reportActionError(error));
    });
  }

  private getLocalHeadingProvider(path: string): HeadingProviderSnapshot | null {
    if (this.headingSnapshotCache?.path === path) return this.headingSnapshotCache.snapshot;
    const plugins = (this.app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
    const loaded = plugins?.["heading-linker"];
    const file = loaded ? this.app.vault.getAbstractFileByPath(path) : null;
    const frontmatter = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    const snapshot = readHeadingLinker(loaded, path, frontmatter);
    this.headingSnapshotCache = { path, snapshot };
    const observer = readHeadingLinkerObserver(loaded);
    if (observer && this.headingProviderIdentity !== observer.identity) {
      this.disposeHeadingSubscription?.();
      this.headingProviderIdentity = observer.identity;
      this.disposeHeadingSubscription = observer.subscribe(() => this.syncLocalHeadingLinks());
    } else if (!observer) {
      this.clearHeadingSubscription();
    }
    return snapshot;
  }

  private async renderCardMarkdown(markdown: string, target: HTMLElement, sourcePath: string): Promise<void> {
    await MarkdownRenderer.render(this.app, markdown, target, sourcePath, this);
    if (this.file?.path === sourcePath) this.localHeadingLinks.decorate(target, sourcePath);
  }

  private syncLocalHeadingLinks(): void {
    this.headingSnapshotCache = null;
    if (!this.localHeadingLinks || !this.state || !this.file) return;
    const path = this.file.path;
    const snapshot = this.getLocalHeadingProvider(path);
    for (const content of Array.from(this.contentEl.querySelectorAll<HTMLElement>(".arbor-card-content.markdown-rendered, .arbor-overview-card-content.markdown-rendered"))) {
      this.localHeadingLinks.decorate(content, path, snapshot);
    }
  }

  private clearHeadingSubscription(): void {
    this.disposeHeadingSubscription?.();
    this.disposeHeadingSubscription = null;
    this.headingProviderIdentity = null;
    this.headingSnapshotCache = null;
  }

  private async renderNow(): Promise<void> {
    this.headingSnapshotCache = null;
    const workToken = this.work.token();
    if (!this.work.isCurrent(workToken)) return;
    const renderGeneration = this.renderGeneration;
    const renderedFile = this.file;
    const renderedState = this.state;
    const isCurrent = () => this.work.isCurrent(workToken) && this.renderGeneration === renderGeneration
      && this.file === renderedFile && this.state === renderedState;
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
      this.search.getQuery(),
      this.plugin.settings
    );
    this.search.syncSearchOverlay(this.viewContext);
    this.syncBanner();
    this.syncLoadingOverlay();
    this.shell.showMode(this.presentationMode);
    if (this.presentationMode === "output") {
      this.overview.hide();
      this.preview.hide();
      await this.output.syncOutputPreview();
      return;
    }

    if (this.presentationMode === "overview") {
      this.preview.hide();
      await this.overview.syncTreeOverview();
      return;
    }

    this.overview.hide();
    const allColumns = buildColumnModels(this.state.metadata, this.state.selectedBlockId, this.plugin.settings.previewSnippetLength);
    const columns = this.compactLayout ? compactColumns(allColumns, this.state.selectedBlockId) : allColumns;
    const preservedSceneWidth = this.armSceneWidthForPendingScroll(columns.length);
    await this.branchRenderer.syncColumns(columns, this.viewContext);
    if (!isCurrent()) return;
    this.alignColumnsToActivePath();
    await this.preview.syncPreview(this.viewContext);
    if (!isCurrent()) return;
    this.applyPendingFocusAndScroll(preservedSceneWidth);
    this.syncHoverLinkedState();
  }

  private ensureShell(): void {
    this.shell.ensureShell();
  }

  private bindBranchViewport(viewport: HTMLElement): () => void {
    const dragOver = (event: DragEvent) => this.dragDropController.handleViewportDragOver(event);
    const wheel = (event: WheelEvent) => routeBranchViewportWheel(
      event, viewport, this.branchRenderer,
      { getState: () => this.state, getSettings: () => this.plugin.settings, getMode: () => this.presentationMode, getFilePath: () => this.file?.path ?? "" },
      { previous: () => this.selectPreviousSiblingBlock(), next: () => this.selectNextSiblingBlock(), selectBlock: (id, options) => this.selectBlock(id, options), updateZoomLevel: (value) => this.zoomController.updateZoomLevel(value) },
      this.compactLayout
    );
    const keyDown = (event: KeyboardEvent) => this.handleViewportKeyDown(event);
    const pointerDown = (event: PointerEvent) => this.handleViewportPointerDown(event, viewport);
    const pointerMove = (event: PointerEvent) => this.handleViewportPointerMove(event, viewport);
    const pointerUp = (event: PointerEvent) => this.handleViewportPointerUp(event, viewport);
    const lostPointerCapture = (event: PointerEvent) => this.handleViewportPointerCaptureLost(event, viewport);
    viewport.addEventListener("dragover", dragOver);
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("keydown", keyDown);
    viewport.addEventListener("pointerdown", pointerDown);
    viewport.addEventListener("pointermove", pointerMove);
    viewport.addEventListener("pointerup", pointerUp);
    viewport.addEventListener("pointercancel", pointerUp);
    viewport.addEventListener("lostpointercapture", lostPointerCapture);
    const disposeTouch = this.touchController.bindBranchTouch(viewport);
    return () => {
      viewport.removeEventListener("dragover", dragOver);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("keydown", keyDown);
      viewport.removeEventListener("pointerdown", pointerDown);
      viewport.removeEventListener("pointermove", pointerMove);
      viewport.removeEventListener("pointerup", pointerUp);
      viewport.removeEventListener("pointercancel", pointerUp);
      viewport.removeEventListener("lostpointercapture", lostPointerCapture);
      disposeTouch();
    };
  }

  private bindOverviewViewport(viewport: HTMLElement): () => void {
    const pointerDown = (event: PointerEvent) => this.handleOverviewPointerDown(event);
    const pointerMove = (event: PointerEvent) => this.handleOverviewPointerMove(event);
    const pointerUp = (event: PointerEvent) => this.handleOverviewPointerUp(event);
    const lostPointerCapture = () => this.cleanupOverviewPan();
    const wheel = (event: WheelEvent) => this.handleOverviewWheel(event);
    const keyDown = (event: KeyboardEvent) => this.handleOverviewKeyDown(event);
    viewport.addEventListener("pointerdown", pointerDown);
    viewport.addEventListener("pointermove", pointerMove);
    viewport.addEventListener("pointerup", pointerUp);
    viewport.addEventListener("pointercancel", pointerUp);
    viewport.addEventListener("lostpointercapture", lostPointerCapture);
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("keydown", keyDown);
    const disposeTouch = this.touchController.bindOverviewTouch(viewport);
    return () => {
      viewport.removeEventListener("pointerdown", pointerDown);
      viewport.removeEventListener("pointermove", pointerMove);
      viewport.removeEventListener("pointerup", pointerUp);
      viewport.removeEventListener("pointercancel", pointerUp);
      viewport.removeEventListener("lostpointercapture", lostPointerCapture);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("keydown", keyDown);
      disposeTouch();
      this.cleanupOverviewPan();
    };
  }

  private handleOverviewPointerDown(event: PointerEvent): void {
    this.overviewViewport.handleOverviewPointerDown(event);
  }

  private handleOverviewPointerMove(event: PointerEvent): void {
    this.overviewViewport.handleOverviewPointerMove(event);
  }

  private handleOverviewPointerUp(event: PointerEvent): void {
    this.overviewViewport.handleOverviewPointerUp(event);
  }

  private handleOverviewWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey) || !this.plugin.settings.enableCtrlWheelZoom) {
      return;
    }
    event.preventDefault();
    this.zoomController.queueOverviewWheel(event.deltaY);
  }

  private handleOverviewKeyDown(event: KeyboardEvent): void {
    this.navigationController.handleOverviewKeyDown(event);
  }

  private syncOverviewZoom(): void {
    this.overviewViewport.syncOverviewZoom();
  }

  private resetViewFromZoomIndicator(): void {
    this.zoomController.clearOverviewZoomFrame();
    this.zoomController.updateZoomLevel(1);
    if (this.presentationMode !== "overview") {
      return;
    }
    this.work.frame(window, () => this.centerOverviewOnSelectedBlock());
  }

  private centerOverviewOnSelectedBlock(): void {
    this.overviewViewport.centerOverviewOnSelectedBlock();
  }

  private revealOverviewSelectedCard(selectedCard: HTMLElement): void {
    this.overviewViewport.revealOverviewSelectedCard(selectedCard);
  }

  private preserveOverviewViewportPosition(): void {
    this.overviewViewport.preserve();
  }

  private restoreOverviewViewportPosition(): void {
    this.overviewViewport.restore();
  }

  private cleanupOverviewPan(): void {
    this.overviewViewport.cleanupOverviewPan();
  }

  private setHoveredBlock(blockId: BranchBlockId | null): void {
    if (this.hoveredBlockId === blockId) {
      return;
    }

    this.hoveredBlockId = blockId;
    this.syncHoverLinkedState();
  }

  private openSearchOverlay(): void {
    this.search.openSearchOverlay();
  }

  private closeSearchOverlay(): void {
    this.search.closeSearchOverlay();
  }

  private handleSearchShortcut(event: KeyboardEvent): boolean {
    return this.search.handleSearchShortcut(event);
  }

  private handleHistoryShortcut(event: KeyboardEvent): boolean {
    return this.navigationController.handleHistoryShortcut(event);
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

  private wireEditorElement(editor: HTMLTextAreaElement, block: BranchBlock, origin: EditingOrigin): void {
    this.editor.wireEditorElement(editor, block, origin);
  }

  private resizeEditor(textarea: HTMLTextAreaElement): void {
    this.editor.resizeEditor(textarea);
  }

  private async applyMutation(
    label: string,
    mutate: (metadata: BranchTreeMetadata) => BranchTreeMutationResult,
    autofocusSelection = false
  ): Promise<void> {
    await this.awaitDeferredReload();
    await this.documentController.applyMutation(label, mutate, autofocusSelection);
  }

  private prepareDocumentMutation(autofocusSelection: boolean): void {
    const state = this.state;
    if (!state) return;
    this.pendingFocusBlockId = state.selectedBlockId;
    this.pendingScrollBlockId = state.selectedBlockId;
    this.overview.requestKeyboardFocusAfterMutation(
      this.presentationMode === "overview" &&
      this.overview.getElements().viewport?.contains(this.contentEl.ownerDocument.activeElement) === true
    );

    if (autofocusSelection && state.selectedBlockId) {
      const block = getBlock(state.metadata, state.selectedBlockId);
      if (block) {
        this.editor.prepareCreatedBlock(block, this.presentationMode === "overview" ? "overview" : "card");
      }
    }
  }

  private async commitEditIfNeeded(): Promise<void> {
    if (this.reloadRequired && !this.editingSession) await this.reloadAfterEdit();
    await this.editor.commitEditIfNeeded();
    if (this.reloadRequired && !this.editingSession) await this.reloadAfterEdit();
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
    this.documentController.setSelection(session.blockId);
    this.pendingFocusBlockId = session.blockId;
    this.syncTouchDock();
    const block = getBlock(this.state.metadata, session.blockId);
    if (session.origin === "overview" && block && this.overview.openOverviewEditorInPlace(block)) return;
    if (session.origin === "overview") this.preserveOverviewViewportPosition();
    this.render();
  }

  private onEditorCancel(session: EditingSession | null): void {
    this.reloadRequired = true;
    void this.reloadAfterEdit().catch(error => this.reportActionError(error));
    this.pendingFocusBlockId = this.state?.selectedBlockId ?? null;
    this.syncTouchDock();
    if (session?.origin === "overview") {
      void this.overview.restoreOverviewCardContentInPlace(session.blockId).catch(error => this.reportActionError(error));
      return;
    }
    this.render();
  }

  private async onEditorUnchanged(session: EditingSession): Promise<void> {
    this.pendingFocusBlockId = session.blockId;
    this.syncTouchDock();
    if (session.origin === "overview") {
      await this.overview.restoreOverviewCardContentInPlace(session.blockId);
      return;
    }
    this.render();
  }

  private async saveEditorSession(session: EditingSession): Promise<void> {
    await this.documentController.commitEditedBlock(session);
  }

  private onEditorCommitted(session: EditingSession): void {
    this.pendingFocusBlockId = session.blockId;
    this.syncTouchDock();
    this.render();
  }

  private reloadRequired = false;
  private reloadPending: Promise<void> | null = null;

  private async awaitDeferredReload(): Promise<void> {
    const file = this.file;
    if (this.reloadRequired && !this.editingSession) await this.reloadAfterEdit();
    if (this.file !== file) throw new DocumentLoadChangedError();
  }

  private reloadAfterEdit(): Promise<void> {
    if (this.reloadPending) return this.reloadPending;
    const file = this.file;
    const generation = this.loadGeneration;
    const reload = (async () => {
      if (!file) return;
      const text = await this.app.vault.cachedRead(file);
      if (this.file !== file || this.loadGeneration !== generation) return;
      if (!this.documentController.syncOrientationOnlyChange(text)) await this.onLoadFile(file);
      this.reloadRequired = false;
    })().finally(() => { if (this.reloadPending === reload) this.reloadPending = null; });
    this.reloadPending = reload;
    return reload;
  }

  private reportActionError(error: unknown): void {
    console.error("[Arbor] Action failed", error);
    new Notice("Arbor could not complete the action. Unsaved drafts are retained.");
  }

  private showDraftRecovery(): void {
    const file = this.file;
    const store = this.plugin.draftRecoveryStore;
    if (!file || !store || !this.state || this.editingSession) return;
    const drafts = store.getForFile(file.path);
    if (!drafts.length) return;
    const generation = this.loadGeneration;
    const modal = new Modal(this.app);
    modal.contentEl.createEl("h3", { text: "Recover unsaved drafts" });
    modal.contentEl.createEl("p", { text: "Restore opens a draft for review; it does not save or overwrite the note. Each draft is a separate editing session." });
    for (const draft of drafts) {
      const row = modal.contentEl.createDiv();
      row.createEl("h4", { text: `Block ${draft.blockId} · draft ${draft.draftId}` });
      const block = getBlock(this.state.metadata, draft.blockId);
      const current = row.createEl("textarea", { attr: { readonly: "", "aria-label": "Current block content" } });
      current.value = block?.content ?? "This block no longer exists. Copy the draft to keep its text.";
      const recovered = row.createEl("textarea", { attr: { readonly: "", "aria-label": "Recovered draft" } });
      recovered.value = draft.value;
      new ButtonComponent(row).setButtonText("Restore").setDisabled(!block).onClick(() => {
        if (this.file !== file || this.loadGeneration !== generation) {
          new Notice("The note changed. Reopen recovery to review the current content.");
          return;
        }
        if (this.editor.restoreDraft(draft.draftId, draft.blockId, this.presentationMode === "overview" ? "overview" : "card")) modal.close();
        else new Notice("Finish or cancel the current draft before restoring another.");
      });
      new ButtonComponent(row).setButtonText("Copy").onClick(async () => {
        try { await this.contentEl.win.navigator.clipboard.writeText(draft.value); }
        catch (error) { this.reportActionError(error); }
      });
      new ButtonComponent(row).setButtonText("Discard").onClick(() => {
        store.remove(draft.draftId);
        row.remove();
        if (!store.getForFile(file.path).length) modal.close();
      });
    }
    new ButtonComponent(modal.contentEl).setButtonText("Later").onClick(() => modal.close());
    modal.open();
  }

  private resetViewState(): void {
    this.work.reset();
    this.navigationController.clearNumericNavigation();
    this.clearBlurCommitTimer();
    this.zoomController.reset();
    this.branchViewport.reset();
    this.dragDropController.reset();
    this.documentController.reset();
    this.editor.reset();
    this.search.reset();
    this.preview.reset();
    this.output.reset();
    this.hoveredBlockId = null;
    this.viewContext = null;
    this.loadingState = null;
    this.overviewViewport.reset();
    this.overview.reset();
    this.teardownShell();
  }

  private async persistState(reason: string): Promise<void> {
    await this.documentController.persistState(reason);
  }

  private async applyOutputMutation(
    label: string,
    mutate: (profile: ArborOutputProfile) => ArborOutputProfile
  ): Promise<void> {
    await this.awaitDeferredReload();
    await this.documentController.applyOutputMutation(label, mutate);
  }

  private syncOutputCardPresentation(
    card: HTMLElement,
    blockId: BranchBlockId,
    context: BranchViewContext | null = this.viewContext
  ): void {
    syncCardColour(card, context?.blockColours.get(blockId) ?? null);
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
    this.branchRenderer.forEachCard(syncCard);
    this.overview.forEachCard(syncCard);
  }

  private async runWithSelectedBlock(blockId: BranchBlockId, callback: () => Promise<void>): Promise<void> {
    this.selectBlock(blockId);
    await callback();
  }

  private afterZoom(): void {
    if (this.presentationMode === "overview") {
      this.syncOverviewZoom();
      return;
    }
    if (this.compactLayout) {
      this.syncViewportEdgeFades();
      if (!this.touchController.isBranchPinching()) {
        this.work.frame(window, () => this.revealCompactSelection());
      }
      return;
    }

    this.scheduleColumnAlignment();

    this.work.frame(window, () => {
      this.alignColumnsToActivePath();
      const viewport = this.columnsViewportEl;
      const activeCard = this.columnsEl?.querySelector<HTMLElement>(".arbor-card.is-active");
      if (viewport && activeCard) {
        this.scrollCardIntoHorizontalView(activeCard, viewport);
      }
    });
  }

  private flashZoomIndicator(): void {
    if (!this.zoomIndicatorEl) {
      return;
    }

    this.zoomIndicatorEl.addClass("is-visible");
  }

  private hideZoomIndicator(): void {
    this.zoomIndicatorEl?.removeClass("is-visible");
  }

  private revealCompactSelection(): void { this.branchViewport.revealCompactSelection(); }

  private scheduleColumnAlignment(): void { this.branchViewport.scheduleColumnAlignment(); }

  private applyPendingFocusAndScroll(preservedSceneWidth = 0): void {
    const request = {
      focusBlockId: this.pendingFocusBlockId,
      scrollBlockId: this.pendingScrollBlockId,
      snap: this.shouldSnapViewportAfterDirectionChange,
      preservedSceneWidth
    };
    this.pendingFocusBlockId = null;
    this.pendingScrollBlockId = null;
    this.shouldSnapViewportAfterDirectionChange = false;
    this.branchViewport.applyPendingFocusAndScroll(request);
  }

  private syncViewportEdgeFades(): void { this.branchViewport.syncViewportEdgeFades(); }
  private handleViewportPointerDown(event: PointerEvent, viewport: HTMLElement): void { this.branchViewport.handleViewportPointerDown(event, viewport); }
  private handleViewportPointerMove(event: PointerEvent, viewport: HTMLElement): void { this.branchViewport.handleViewportPointerMove(event, viewport); }
  private handleViewportPointerUp(event: PointerEvent, viewport: HTMLElement): void { this.branchViewport.handleViewportPointerUp(event, viewport); }
  private handleViewportPointerCaptureLost(event: PointerEvent, viewport: HTMLElement): void { this.branchViewport.handleViewportPointerCaptureLost(event, viewport); }
  private cleanupViewportPan(viewport = this.columnsViewportEl, pointerId?: number, releaseCapture = true): void { this.branchViewport.cleanupViewportPan(viewport, pointerId, releaseCapture); }
  private armSceneWidthForPendingScroll(nextColumnCount: number): number { return this.branchViewport.armSceneWidthForPendingScroll(nextColumnCount, this.pendingScrollBlockId); }
  private stopHorizontalScrollMotion(releasePreservedWidth = true): void { this.branchViewport.stopHorizontalScrollMotion(releasePreservedWidth); }
  private scrollCardIntoHorizontalView(card: HTMLElement, viewport: HTMLElement, preservedSceneWidth = 0, snap = false): void { this.branchViewport.scrollCardIntoHorizontalView(card, viewport, preservedSceneWidth, snap); }
  private alignColumnsToActivePath(): void { this.branchViewport.alignColumnsToActivePath(); }

  private async handleEditorPaste(event: ClipboardEvent, textarea: HTMLTextAreaElement): Promise<void> {
    await this.attachments.handleEditorPaste(event, textarea);
  }

  private async handleEditorDrop(event: DragEvent, textarea: HTMLTextAreaElement): Promise<void> {
    await this.attachments.handleEditorDrop(event, textarea);
  }
}
