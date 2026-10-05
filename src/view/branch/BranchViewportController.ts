import { getActivePath } from "../../model/tree";
import { clampCardCenter, reserveSceneWidthForColumns } from "../../cardViewport";
import type { BranchBlockId } from "../../types";
import type { EditingSession, ViewReadPort } from "../state/viewTypes";

export interface BranchViewportPort {
  read: ViewReadPort;
  getElements(): { root: HTMLElement; stage: HTMLElement | null; viewport: HTMLElement | null; columns: HTMLElement | null; previewContent: HTMLElement | null };
  getSession(): EditingSession | null;
  isCompact(): boolean;
  consumeAutofocus(session: EditingSession): void;
}

export interface BranchFocusRequest {
  focusBlockId: BranchBlockId | null;
  scrollBlockId: BranchBlockId | null;
  snap: boolean;
  preservedSceneWidth: number;
}

export class BranchViewportController {
  private focusFrame: number | null = null;
  private layoutFrame: number | null = null;
  private horizontalScrollFrame: number | null = null;
  private alignments = new WeakMap<HTMLElement, { target: HTMLElement; natural: number }>();
  private panState: { pointerId: number; startClientX: number; startScrollLeft: number; dragging: boolean } | null = null;

  constructor(private readonly port: BranchViewportPort) {}

  revealCompactSelection(): void {
    if (!this.port.isCompact()) return;
    const { viewport, columns } = this.port.getElements();
    const card = columns?.querySelector<HTMLElement>(".arbor-card.is-active");
    if (!viewport || !card) return;
    const bounds = viewport.getBoundingClientRect();
    const target = card.getBoundingClientRect();
    const offset = target.top < bounds.top + 12 || target.height > bounds.height - 24 ? target.top - bounds.top - 12 : Math.max(0, target.bottom - bounds.bottom + 12);
    if (Math.abs(offset) > 1) viewport.scrollTop += offset;
  }

  scheduleColumnAlignment(): void {
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
    }

    this.layoutFrame = window.requestAnimationFrame(() => {
      this.layoutFrame = null;
      this.alignColumnsToActivePath();
    });
  }

  applyPendingFocusAndScroll(request: BranchFocusRequest): void {
    if (this.focusFrame !== null) window.cancelAnimationFrame(this.focusFrame);
    this.focusFrame = window.requestAnimationFrame(() => {
      this.focusFrame = null;
      const { viewport, columns, previewContent } = this.port.getElements();
      if (!columns || !viewport) return;
      this.alignColumnsToActivePath();
      this.syncViewportEdgeFades();
      const activeCard = columns.querySelector<HTMLElement>(".arbor-card.is-active");
      if (request.focusBlockId) {
        let focusHandled = false;
        const session = this.port.getSession();
        if (session?.blockId === request.focusBlockId && session.origin === "preview") {
          const editor = previewContent?.querySelector<HTMLTextAreaElement>(`.arbor-preview-block[data-block-id="${request.focusBlockId}"] textarea.arbor-editor`);
          if (editor) {
            editor.focus({ preventScroll: true });
            if (session.autofocus) {
              editor.setSelectionRange(editor.value.length, editor.value.length);
              this.port.consumeAutofocus(session);
            }
            focusHandled = true;
          }
        }
        const card = !focusHandled ? columns.querySelector<HTMLElement>(`.arbor-card[data-block-id="${request.focusBlockId}"]`) : null;
        if (card) {
          const editor = card.querySelector<HTMLTextAreaElement>("textarea.arbor-editor");
          const currentSession = this.port.getSession();
          if (editor && currentSession?.blockId === request.focusBlockId && currentSession.origin === "card") {
            editor.focus({ preventScroll: true });
            if (currentSession.autofocus) {
              editor.setSelectionRange(editor.value.length, editor.value.length);
              this.port.consumeAutofocus(currentSession);
            }
          } else {
            card.focus({ preventScroll: true });
          }
        } else if (!focusHandled) {
          viewport.focus({ preventScroll: true });
        }
      }
      if (request.scrollBlockId) {
        const scrollCard = columns.querySelector<HTMLElement>(`.arbor-card[data-block-id="${request.scrollBlockId}"]`) ?? activeCard;
        if (scrollCard) {
          this.animateSelectedCard(request.scrollBlockId);
          this.scrollCardIntoHorizontalView(scrollCard, viewport, request.preservedSceneWidth, request.snap);
        }
      } else {
        this.releasePreservedSceneWidth();
      }
    });
  }

  armSceneWidthForPendingScroll(nextColumnCount: number, pendingScrollBlockId: BranchBlockId | null): number {
    if (this.port.isCompact()) return 0;
    const { viewport, columns } = this.port.getElements();
    if (!pendingScrollBlockId || !columns || !viewport) return 0;
    const settings = this.port.read.getSettings();
    const width = reserveSceneWidthForColumns(
      columns.scrollWidth,
      viewport.clientWidth,
      columns.querySelectorAll(".arbor-column").length,
      nextColumnCount,
      settings.cardWidth,
      settings.horizontalSpacing,
      settings.zoomLevel
    );
    columns.setCssProps({ "--arbor-columns-min-width": `${width}px` });
    return width;
  }

  stopHorizontalScrollMotion(releasePreservedWidth = true): void {
    if (this.horizontalScrollFrame !== null) {
      window.cancelAnimationFrame(this.horizontalScrollFrame);
      this.horizontalScrollFrame = null;
    }
    if (releasePreservedWidth) this.releasePreservedSceneWidth();
  }

  syncViewportEdgeFades(): void {
    const { stage, viewport } = this.port.getElements();
    if (!stage || !viewport) return;
    const canScroll = viewport.scrollWidth - viewport.clientWidth > 1;
    stage.classList.toggle("has-hidden-left", canScroll && viewport.scrollLeft > 2);
    stage.classList.toggle("has-hidden-right", canScroll && viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2);
  }

  scrollCardIntoHorizontalView(card: HTMLElement, viewport: HTMLElement, preservedSceneWidth = 0, snap = false): void {
    if (this.port.isCompact()) {
      this.revealCompactSelection();
      return;
    }
    const { columns } = this.port.getElements();
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

    if (preservedSceneWidth > 0 && columns) {
      columns.setCssProps({
        "--arbor-columns-min-width": `${Math.max(preservedSceneWidth, viewport.clientWidth)}px`
      });
    }

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const targetLeft = shouldScrollLeft
      ? Math.max(0, Math.min(viewport.scrollLeft - ((viewportRect.left + safePadding) - cardRect.left), maxScrollLeft))
      : Math.max(0, Math.min(viewport.scrollLeft + (cardRect.right - (viewportRect.right - safePadding)), maxScrollLeft));
    if (snap) {
      this.stopHorizontalScrollMotion(false);
      viewport.scrollLeft = targetLeft;
      this.syncViewportEdgeFades();
      this.releasePreservedSceneWidth();
      return;
    }

    this.animateViewportScrollTo(viewport, targetLeft);
  }

  alignColumnsToActivePath(): void {
    const { viewport, columns } = this.port.getElements();
    if (this.port.isCompact()) {
      columns?.querySelectorAll<HTMLElement>(".arbor-card-list").forEach((list) => {
        list.setCssProps({ "--arbor-card-list-offset-y": "0px" });
        list.classList.remove("is-rebinding");
      });
      return;
    }
    const state = this.port.read.getState();
    if (!state) return;
    const { root } = this.port.getElements();
    const resolvedViewport = viewport ?? root.querySelector<HTMLElement>(".arbor-columns-viewport");
    const resolvedColumns = columns ?? root.querySelector<HTMLElement>(".arbor-columns");
    if (!resolvedViewport || !resolvedColumns) return;
    const columnEls = Array.from(resolvedColumns.querySelectorAll<HTMLElement>(".arbor-column"));
    if (!columnEls.length) return;
    const path = getActivePath(state.metadata, state.selectedBlockId);
    const viewportRect = resolvedViewport.getBoundingClientRect();
    const rootRect = resolvedColumns.getBoundingClientRect();
    const rootAnchor = viewportRect.top - rootRect.top + resolvedViewport.clientHeight * 0.44;
    const centers = new Map<number, number>();
    columnEls.forEach((column) => {
      const list = column.querySelector<HTMLElement>(".arbor-card-list");
      if (!list) return;
      const cards = Array.from(column.querySelectorAll<HTMLElement>(".arbor-card"));
      const fallback = cards[Math.floor((Math.max(cards.length, 1) - 1) / 2)] ?? null;
      const depth = Number(column.dataset.columnDepth);
      const block = path[depth];
      const target =
        (block ? column.querySelector<HTMLElement>(`.arbor-card[data-block-id="${block.id}"]`) : null) ??
        column.querySelector<HTMLElement>(".arbor-column-empty") ??
        fallback;
      if (!target) return;
      const natural = this.getElementOffsetTopWithin(target, resolvedColumns) + target.offsetHeight / 2;
      const preferred = depth === 0 ? rootAnchor : (centers.get(depth - 1) ?? natural);
      const anchor = target.classList.contains("is-active")
        ? clampCardCenter(preferred, target.offsetHeight, viewportRect.top - rootRect.top, resolvedViewport.clientHeight)
        : preferred;
      const shift = anchor - natural;
      const previous = this.alignments.get(list);
      const stableAncestor = previous?.target === target && !target.classList.contains("is-active")
        && Math.abs(previous.natural - natural) > 0.25 && !list.classList.contains("is-rebinding");
      if (stableAncestor) list.classList.add("is-alignment-stable");
      list.setCssProps({ "--arbor-card-list-offset-y": Math.abs(shift) < 0.25 ? "0px" : `${shift}px` });
      if (stableAncestor) {
        list.getBoundingClientRect();
        list.classList.remove("is-alignment-stable");
      }
      this.alignments.set(list, { target, natural });
      if (list.classList.contains("is-rebinding")) {
        window.requestAnimationFrame(() => list.classList.remove("is-rebinding"));
      }
      centers.set(depth, natural + shift);
    });
  }

  handleViewportPointerDown(event: PointerEvent, viewport: HTMLElement): void {
    if (event.pointerType === "touch" || this.port.isCompact() || event.button !== 0 || viewport.scrollWidth <= viewport.clientWidth) {
      return;
    }
    if ((event.target as HTMLElement | null)?.closest(".arbor-card, textarea, button, a, input, select")) {
      return;
    }
    this.panState = { pointerId: event.pointerId, startClientX: event.clientX, startScrollLeft: viewport.scrollLeft, dragging: false };
    viewport.setPointerCapture(event.pointerId);
  }
  handleViewportPointerMove(event: PointerEvent, viewport: HTMLElement): void {
    const pan = this.panState;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const delta = event.clientX - pan.startClientX;
    if (!pan.dragging) {
      if (Math.abs(delta) < 4) {
        return;
      }
      pan.dragging = true;
      viewport.classList.add("is-panning");
    }
    viewport.scrollLeft = pan.startScrollLeft - delta;
    event.preventDefault();
  }
  handleViewportPointerUp(event: PointerEvent, viewport: HTMLElement): void {
    if (this.panState?.pointerId === event.pointerId) {
      this.cleanupViewportPan(viewport, event.pointerId);
    }
  }

  handleViewportPointerCaptureLost(event: PointerEvent, viewport: HTMLElement): void {
    if (this.panState?.pointerId === event.pointerId) {
      this.cleanupViewportPan(viewport, event.pointerId, false);
    }
  }
  cleanupViewportPan(viewport = this.port.getElements().viewport, pointerId?: number, releaseCapture = true): void {
    const active = pointerId ?? this.panState?.pointerId;
    this.panState = null;
    viewport?.classList.remove("is-panning");
    if (releaseCapture && viewport && active !== undefined && viewport.hasPointerCapture(active)) {
      viewport.releasePointerCapture(active);
    }
  }

  reset(): void {
    this.alignments = new WeakMap();
    if (this.focusFrame !== null) window.cancelAnimationFrame(this.focusFrame);
    if (this.layoutFrame !== null) window.cancelAnimationFrame(this.layoutFrame);
    this.focusFrame = null;
    this.layoutFrame = null;
    this.stopHorizontalScrollMotion();
    this.cleanupViewportPan();
  }

  private animateSelectedCard(blockId: BranchBlockId): void {
    const { columns, root } = this.port.getElements();
    root.querySelectorAll<HTMLElement>(".arbor-card.is-selection-entering").forEach((card) => {
      card.classList.remove("is-selection-entering");
    });

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const card = columns?.querySelector<HTMLElement>(`.arbor-card[data-block-id="${blockId}"]`);
    if (!card) {
      return;
    }

    card.classList.add("is-selection-entering");
    card.addEventListener("animationend", () => card.classList.remove("is-selection-entering"), { once: true });
  }

  private releasePreservedSceneWidth(): void {
    this.port.getElements().columns?.setCssProps({ "--arbor-columns-min-width": "max-content" });
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

  private getElementOffsetTopWithin(element: HTMLElement, ancestor: HTMLElement): number {
    let offset = 0;
    let current: HTMLElement | null = element;
    while (current && current !== ancestor) {
      offset += current.offsetTop;
      current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
    }
    return offset;
  }
}
