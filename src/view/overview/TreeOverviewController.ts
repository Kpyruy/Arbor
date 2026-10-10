import { getActivePath, getBlock } from "../../model/tree";
import { buildOverviewLayout } from "../../model/overviewLayout";
import { resolveOverviewCardSelectionState, startOverviewSelectionAnimation } from "../../overviewNavigation";
import { extractSnippet } from "../../utils";
import type { ArborOverviewOrientation, BranchBlock, BranchBlockId } from "../../types";
import { applyOverviewLayout } from "./overviewDom";
import { ViewWorkScope } from "../runtime/ViewWorkScope";
import { projectOverviewSubtree } from "./overviewFocus";
import { findRenderedCardLink } from "../navigation/CardLinkController";
import { hasMeaningfulRenderedContent } from "../renderedContent";
import type { BranchViewContext, EditingSession, EditorPort, MarkdownPort, OverviewEditorSelectionSnapshot, SelectionPort, ViewReadPort } from "../state/viewTypes";

export interface TreeOverviewPort {
  getFocusRootId?(): BranchBlockId | null;
  read: ViewReadPort;
  editor: EditorPort;
  markdown: MarkdownPort;
  selection: SelectionPort;
  getBody(): HTMLElement | null;
  getContext(): BranchViewContext | null;
  getOverviewOrientation(): ArborOverviewOrientation;
  captureOverviewEditorSelection?(): OverviewEditorSelectionSnapshot | null;
  restoreOverviewEditorSelection?(saved: OverviewEditorSelectionSnapshot): void;
  bindViewport(viewport: HTMLElement): () => void;
  openBlockMenu(id: BranchBlockId, event: MouseEvent): void;
  setHoveredBlock(id: BranchBlockId | null): void;
  restoreViewport(): void;
  centerSelected(): void;
  revealSelected(card: HTMLElement): void;
  syncTouchDock(): void;
  requestRender(): void;
  waitForNextPaint(): Promise<void>;
  syncOutputCardPresentation(card: HTMLElement, blockId: BranchBlockId, context: BranchViewContext | null): void;
  consumeAutofocus(session: NonNullable<ReturnType<EditorPort["getSession"]>>): void;
  clearPendingFocus(): void;
  tryHandleCardLink(event: MouseEvent, card: HTMLElement): boolean;
}

export class TreeOverviewController {
  private overviewStageEl: HTMLElement | null = null;
  private overviewViewportEl: HTMLElement | null = null;
  private overviewSceneEl: HTMLElement | null = null;
  private overviewSurfaceEl: HTMLElement | null = null;
  private overviewRenderVersion = 0;
  private overviewSelectionAnimation: Animation | null = null;
  private shouldCenterOverviewOnNextRender = false;
  private shouldRevealOverviewOnNextRender = false;
  private shouldRestoreOverviewKeyboardFocusAfterMutation = false;
  private viewportDisposer: (() => void) | null = null;
  private readonly work = new ViewWorkScope();

  constructor(private readonly port: TreeOverviewPort) {}

  invalidate(): void {
    this.overviewRenderVersion += 1;
    this.work.reset();
  }

  getElements(): { stage: HTMLElement | null; viewport: HTMLElement | null; scene: HTMLElement | null; surface: HTMLElement | null } {
    return {
      stage: this.overviewStageEl,
      viewport: this.overviewViewportEl,
      scene: this.overviewSceneEl,
      surface: this.overviewSurfaceEl
    };
  }

  async syncTreeOverview(): Promise<void> {
    const body = this.port.getBody();
    const state = this.port.read.getState();
    if (!body || !state) {
      return;
    }
    const workToken = this.work.token();
    const filePath = this.port.read.getFilePath();
    const renderSession = this.port.editor.getSession();

    if (!this.overviewStageEl || !this.overviewViewportEl || !this.overviewSceneEl || !this.overviewSurfaceEl) {
      this.overviewStageEl = body.createDiv({ cls: "arbor-overview-stage" });
      this.overviewViewportEl = this.overviewStageEl.createDiv({ cls: "arbor-overview-viewport" });
      this.overviewViewportEl.tabIndex = 0;
      this.overviewSceneEl = this.overviewViewportEl.createDiv({ cls: "arbor-overview-scene" });
      this.overviewSurfaceEl = this.overviewSceneEl.createDiv({ cls: "arbor-overview-surface" });
      this.viewportDisposer = this.port.bindViewport(this.overviewViewportEl);
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
    const settings = this.port.read.getSettings();
    const zoom = settings.zoomLevel;
    const direction = settings.layoutDirection;
    const orientation = this.port.getOverviewOrientation();

    const focusRootId = this.port.getFocusRootId?.() ?? null;
    const initialLayout = buildOverviewLayout(projectOverviewSubtree(state.metadata, focusRootId), {
      cardWidth: settings.cardWidth,
      direction,
      orientation
    });
    const selectedBlockId = state.selectedBlockId;
    const activePathIds = new Set(getActivePath(state.metadata, selectedBlockId).map((block) => block.id));
    const cardsById = new Map<BranchBlockId, HTMLElement>();
    const measuredHeights = new Map<BranchBlockId, number>();
    const stagedEditors = new Map<HTMLTextAreaElement, EditingSession>();

    for (const node of initialLayout.nodes) {
      const block = getBlock(state.metadata, node.id);
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
      const session = this.port.editor.getSession();
      const isEditingCard = session?.blockId === block.id && session.origin === "overview";
      if (isEditingCard && session) {
        card.addClass("is-editing");
        const editor = card.createEl("textarea", { cls: "arbor-editor arbor-overview-editor-input" });
        this.port.editor.wireEditorElement(editor, block, "overview");
        editor.value = session.value;
        this.port.editor.resizeEditor(editor);
        stagedEditors.set(editor, session);
      } else {
        const content = card.createDiv({ cls: "arbor-overview-card-content markdown-rendered" });
        await this.port.markdown.render(block.content, content, this.port.read.getFilePath());
        if (!this.work.isCurrent(workToken) || overviewRenderVersion !== this.overviewRenderVersion
          || this.port.read.getState() !== state || this.port.read.getFilePath() !== filePath
          || this.port.getOverviewOrientation() !== orientation || this.port.read.getSettings().layoutDirection !== direction) {
          surface.remove();
          return;
        }
        if (!hasMeaningfulRenderedContent(content)) {
          content.setText(extractSnippet(block.content, settings.previewSnippetLength));
        }
        content.querySelectorAll("img").forEach((image) => {
          image.addEventListener("load", () => {
            if (card.isConnected && this.overviewSurfaceEl?.contains(card)) this.port.requestRender();
          }, { once: true });
        });
      }
      this.port.syncOutputCardPresentation(card, block.id, this.port.getContext());
      card.addEventListener("pointerdown", (event) => event.stopPropagation());
      card.addEventListener("click", (event) => {
        if (this.port.tryHandleCardLink(event, card)) return;
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("a, button, input, textarea")) {
          return;
        }
        this.port.selection.selectBlock(node.id, { focus: false, reveal: false });
      });
      card.addEventListener("auxclick", (event) => {
        this.port.tryHandleCardLink(event, card);
      });
      card.addEventListener("dblclick", (event) => {
        if (findRenderedCardLink(event.target, card)) return;
        event.stopPropagation();
        this.port.editor.beginEditingBlock(node.id, "overview");
      });
      card.addEventListener("contextmenu", (event) => {
        if (findRenderedCardLink(event.target, card)) return;
        event.preventDefault();
        event.stopPropagation();
        this.port.selection.selectBlock(node.id, { focus: false });
        this.port.openBlockMenu(node.id, event);
      });
      card.addEventListener("mouseenter", () => this.port.setHoveredBlock(node.id));
      card.addEventListener("mouseleave", () => this.port.setHoveredBlock(null));
      cardsById.set(node.id, card);
    }

    await this.port.waitForNextPaint();
    if (overviewRenderVersion !== this.overviewRenderVersion) {
      surface.remove();
      return;
    }
    if (!this.work.isCurrent(workToken) || this.port.read.getState() !== state || this.port.read.getFilePath() !== filePath
      || this.port.getOverviewOrientation() !== orientation || this.port.read.getSettings().layoutDirection !== direction) {
      surface.remove();
      return;
    }
    if (this.port.editor.getSession() !== renderSession) {
      surface.remove();
      this.port.requestRender();
      return;
    }
    stagedEditors.forEach((session, editor) => {
      editor.value = session.value;
      this.port.editor.resizeEditor(editor);
    });
    cardsById.forEach((card, blockId) => {
      measuredHeights.set(blockId, orientation === "horizontal" ? card.scrollHeight : Math.max(card.offsetHeight, card.scrollHeight));
      card.removeClass("is-measuring");
    });

    const currentState = this.port.read.getState();
    const currentSettings = this.port.read.getSettings();
    if (!currentState) {
      surface.remove();
      return;
    }
    const layout = buildOverviewLayout(projectOverviewSubtree(currentState.metadata, focusRootId), {
      cardWidth: currentSettings.cardWidth,
      cardHeights: measuredHeights,
      direction,
      orientation
    });
    applyOverviewLayout(scene, surface, cardsById, layout, currentSettings.zoomLevel, direction, orientation);
    const savedSelection = this.port.captureOverviewEditorSelection?.() ?? null;
    previousSurface.remove();
    surface.removeClass("is-staging");
    this.overviewSurfaceEl = surface;
    this.syncOverviewSelection(false);

    const isCurrentPublication = () => this.work.isCurrent(workToken) && overviewRenderVersion === this.overviewRenderVersion
      && this.port.read.getState() === state && this.port.read.getFilePath() === filePath
      && this.port.getOverviewOrientation() === orientation && this.port.read.getSettings().layoutDirection === direction
      && this.overviewSurfaceEl === surface && surface.isConnected;
    if (savedSelection && savedSelection.session === this.port.editor.getSession()) {
      this.port.restoreOverviewEditorSelection?.(savedSelection);
      if (savedSelection.focused || !savedSelection.session.autofocus) this.port.consumeAutofocus(savedSelection.session);
    }
    stagedEditors.forEach((session, editor) => {
      if (!session.autofocus) return;
      this.work.frame(window, () => {
        if (!isCurrentPublication() || this.port.editor.getSession() !== session || !session.autofocus) return;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(editor.value.length, editor.value.length);
        this.port.revealSelected(editor.closest<HTMLElement>(".arbor-overview-card")!);
        this.port.consumeAutofocus(session);
      });
    });

    viewport.toggleClass("is-zoomed-out", currentSettings.zoomLevel < 0.78);
    this.port.restoreViewport();
    if (savedSelection?.focused || renderSession?.autofocus) this.shouldCenterOverviewOnNextRender = false;
    if (this.shouldCenterOverviewOnNextRender) {
      this.work.frame(window, () => {
        if (!isCurrentPublication() || !this.shouldCenterOverviewOnNextRender) return;
        this.shouldCenterOverviewOnNextRender = false;
        this.shouldRevealOverviewOnNextRender = false;
        this.port.centerSelected();
      });
    } else if (this.shouldRevealOverviewOnNextRender) {
      this.work.frame(window, () => {
        if (!isCurrentPublication() || !this.shouldRevealOverviewOnNextRender) return;
        this.shouldRevealOverviewOnNextRender = false;
        const selectedCard = surface.querySelector<HTMLElement>(".arbor-overview-card.is-active");
        if (selectedCard) this.port.revealSelected(selectedCard);
      });
    }
    this.restoreOverviewKeyboardFocusAfterMutation();
    this.port.syncTouchDock();
  }

  syncOverviewSelection(selectionChanged: boolean): void {
    const state = this.port.read.getState();
    if (!state || !this.overviewSurfaceEl) {
      return;
    }

    const selectedBlockId = state.selectedBlockId;
    const activePathIds = new Set(getActivePath(state.metadata, selectedBlockId).map((block) => block.id));
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
      this.port.revealSelected(selectedCard);
    }
  }

  openOverviewEditorInPlace(block: BranchBlock): boolean {
    const card = this.overviewSurfaceEl?.querySelector<HTMLElement>(`.arbor-overview-card[data-block-id="${block.id}"]`);
    const session = this.port.editor.getSession();
    if (!card || !session || session.blockId !== block.id || session.origin !== "overview") {
      return false;
    }

    card.empty();
    card.addClass("is-editing");
    const editor = card.createEl("textarea", { cls: "arbor-editor arbor-overview-editor-input" });
    this.port.editor.wireEditorElement(editor, block, "overview");
    editor.value = session.value;
    this.port.editor.resizeEditor(editor);
    this.reflowOverviewCard(block.id);
    this.port.syncOutputCardPresentation(card, block.id, this.port.getContext());
    const state = this.port.read.getState();
    const filePath = this.port.read.getFilePath();
    this.work.frame(window, () => {
      if (this.port.editor.getSession() !== session || !session.autofocus || this.port.read.getState() !== state
        || this.port.read.getFilePath() !== filePath || !card.isConnected || !this.overviewSurfaceEl?.contains(card)) {
        return;
      }
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(editor.value.length, editor.value.length);
      this.port.editor.resizeEditor(editor);
      this.reflowOverviewCard(block.id);
      this.port.revealSelected(card);
      this.port.consumeAutofocus(session);
    });
    return true;
  }

  async restoreOverviewCardContentInPlace(blockId: BranchBlockId): Promise<void> {
    const card = this.overviewSurfaceEl?.querySelector<HTMLElement>(`.arbor-overview-card[data-block-id="${blockId}"]`);
    const state = this.port.read.getState();
    const workToken = this.work.token();
    const filePath = this.port.read.getFilePath();
    const block = state ? getBlock(state.metadata, blockId) : null;
    if (!card || !block) {
      return;
    }

    card.empty();
    card.removeClass("is-editing");
    const content = card.createDiv({ cls: "arbor-overview-card-content markdown-rendered" });
    await this.port.markdown.render(block.content, content, this.port.read.getFilePath());
    if (!this.work.isCurrent(workToken) || this.port.read.getState() !== state || this.port.read.getFilePath() !== filePath || !this.overviewSurfaceEl?.contains(card)) {
      return;
    }
    if (!hasMeaningfulRenderedContent(content)) {
      content.setText(extractSnippet(block.content, this.port.read.getSettings().previewSnippetLength));
    }
    content.querySelectorAll("img").forEach((image) => {
      image.addEventListener("load", () => this.port.requestRender(), { once: true });
    });
    this.port.syncOutputCardPresentation(card, block.id, this.port.getContext());
    this.reflowOverviewCard(block.id);
    card.focus({ preventScroll: true });
  }

  reflowOverviewCard(blockId: BranchBlockId): void {
    const state = this.port.read.getState();
    const { scene, surface, viewport } = this.getElements();
    const changedCard = surface?.querySelector<HTMLElement>(`.arbor-overview-card[data-block-id="${blockId}"]`);
    if (!state || !scene || !surface || !viewport || !changedCard) return;
    const settings = this.port.read.getSettings();
    const orientation = this.port.getOverviewOrientation();
    const selected = surface.querySelector<HTMLElement>(".arbor-overview-card.is-active");
    const previousLeft = selected?.offsetLeft ?? 0;
    const previousTop = selected?.offsetTop ?? 0;
    const position = { left: viewport.scrollLeft, top: viewport.scrollTop };
    const cards = new Map<BranchBlockId, HTMLElement>();
    const heights = new Map<BranchBlockId, number>();
    changedCard.addClass("is-measuring");
    surface.querySelectorAll<HTMLElement>(".arbor-overview-card[data-block-id]").forEach(card => {
      const id = card.dataset.blockId!;
      cards.set(id, card);
      heights.set(id, card === changedCard
        ? Math.max(card.offsetHeight, card.scrollHeight)
        : Number.parseFloat(card.style.getPropertyValue("--arbor-overview-card-height")) || card.offsetHeight);
    });
    changedCard.removeClass("is-measuring");
    const layout = buildOverviewLayout(projectOverviewSubtree(state.metadata, this.port.getFocusRootId?.() ?? null), {
      cardWidth: settings.cardWidth, cardHeights: heights, direction: settings.layoutDirection, orientation
    });
    applyOverviewLayout(scene, surface, cards, layout, settings.zoomLevel, settings.layoutDirection, orientation);
    viewport.scrollTo({
      left: position.left + ((selected?.offsetLeft ?? 0) - previousLeft) * settings.zoomLevel,
      top: position.top + ((selected?.offsetTop ?? 0) - previousTop) * settings.zoomLevel,
      behavior: "auto"
    });
  }

  requestCenterOnNextRender(requested = true): void {
    this.shouldCenterOverviewOnNextRender = requested;
  }

  requestRevealOnNextRender(): void {
    this.shouldRevealOverviewOnNextRender = true;
  }

  requestKeyboardFocusAfterMutation(requested = true): void {
    this.shouldRestoreOverviewKeyboardFocusAfterMutation = requested;
  }

  forEachCard(callback: (card: HTMLElement) => void): void {
    this.overviewSurfaceEl?.querySelectorAll<HTMLElement>(".arbor-overview-card[data-block-id]").forEach(callback);
  }

  hide(): void {
    this.overviewStageEl?.setCssStyles({ display: "none" });
  }

  reset(): void {
    this.invalidate();
    this.viewportDisposer?.();
    this.viewportDisposer = null;
    this.overviewSelectionAnimation?.cancel();
    this.overviewSelectionAnimation = null;
    this.overviewStageEl?.remove();
    this.overviewStageEl = null;
    this.overviewViewportEl = null;
    this.overviewSceneEl = null;
    this.overviewSurfaceEl = null;
    this.shouldCenterOverviewOnNextRender = false;
    this.shouldRevealOverviewOnNextRender = false;
    this.shouldRestoreOverviewKeyboardFocusAfterMutation = false;
  }

  private animateOverviewSelectedCard(selectedCard: HTMLElement): void {
    this.overviewSelectionAnimation = startOverviewSelectionAnimation(
      selectedCard,
      this.overviewSelectionAnimation,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  private restoreOverviewKeyboardFocusAfterMutation(): void {
    if (!this.shouldRestoreOverviewKeyboardFocusAfterMutation) {
      return;
    }
    this.work.frame(window, () => {
      if (!this.shouldRestoreOverviewKeyboardFocusAfterMutation) return;
      this.shouldRestoreOverviewKeyboardFocusAfterMutation = false;
      this.port.clearPendingFocus();
      this.overviewViewportEl?.focus({ preventScroll: true });
    });
  }
}
