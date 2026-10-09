import { runAsyncAction } from "../runtime/asyncActions";
import { Menu, Platform, setIcon } from "obsidian";
import type { ArborLayoutDirection, ArborOverviewOrientation, ArborPresentationMode } from "../../types";
import { getChildArrowIcon, getParentArrowIcon } from "../../layoutDirection";
import { getOverviewDirectionKeys, type OverviewArrowKey } from "../../overviewOrientation";
import {
  getNextSibling,
  getParentBlock,
  getPreferredChildBlock,
  getPreviousSibling
} from "../../model/tree";
import { CARD_PREVIEW_MAX_HEIGHT_PX } from "../../cardViewport";
import { ARBOR_THEME_VARIABLES } from "../../theme";
import { createOutputProfileButton, getOutputProfileButtonPresentation } from "../OutputProfilesModal";
import type { EditingSession, LoadingOverlayState, ViewReadPort } from "../state/viewTypes";
import { useCompactLayout } from "../../mobile";
import { ViewWorkScope } from "../runtime/ViewWorkScope";
import { OutputProfileLabel } from "./OutputProfileLabel";

export interface ShellElements {
  readonly root: HTMLElement;
  readonly frameEl: HTMLElement | null;
  readonly bodyEl: HTMLElement | null;
  readonly columnsStageEl: HTMLElement | null;
  readonly columnsViewportEl: HTMLElement | null;
  readonly columnsEl: HTMLElement | null;
  readonly outputStageEl: HTMLElement | null;
  readonly breadcrumbsEl: HTMLElement | null;
  readonly breadcrumbExitLayerEl: HTMLElement | null;
  readonly zoomIndicatorEl: HTMLButtonElement | null;
  readonly modeControlsEl: HTMLElement | null;
  readonly outputProfileButtonEl: HTMLButtonElement | null;
  readonly overviewButtonEl: HTMLButtonElement | null;
  readonly markdownButtonEl: HTMLButtonElement | null;
  readonly themeButtonEl: HTMLButtonElement | null;
  readonly viewMenuButtonEl: HTMLButtonElement | null;
}

export interface ToolbarActions {
  resetZoom(): void;
  openMarkdown(): Promise<void>;
  openThemeStudio(): void;
  openViewMenu(event: MouseEvent): void;
  openOutputProfileMenu(event: MouseEvent): void;
  toggleOverview(): void;
}

export interface DockActions {
  selectParent(): void;
  selectPrevious(): void;
  selectNext(): void;
  selectChild(): void;
  edit(): void;
  cancel(): void;
  save(): Promise<void>;
  createRoot(): Promise<void>;
  createChild(): Promise<void>;
  createSibling(): Promise<void>;
  openBlockMenu(): void;
  clearBlurCommitTimer(): void;
}

export interface ShellPort {
  read: ViewReadPort;
  getOverviewOrientation(): ArborOverviewOrientation;
  getSession(): EditingSession | null;
  getLoadingState(): LoadingOverlayState | null;
  getThemeVariables(): Record<string, string>;
  getLastScroll(): { left: number; top: number };
  onScroll(position: { left: number; top: number }): void;
  bindBranchViewport(element: HTMLElement): () => void;
  toolbar: ToolbarActions;
  dock: DockActions;
  onCompactChange(compact: boolean): void;
  resizeEditors(): void;
  onResizeDuringEdit(): void;
  onDirectionApplied(direction: ArborLayoutDirection): void;
}

export class ViewShell {
  private elements: ShellElements;
  private touchDockEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private loadingOverlayEl: HTMLElement | null = null;
  private disposeBranchViewport: (() => void) | null = null;
  private outputProfileLabel: OutputProfileLabel | null = null;
  private compactLayout = false;
  private readonly work = new ViewWorkScope();

  constructor(private readonly contentEl: HTMLElement, private readonly port: ShellPort) {
    this.elements = this.emptyElements();
  }

  ensureShell(): void {
    if (
      this.elements.frameEl &&
      this.elements.columnsStageEl &&
      this.elements.columnsViewportEl &&
      this.elements.columnsEl &&
      this.elements.bodyEl &&
      this.elements.breadcrumbsEl &&
      this.elements.breadcrumbExitLayerEl &&
      this.elements.modeControlsEl &&
      this.elements.outputProfileButtonEl &&
      this.bannerEl &&
      this.loadingOverlayEl &&
      this.elements.outputStageEl
    ) {
      return;
    }

    const state = this.port.read.getState();
    if (!state) {
      return;
    }

    this.outputProfileLabel?.dispose();
    this.outputProfileLabel = null;
    this.contentEl.empty();
    this.contentEl.addClass("arbor-view");
    this.applyViewClasses(this.contentEl);

    const frameEl = this.contentEl.createDiv({ cls: "arbor-frame" });
    const breadcrumbsEl = frameEl.createDiv({ cls: "arbor-breadcrumbs" });
    const breadcrumbExitLayerEl = frameEl.createDiv({ cls: "arbor-breadcrumb-exit-layer" });
    const zoomIndicatorEl = frameEl.createEl("button", {
      cls: "arbor-zoom-indicator",
      attr: { type: "button", "aria-label": "Reset zoom to 100%" }
    });
    zoomIndicatorEl.addEventListener("click", () => this.port.toolbar.resetZoom());
    zoomIndicatorEl.addEventListener("mousedown", (event) => event.stopPropagation());
    const markdownButtonEl = frameEl.createEl("button", {
      cls: "arbor-markdown-button",
      attr: { type: "button", "aria-label": "Open in Markdown" }
    });
    setIcon(markdownButtonEl, "file-text");
    markdownButtonEl.addEventListener("click", () => runAsyncAction(this.port.toolbar.openMarkdown()));
    markdownButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    const themeButtonEl = frameEl.createEl("button", {
      cls: "arbor-theme-button",
      attr: { type: "button", "aria-label": "Open theme studio" }
    });
    setIcon(themeButtonEl, "palette");
    themeButtonEl.addEventListener("click", () => this.port.toolbar.openThemeStudio());
    themeButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    const viewMenuButtonEl = frameEl.createEl("button", {
      cls: "arbor-view-menu-button",
      attr: { type: "button", "aria-label": "Open view menu" }
    });
    setIcon(viewMenuButtonEl, "sliders-horizontal");
    viewMenuButtonEl.addEventListener("click", (event) => this.port.toolbar.openViewMenu(event));
    viewMenuButtonEl.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    this.bannerEl = frameEl.createDiv({ cls: "arbor-banner" });
    this.loadingOverlayEl = frameEl.createDiv({ cls: "arbor-loading-overlay" });
    const bodyEl = frameEl.createDiv({ cls: "arbor-body" });
    const modeControlsEl = bodyEl.createDiv({ cls: "arbor-mode-controls" });
    const outputProfileButtonEl = createOutputProfileButton(modeControlsEl, state.outputState);
    this.outputProfileLabel = new OutputProfileLabel(outputProfileButtonEl);
    outputProfileButtonEl.addEventListener("click", (event) => {
      this.port.toolbar.openOutputProfileMenu(event);
    });
    outputProfileButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    const overviewButtonEl = modeControlsEl.createEl("button", {
      cls: "arbor-overview-button",
      attr: { type: "button", "aria-label": "Open tree overview" }
    });
    setIcon(overviewButtonEl, "map");
    overviewButtonEl.addEventListener("click", () => this.port.toolbar.toggleOverview());
    overviewButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
    const columnsStageEl = bodyEl.createDiv({ cls: "arbor-columns-stage" });
    const columnsViewportEl = columnsStageEl.createDiv({ cls: "arbor-columns-viewport" });
    columnsViewportEl.tabIndex = 0;
    const scroll = this.port.getLastScroll();
    columnsViewportEl.scrollLeft = scroll.left;
    columnsViewportEl.scrollTop = scroll.top;
    columnsViewportEl.addEventListener(
      "scroll",
      () => {
        this.port.onScroll({
          left: columnsViewportEl.scrollLeft,
          top: columnsViewportEl.scrollTop
        });
      },
      { passive: true }
    );
    this.disposeBranchViewport = this.port.bindBranchViewport(columnsViewportEl);
    const columnsEl = columnsViewportEl.createDiv({ cls: "arbor-columns" });
    const viewportFadesEl = columnsStageEl.createDiv({ cls: "arbor-viewport-fades" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-top" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-right" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-bottom" });
    viewportFadesEl.createDiv({ cls: "arbor-edge-fade is-left" });
    const outputStageEl = bodyEl.createDiv({ cls: "arbor-output-preview-stage" });
    outputStageEl.setCssStyles({ display: "none" });
    this.elements = {
      root: this.contentEl,
      frameEl,
      bodyEl,
      columnsStageEl,
      columnsViewportEl,
      columnsEl,
      outputStageEl,
      breadcrumbsEl,
      breadcrumbExitLayerEl,
      zoomIndicatorEl,
      modeControlsEl,
      outputProfileButtonEl,
      overviewButtonEl,
      markdownButtonEl,
      themeButtonEl,
      viewMenuButtonEl
    };
    this.syncZoomIndicator();
  }

  syncTouchDock(): void {
    const { frameEl, modeControlsEl } = this.elements;
    const state = this.port.read.getState();
    if (!frameEl || !state) {
      return;
    }
    this.contentEl.toggleClass("is-compact", this.compactLayout);
    this.contentEl.toggleClass("has-touch-controls", this.usesTouchControls());
    const controlsHost = this.usesTouchControls() ? this.elements.frameEl : this.elements.bodyEl;
    if (modeControlsEl && modeControlsEl.parentElement !== controlsHost) {
      controlsHost?.appendChild(modeControlsEl);
    }
    if (this.port.read.getMode() === "output" || !this.usesTouchControls()) {
      this.touchDockEl?.remove();
      this.touchDockEl = null;
      return;
    }
    const dock = this.touchDockEl ?? frameEl.createDiv({
      cls: "arbor-touch-dock",
      attr: { role: "toolbar", "aria-label": "Block actions" }
    });
    this.touchDockEl = dock;
    this.contentEl.toggleClass("is-touch-editing", Boolean(this.port.getSession()));
    this.work.frame(window, () => this.handleMobileResize());
    dock.empty();
    const button = (
      label: string,
      icon: string,
      action: () => void,
      disabled = false,
      text = false
    ) => {
      const el = dock.createEl("button", {
        cls: "arbor-touch-action",
        attr: { type: "button", "aria-label": label }
      });
      setIcon(el, icon);
      if (text) {
        el.createSpan({ text: label });
      }
      el.disabled = disabled;
      el.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.port.dock.clearBlurCommitTimer();
      });
      el.addEventListener("click", action);
      return el;
    };
    if (this.port.getSession()) {
      dock.addClass("is-editing");
      button("Cancel", "x", () => this.port.dock.cancel(), false, true);
      button("Save", "check", () => runAsyncAction(this.port.dock.save()), false, true).addClass("mod-cta");
      return;
    }
    dock.removeClass("is-editing");
    const id = state.selectedBlockId;
    const tree = state.metadata;
    const direction = this.port.read.getSettings().layoutDirection;
    const orientation = this.port.read.getMode() === "overview" ? this.port.getOverviewOrientation() : "horizontal";
    const keys = getOverviewDirectionKeys(direction, orientation);
    const icons: Record<OverviewArrowKey, string> = {
      ArrowUp: "arrow-up", ArrowDown: "arrow-down", ArrowLeft: "arrow-left", ArrowRight: "arrow-right"
    };
    button(
      "Parent block",
      orientation === "horizontal" ? getParentArrowIcon(direction) : icons[keys.parent],
      () => this.port.dock.selectParent(),
      !getParentBlock(tree, id)
    );
    button(
      "Previous block",
      orientation === "horizontal" ? "chevron-up" : icons[keys.previous],
      () => this.port.dock.selectPrevious(),
      !getPreviousSibling(tree, id)
    );
    button(
      "Next block",
      orientation === "horizontal" ? "chevron-down" : icons[keys.next],
      () => this.port.dock.selectNext(),
      !getNextSibling(tree, id)
    );
    button(
      "Child block",
      orientation === "horizontal" ? getChildArrowIcon(direction) : icons[keys.child],
      () => this.port.dock.selectChild(),
      !getPreferredChildBlock(tree, id)
    );
    button("Edit block", "pencil", () => this.port.dock.edit(), !id);
    const add = button("Add block", "plus", () => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(id ? "Create child" : "Create root block")
          .setIcon("git-branch")
          .onClick(() => runAsyncAction((id ? this.port.dock.createChild() : this.port.dock.createRoot())))
      );
      if (id) {
        menu.addItem((item) =>
          item.setTitle("Create sibling below").setIcon("plus").onClick(() => runAsyncAction(this.port.dock.createSibling()))
        );
      }
      const rect = add.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.top }, add.ownerDocument);
    });
    button("Block menu", "ellipsis", () => this.port.dock.openBlockMenu(), !id);
  }

  syncBanner(): void {
    const state = this.port.read.getState();
    if (!this.bannerEl || !state) return;
    const showBanner = state.origin === "reconciled";
    this.bannerEl.setCssStyles({ display: showBanner ? "" : "none" });
    if (showBanner) {
      this.bannerEl.empty();
      this.bannerEl.createSpan({ text: "This note changed in plain Markdown mode. The branch tree was rebuilt from the visible note body." });
    }
  }

  syncLoadingOverlay(): void {
    if (!this.loadingOverlayEl) return;
    const activeState = this.port.getLoadingState();
    this.loadingOverlayEl.empty();
    this.loadingOverlayEl.setCssStyles({ display: activeState ? "flex" : "none" });
    if (!activeState) return;
    const panel = this.loadingOverlayEl.createDiv({ cls: "arbor-loading-overlay-panel" });
    panel.createEl("h2", { cls: "arbor-loading-overlay-title", text: activeState.title });
    panel.createEl("p", { cls: "arbor-loading-overlay-description", text: activeState.description });
  }

  applyCssVars(root: HTMLElement): void {
    const settings = this.port.read.getSettings();
    root.setCssProps({
      "--bw-card-width": `${settings.cardWidth}px`, "--bw-card-min-height": `${settings.cardMinHeight}px`,
      "--bw-column-gap": `${settings.horizontalSpacing}px`, "--bw-card-gap": `${settings.verticalSpacing}px`,
      "--bw-zoom": `${settings.zoomLevel}`, "--bw-content-zoom": `${settings.zoomLevel}`,
      "--arbor-card-preview-max-height": `${CARD_PREVIEW_MAX_HEIGHT_PX}px`
    });
    this.syncZoomIndicator();
  }

  applyViewClasses(root: HTMLElement): void {
    this.compactLayout = useCompactLayout(root.clientWidth);
    root.toggleClass("is-compact", this.compactLayout);
    root.toggleClass("has-touch-controls", this.usesTouchControls());
    root.classList.add("is-context-dim-mode");
    const direction = this.port.read.getSettings().layoutDirection;
    root.classList.toggle("is-rtl", direction === "rtl");
    this.applyThemeVariables(root);
    this.port.onDirectionApplied(direction);
  }

  applyThemeVariables(root: HTMLElement): void {
    const variables = this.port.getThemeVariables();
    root.setCssProps(Object.fromEntries(ARBOR_THEME_VARIABLES.map((name) => [name, variables[name] ?? ""])));
  }

  handleMobileResize(): void {
    const compact = useCompactLayout(this.contentEl.clientWidth);
    if (compact !== this.compactLayout) {
      this.compactLayout = compact;
      this.port.onCompactChange(compact);
    }
    if (!this.usesTouchControls()) return;
    this.port.resizeEditors();
    const viewport = this.contentEl.ownerDocument.defaultView?.visualViewport;
    const rect = this.contentEl.getBoundingClientRect();
    let bottom = Math.min(rect.bottom - 8, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0));
    if (Platform.isMobile) this.contentEl.ownerDocument.querySelectorAll<HTMLElement>(".mobile-navbar, .mobile-toolbar").forEach((bar) => {
      const bounds = bar.getBoundingClientRect();
      if (bounds.height > 0 && bounds.width > 0 && bounds.top > rect.top && bounds.top < bottom && bounds.right > rect.left && bounds.left < rect.right && getComputedStyle(bar).visibility !== "hidden") bottom = bounds.top - 8;
    });
    this.contentEl.setCssProps({ "--arbor-mobile-height": `${Math.max(120, bottom - rect.top - 8)}px` });
    this.port.onResizeDuringEdit();
  }

  showMode(mode: ArborPresentationMode): void {
    this.elements.outputStageEl?.setCssStyles({ display: mode === "output" ? "" : "none" });
    this.elements.columnsStageEl?.setCssStyles({ display: mode === "editor" ? "" : "none" });
  }

  teardownShell(): void {
    this.outputProfileLabel?.dispose();
    this.outputProfileLabel = null;
    this.work.reset();
    this.disposeBranchViewport?.();
    this.disposeBranchViewport = null;
    this.contentEl.empty();
    this.touchDockEl = null;
    this.bannerEl = null;
    this.loadingOverlayEl = null;
    this.elements = this.emptyElements();
  }

  getElements(): ShellElements { return this.elements; }
  isCompact(): boolean { return this.compactLayout; }
  usesTouchControls(): boolean { return this.compactLayout || Platform.isMobile; }

  syncOutputProfileButton(): void {
    const state = this.port.read.getState();
    const button = this.elements.outputProfileButtonEl;
    if (!button || !state) return;
    const presentation = getOutputProfileButtonPresentation(state.outputState);
    this.outputProfileLabel?.setText(presentation.text);
    button.setAttr("aria-label", presentation.ariaLabel);
  }

  syncOverviewModeButton(): void {
    const button = this.elements.overviewButtonEl;
    if (!button) return;
    const isOverview = this.port.read.getMode() === "overview";
    button.setAttr("aria-label", isOverview ? "Return to branch editor" : "Open tree overview");
    setIcon(button, isOverview ? "git-fork" : "map");
  }

  syncZoomIndicator(): void {
    const button = this.elements.zoomIndicatorEl;
    if (!button) return;
    const zoom = this.port.read.getSettings().zoomLevel;
    const isDefaultZoom = Math.abs(zoom - 1) < 0.001;
    button.textContent = `${Math.round(zoom * 100)}%`;
    button.classList.toggle("is-default", isDefaultZoom);
    button.title = isDefaultZoom ? "Zoom 100%. Ctrl/Cmd + wheel to zoom." : "Click to reset zoom to 100%. Ctrl/Cmd + wheel to zoom.";
  }

  private emptyElements(): ShellElements {
    return { root: this.contentEl, frameEl: null, bodyEl: null, columnsStageEl: null, columnsViewportEl: null, columnsEl: null, outputStageEl: null, breadcrumbsEl: null, breadcrumbExitLayerEl: null, zoomIndicatorEl: null, modeControlsEl: null, outputProfileButtonEl: null, overviewButtonEl: null, markdownButtonEl: null, themeButtonEl: null, viewMenuButtonEl: null };
  }
}
