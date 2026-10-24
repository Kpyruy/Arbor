import { clampZoomLevel, type ZoomBounds } from "../../mobile";

export interface ZoomPort {
  onManualZoom?(): void;
  getZoom(): number;
  getZoomBounds?(): ZoomBounds;
  getWindow?(): Window;
  canApplyTouchZoom?(): boolean;
  setZoom(value: number): void;
  saveSettings(): Promise<void>;
  applyZoom(): void;
  flashIndicator(): void;
  hideIndicator(): void;
  afterZoom(source?: "manual" | "touch"): void;
}

interface OwnedRequest { owner: Window; id: number }

export class ZoomController {
  private zoomPersistTimer: OwnedRequest | null = null;
  private zoomIndicatorTimer: OwnedRequest | null = null;
  private overviewZoomFrame: OwnedRequest | null = null;
  private pendingOverviewZoom: number | null = null;
  private touchZoomFrame: OwnedRequest | null = null;
  private pendingTouchZoom: { zoom: number; commitViewport?: () => void } | null = null;

  constructor(private readonly port: ZoomPort) {}

  updateZoomLevel(nextZoomLevel: number, options?: { source?: "manual" | "touch"; commitViewport?: () => void }): void {
    const source = options?.source ?? "manual";
    if (source === "manual") {
      this.clearTouchZoomFrame();
      this.clearOverviewZoomFrame();
    }
    this.port.onManualZoom?.();
    const clamped = clampZoomLevel(Number(nextZoomLevel.toFixed(3)), this.port.getZoomBounds?.());
    if (Math.abs(clamped - this.port.getZoom()) < 0.001) {
      if (options?.commitViewport) {
        this.port.afterZoom(source);
        options.commitViewport();
      }
      return;
    }

    this.port.setZoom(clamped);
    this.port.applyZoom();
    this.scheduleZoomPersist();
    this.flashZoomIndicator();
    this.port.afterZoom(source);
    options?.commitViewport?.();
  }

  scheduleTouchZoom(nextZoom: number, commitViewport?: () => void): void {
    this.clearOverviewZoomFrame();
    this.port.onManualZoom?.();
    this.pendingTouchZoom = { zoom: nextZoom, commitViewport };
    if (this.touchZoomFrame !== null) {
      return;
    }
    const request = { owner: this.port.getWindow?.() ?? window, id: 0 };
    this.touchZoomFrame = request;
    request.id = request.owner.requestAnimationFrame(() => {
      if (this.touchZoomFrame !== request) return;
      this.touchZoomFrame = null;
      this.flushTouchZoom();
    });
  }

  flushTouchZoom(): void {
    const pending = this.pendingTouchZoom;
    this.clearTouchZoomFrame();
    if (pending && this.port.canApplyTouchZoom?.() !== false) {
      this.updateZoomLevel(pending.zoom, { source: "touch", commitViewport: pending.commitViewport });
    }
  }

  queueOverviewWheel(deltaY: number): void {
    this.clearTouchZoomFrame();
    const factor = deltaY < 0 ? 1.06 : 1 / 1.06;
    this.pendingOverviewZoom = (this.pendingOverviewZoom ?? this.port.getZoom()) * factor;
    if (this.overviewZoomFrame !== null) {
      return;
    }
    const request = { owner: this.port.getWindow?.() ?? window, id: 0 };
    this.overviewZoomFrame = request;
    request.id = request.owner.requestAnimationFrame(() => {
      if (this.overviewZoomFrame !== request) return;
      this.overviewZoomFrame = null;
      const nextZoom = this.pendingOverviewZoom;
      this.pendingOverviewZoom = null;
      if (nextZoom === null) {
        return;
      }
      this.updateZoomLevel(nextZoom);
    });
  }

  clearOverviewZoomFrame(): void {
    if (this.overviewZoomFrame !== null) {
      this.overviewZoomFrame.owner.cancelAnimationFrame(this.overviewZoomFrame.id);
      this.overviewZoomFrame = null;
    }
    this.pendingOverviewZoom = null;
  }

  clearTouchZoomFrame(): void {
    if (this.touchZoomFrame !== null) {
      this.touchZoomFrame.owner.cancelAnimationFrame(this.touchZoomFrame.id);
      this.touchZoomFrame = null;
    }
    this.pendingTouchZoom = null;
  }

  clearZoomPersistTimer(): void {
    if (this.zoomPersistTimer !== null) {
      this.zoomPersistTimer.owner.clearTimeout(this.zoomPersistTimer.id);
      this.zoomPersistTimer = null;
    }
  }

  clearZoomIndicatorTimer(): void {
    if (this.zoomIndicatorTimer !== null) {
      this.zoomIndicatorTimer.owner.clearTimeout(this.zoomIndicatorTimer.id);
      this.zoomIndicatorTimer = null;
    }
  }

  reset(): void {
    this.clearOverviewZoomFrame();
    this.clearTouchZoomFrame();
    this.clearZoomPersistTimer();
    this.clearZoomIndicatorTimer();
  }

  private scheduleZoomPersist(): void {
    this.clearZoomPersistTimer();
    const request = { owner: this.port.getWindow?.() ?? window, id: 0 };
    this.zoomPersistTimer = request;
    request.id = request.owner.setTimeout(() => {
      if (this.zoomPersistTimer !== request) return;
      this.zoomPersistTimer = null;
      void this.port.saveSettings();
    }, 180);
  }

  private flashZoomIndicator(): void {
    this.port.flashIndicator();
    this.clearZoomIndicatorTimer();
    const request = { owner: this.port.getWindow?.() ?? window, id: 0 };
    this.zoomIndicatorTimer = request;
    request.id = request.owner.setTimeout(() => {
      if (this.zoomIndicatorTimer !== request) return;
      this.zoomIndicatorTimer = null;
      this.port.hideIndicator();
    }, 1100);
  }
}
