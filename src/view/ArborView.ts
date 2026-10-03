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
  TFile,
  WorkspaceLeaf
} from "obsidian";
import type ArborPlugin from "../main";
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
  LoadedFileState,
  LoadingOverlayState
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
import { DocumentController } from "./state/DocumentController";
import { ViewWorkScope } from "./runtime/ViewWorkScope";
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
      onEditedBlockSaved: (session) => { this.pendingFocusBlockId = session.blockId; },
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
      getState: () => this.state,
      usesTouchControls: () => this.usesTouchControls,
      getViewportHeight: () => (this.presentationMode === "overview" ? this.overview.getElements().viewport : this.columnsViewportEl)?.clientHeight ?? window.innerHeight,
      onBegin: (session) => this.onEditorBegin(session),
      onCancel: (session) => this.onEditorCancel(session),
      onUnchanged: (session) => this.onEditorUnchanged(session),
      saveEdit: (session) => this.saveEditorSession(session),
      onInput: () => this.scheduleColumnAlignment(),
      handleSearchShortcut: (event) => this.handleSearchShortcut(event),
      paste: (event, textarea) => this.attachments.handleEditorPaste(event, textarea),
      drop: (event, textarea) => this.attachments.handleEditorDrop(event, textarea)
    });
    this.cardLinks = new CardLinkController({
      getSourcePath: () => this.file?.path ?? "",
      paneForEvent: (event) => Keymap.isModEvent(event),
      openInternal: (linktext, sourcePath, pane) => this.app.workspace.openLinkText(linktext, sourcePath, pane),
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
    });
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
      markdown: { render: (markdown, target, sourcePath) => MarkdownRenderer.render(this.app, markdown, target, sourcePath, this) },
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
      read: {
        getState: () => this.state,
        getSettings: () => this.plugin.settings,
        getMode: () => this.presentationMode,
        getFilePath: () => this.file?.path ?? ""
      },
      editor: this.editor,
      markdown: { render: (markdown, target, sourcePath) => MarkdownRenderer.render(this.app, markdown, target, sourcePath, this) },
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
      writeClipboard: (text) => navigator.clipboard.writeText(text),
      showCopyLinkFallback: (text) => this.showCopyLinkFallback(text),
      reportError: (message, error) => console.error(message, error)
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
    return this.documentController.applyActiveOutputProfile(next);
  }

  private async applyOutputProfileMutation(label: string, next: ArborOutputState): Promise<ArborOutputState> {
    return this.documentController.applyOutputProfileMutation(label, next);
  }

  private async resetInvalidOutputProfiles(): Promise<ArborOutputState> {
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

    this.documentController.replaceLoadedState(prepared);
    const state = this.state;
    if (state?.origin === "reconciled") {
      new Notice("The tree was rebuilt from the visible Markdown body to avoid losing plain editor changes.");
    }

    this.resetLoadedUiState(state?.selectedBlockId ?? null);
    this.render();
  }

  async onUnloadFile(): Promise<void> {
    this.invalidatePendingLoads();
    const generation = this.loadGeneration;
    await this.commitEditIfNeeded();
    if (generation !== this.loadGeneration) return;
    this.resetViewState();
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
    this.invalidatePendingLoads();
    await this.commitEditIfNeeded();
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
    return super.onClose();
  }

  async handleFileModified(file: TFile): Promise<void> {
    if (!this.file || file.path !== this.file.path) {
      return;
    }

    if (this.plugin.consumeOwnWrite(file.path) || this.documentController.isWriting()) {
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
    this.documentController.replaceLoadedState(prepared);
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
    this.documentController.replaceLoadedState(initial.state);

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

      this.documentController.replaceLoadedState(migrated.state);
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
    if (this.loadingState) {
      this.loadingState = null;
      this.syncLoadingOverlay();
    }
    return generation;
  }

  private invalidatePendingLoads(): void {
    this.loadGeneration += 1;
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
      this.overview.requestCenterOnNextRender();
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
      void this.renderNow();
    });
  }

  private async renderNow(): Promise<void> {
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
    this.documentController.setSelection(session.blockId);
    this.pendingFocusBlockId = session.blockId;
    this.syncTouchDock();
    const block = getBlock(this.state.metadata, session.blockId);
    if (session.origin === "overview" && block && this.overview.openOverviewEditorInPlace(block)) return;
    if (session.origin === "overview") this.preserveOverviewViewportPosition();
    this.render();
  }

  private onEditorCancel(session: EditingSession | null): void {
    this.pendingFocusBlockId = this.state?.selectedBlockId ?? null;
    this.syncTouchDock();
    if (session?.origin === "overview") {
      void this.overview.restoreOverviewCardContentInPlace(session.blockId);
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
    await this.documentController.applyOutputMutation(label, mutate);
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
