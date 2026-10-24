import { pinchViewport, resolvePinchZoom, type TouchPoint, type ZoomBounds } from "../../mobile";

export interface TouchPort {
  getZoom(): number;
  getZoomBounds?(): ZoomBounds;
  scheduleZoom(value: number, commitViewport?: () => void): void;
  flushZoom?(): void;
  cancelZoom?(): void;
  beginBranchPinch?(viewport: HTMLElement, midpoint: TouchPoint): void;
  commitBranchPinch?(viewport: HTMLElement, midpoint: TouchPoint): void;
  endBranchPinch?(): void;
  hasEditingSession(): boolean;
  usesTouchControls(): boolean;
  getOverviewSceneOffset(): { left: number; top: number };
  revealCompactSelection(): void;
}

interface FreshLinkTap {
  pointerId: number;
  anchor: Element;
  x: number;
  y: number;
  complete: boolean;
  expiresAt: number;
}

function closestAnchor(target: EventTarget | null): Element | null {
  const node = target as Node | null;
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  return element?.closest("a") ?? null;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const node = target as Node | null;
  const element = node?.nodeType === 3 ? node.parentElement : target as Element | null;
  return Boolean(element?.closest?.("textarea, input, button, a, [contenteditable='true']"));
}

export class TouchController {
  private readonly touchPoints = new Map<number, TouchPoint>();
  private touchStart: { zoom: number; left: number; top: number; midpoint: TouchPoint; distance: number } | null = null;
  private touchMoved = false;
  private suppressTouchClickUntil = 0;
  private readonly branchTouchPoints = new Map<number, TouchPoint>();
  private branchTouchStart: { zoom: number; distance: number } | null = null;
  private branchTouchPinching = false;
  private readonly disposers: (() => void)[] = [];
  private readonly boundViewports = new Set<HTMLElement>();

  constructor(private readonly port: TouchPort) {}

  bindOverviewTouch(viewport: HTMLElement): () => void {
    const geometry = () => {
      const points = Array.from(this.touchPoints.values());
      const a = points[0];
      const b = points[1] ?? a;
      const rect = viewport.getBoundingClientRect();
      return { midpoint: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const rebase = () => {
      const offset = this.port.getOverviewSceneOffset();
      this.touchStart = this.touchPoints.size ? {
        zoom: this.port.getZoom(),
        left: viewport.scrollLeft - offset.left,
        top: viewport.scrollTop - offset.top,
        ...geometry()
      } : null;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || this.port.hasEditingSession() || isInteractiveTarget(event.target)) return;
      this.port.flushZoom?.();
      if (!this.touchPoints.size) this.touchMoved = false;
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      rebase();
      if (this.touchPoints.size > 1) this.touchMoved = true;
    };
    const move = (event: PointerEvent) => {
      if (this.port.hasEditingSession()) { this.clearOverviewTouch(viewport); return; }
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
      const offset = this.port.getOverviewSceneOffset();
      if (this.touchPoints.size > 1) {
        const next = pinchViewport(this.touchStart, midpoint, distance, this.port.getZoomBounds?.());
        const start = this.touchStart;
        this.port.scheduleZoom(next.zoom, () => {
          if (this.touchStart !== start) return;
          const ratio = this.port.getZoom() / start.zoom;
          const appliedOffset = this.port.getOverviewSceneOffset();
          viewport.scrollLeft = (start.left + start.midpoint.x) * ratio - midpoint.x + appliedOffset.left;
          viewport.scrollTop = (start.top + start.midpoint.y) * ratio - midpoint.y + appliedOffset.top;
        });
      } else {
        viewport.scrollLeft = this.touchStart.left + offset.left - dx;
        viewport.scrollTop = this.touchStart.top + offset.top - dy;
      }
    };
    const end = (event: PointerEvent) => {
      if (event.type === "lostpointercapture" && event.target !== viewport) return;
      if (!this.touchPoints.has(event.pointerId)) return;
      if (event.type === "pointerup") this.port.flushZoom?.();
      else this.port.cancelZoom?.();
      if (!this.touchPoints.delete(event.pointerId)) return;
      if (this.touchMoved) this.suppressTouchClickUntil = Date.now() + 500;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (!this.touchPoints.size) viewport.removeClass("is-panning");
      rebase();
    };
    return this.bind(viewport, down, move, end, () => this.clearOverviewTouch(viewport));
  }

  bindBranchTouch(viewport: HTMLElement): () => void {
    let nativeInput = false;
    const midpoint = () => {
      const [a, b] = Array.from(this.branchTouchPoints.values());
      const bounds = viewport.getBoundingClientRect();
      return { x: (a.x + b.x) / 2 - bounds.left, y: (a.y + b.y) / 2 - bounds.top };
    };
    const distance = () => {
      const [a, b] = Array.from(this.branchTouchPoints.values());
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const rebase = () => {
      this.branchTouchStart = this.branchTouchPoints.size > 1
        ? { zoom: this.port.getZoom(), distance: distance() }
        : null;
      if (this.branchTouchStart) {
        this.branchTouchPinching = true;
        viewport.addClass("is-touch-pinching");
        this.port.beginBranchPinch?.(viewport, midpoint());
      }
    };
    const down = (event: PointerEvent) => {
      if (nativeInput) return;
      if (event.pointerType !== "touch" || !this.port.usesTouchControls() || this.port.hasEditingSession() || isInteractiveTarget(event.target)) {
        return;
      }
      this.port.flushZoom?.();
      this.branchTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      rebase();
    };
    const move = (event: PointerEvent) => {
      if (this.port.hasEditingSession()) { this.clearBranchTouch(viewport); nativeInput = false; return; }
      if (nativeInput) return;
      if (!this.branchTouchPoints.has(event.pointerId) || !this.branchTouchStart || this.branchTouchPoints.size < 2) {
        return;
      }
      this.branchTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      zoomAtMidpoint();
    };
    const zoomAtMidpoint = () => {
      if (!this.branchTouchStart || this.branchTouchPoints.size < 2) return;
      const nextZoom = resolvePinchZoom(this.branchTouchStart.zoom, this.branchTouchStart.distance, distance(), this.port.getZoomBounds?.());
      this.suppressTouchClickUntil = Date.now() + 500;
      const start = this.branchTouchStart;
      const center = midpoint();
      this.port.scheduleZoom(nextZoom, () => {
        if (this.branchTouchStart === start) this.port.commitBranchPinch?.(viewport, center);
      });
    };
    const end = (event: PointerEvent) => {
      if (nativeInput) return;
      if (event.type === "lostpointercapture" && event.target !== viewport) return;
      if (!this.branchTouchPoints.has(event.pointerId)) {
        return;
      }
      if (event.type === "pointerup") this.port.flushZoom?.();
      else this.port.cancelZoom?.();
      this.branchTouchPoints.delete(event.pointerId);
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      if (this.branchTouchPoints.size < 2) {
        viewport.removeClass("is-touch-pinching");
        if (this.branchTouchPinching) {
          this.branchTouchPinching = false;
          this.port.endBranchPinch?.();
        }
      }
      rebase();
    };
    // Native scrolling cancels PointerEvents. TouchEvents retain the complete
    // finger set, so adding a second finger after scrolling can still pinch.
    const readTouches = (event: TouchEvent) => {
      this.branchTouchPoints.clear();
      for (const touch of Array.from(event.touches)) {
        if (!touch.target || viewport.contains(touch.target as Node)) {
          this.branchTouchPoints.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }
      }
    };
    const nativeStart = (event: TouchEvent) => {
      if (!this.port.usesTouchControls() || this.port.hasEditingSession() || isInteractiveTarget(event.target)) return;
      this.port.flushZoom?.();
      nativeInput = true;
      readTouches(event);
      rebase();
      if (this.branchTouchPoints.size > 1) {
        this.suppressTouchClickUntil = Date.now() + 500;
        if (event.cancelable) event.preventDefault();
      }
    };
    const nativeMove = (event: TouchEvent) => {
      if (this.port.hasEditingSession()) { this.clearBranchTouch(viewport); nativeInput = false; return; }
      if (!nativeInput) return;
      readTouches(event);
      if (this.branchTouchPoints.size < 2) return;
      if (event.cancelable) event.preventDefault();
      zoomAtMidpoint();
    };
    const nativeEnd = (event: TouchEvent) => {
      if (!nativeInput) return;
      if (event.type === "touchcancel") this.port.cancelZoom?.();
      else this.port.flushZoom?.();
      readTouches(event);
      if (this.branchTouchPoints.size < 2) {
        if (this.branchTouchPinching) this.suppressTouchClickUntil = Date.now() + 500;
        this.branchTouchPinching = false;
        viewport.removeClass("is-touch-pinching");
        this.port.endBranchPinch?.();
      }
      nativeInput = this.branchTouchPoints.size > 0;
      rebase();
    };
    viewport.addEventListener("touchstart", nativeStart, { passive: false });
    viewport.addEventListener("touchmove", nativeMove, { passive: false });
    viewport.addEventListener("touchend", nativeEnd);
    viewport.addEventListener("touchcancel", nativeEnd);
    return this.bind(viewport, down, move, end, () => {
      viewport.removeEventListener("touchstart", nativeStart);
      viewport.removeEventListener("touchmove", nativeMove);
      viewport.removeEventListener("touchend", nativeEnd);
      viewport.removeEventListener("touchcancel", nativeEnd);
      nativeInput = false;
      this.clearBranchTouch(viewport);
    });
  }

  isBranchPinching(): boolean {
    return this.branchTouchPinching;
  }

  reset(): void {
    while (this.disposers.length) {
      this.disposers[0]();
    }
    this.touchPoints.clear();
    this.touchStart = null;
    this.touchMoved = false;
    this.branchTouchPoints.clear();
    this.branchTouchStart = null;
    this.branchTouchPinching = false;
    this.boundViewports.clear();
  }

  private bind(
    viewport: HTMLElement,
    down: (event: PointerEvent) => void,
    move: (event: PointerEvent) => void,
    end: (event: PointerEvent) => void,
    clearGesture: () => void
  ): () => void {
    let freshLinkTap: FreshLinkTap | null = null;
    const activeTouches = new Set<number>();
    const trackDown = (event: PointerEvent) => {
      freshLinkTap = null;
      if (event.pointerType === "touch") {
        activeTouches.add(event.pointerId);
        const anchor = closestAnchor(event.target);
        if (anchor && viewport.contains(anchor) && activeTouches.size === 1
          && !this.port.hasEditingSession() && this.touchPoints.size === 0
          && this.branchTouchPoints.size === 0 && !this.branchTouchPinching) {
          freshLinkTap = {
            pointerId: event.pointerId, anchor, x: event.clientX, y: event.clientY,
            complete: false, expiresAt: Date.now() + 500
          };
        }
      }
      down(event);
    };
    const trackMove = (event: PointerEvent) => {
      if (freshLinkTap?.pointerId === event.pointerId
        && Math.hypot(event.clientX - freshLinkTap.x, event.clientY - freshLinkTap.y) >= 8) {
        freshLinkTap = null;
      }
      move(event);
    };
    const trackEnd = (event: PointerEvent) => {
      if (event.type !== "lostpointercapture" || event.target === viewport) {
        activeTouches.delete(event.pointerId);
        if (freshLinkTap?.pointerId === event.pointerId) {
          if (event.type === "pointerup" && activeTouches.size === 0
            && Math.hypot(event.clientX - freshLinkTap.x, event.clientY - freshLinkTap.y) < 8
            && closestAnchor(event.target) === freshLinkTap.anchor) {
            freshLinkTap.complete = true;
            freshLinkTap.expiresAt = Date.now() + 500;
          } else {
            freshLinkTap = null;
          }
        }
      }
      end(event);
    };
    const suppress = (event: Event) => {
      const pointerType = (event as PointerEvent).pointerType;
      const nonTouchClick = event.type === "click" && pointerType !== "touch"
        && ((typeof pointerType === "string" && pointerType !== "" && pointerType !== "touch")
          || (event as MouseEvent).detail === 0);
      const fresh = event.type === "click" && freshLinkTap?.complete
        && Date.now() < freshLinkTap.expiresAt && closestAnchor(event.target) === freshLinkTap.anchor;
      freshLinkTap = null;
      if (Date.now() < this.suppressTouchClickUntil && !fresh && !nonTouchClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    viewport.addEventListener("pointerdown", trackDown, { capture: true });
    viewport.addEventListener("pointermove", trackMove, { capture: true, passive: false });
    viewport.addEventListener("pointerup", trackEnd, true);
    viewport.addEventListener("pointercancel", trackEnd, true);
    viewport.addEventListener("lostpointercapture", trackEnd, true);
    for (const type of ["click", "dblclick", "contextmenu"]) {
      viewport.addEventListener(type, suppress, true);
    }
    this.boundViewports.add(viewport);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      viewport.removeEventListener("pointerdown", trackDown, true);
      viewport.removeEventListener("pointermove", trackMove, true);
      viewport.removeEventListener("pointerup", trackEnd, true);
      viewport.removeEventListener("pointercancel", trackEnd, true);
      viewport.removeEventListener("lostpointercapture", trackEnd, true);
      for (const type of ["click", "dblclick", "contextmenu"]) {
        viewport.removeEventListener(type, suppress, true);
      }
      clearGesture();
      freshLinkTap = null;
      activeTouches.clear();
      this.boundViewports.delete(viewport);
      const index = this.disposers.indexOf(dispose);
      if (index >= 0) this.disposers.splice(index, 1);
    };
    this.disposers.push(dispose);
    return dispose;
  }

  private clearOverviewTouch(viewport: HTMLElement): void {
    this.port.cancelZoom?.();
    this.releaseCaptures(viewport, this.touchPoints);
    this.touchPoints.clear();
    this.touchStart = null;
    this.touchMoved = false;
    viewport.removeClass("is-panning");
  }

  private clearBranchTouch(viewport: HTMLElement): void {
    this.port.cancelZoom?.();
    this.port.endBranchPinch?.();
    this.releaseCaptures(viewport, this.branchTouchPoints);
    this.branchTouchPoints.clear();
    this.branchTouchStart = null;
    this.branchTouchPinching = false;
    viewport.removeClass("is-touch-pinching");
  }

  private releaseCaptures(viewport: HTMLElement, points: Map<number, TouchPoint>): void {
    for (const pointerId of points.keys()) {
      if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    }
  }

}
