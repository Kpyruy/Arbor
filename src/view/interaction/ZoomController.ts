import { clampZoomLevel } from "../../mobile";

export interface ZoomPort {
  getZoom(): number;
  setZoom(value: number): void;
  saveSettings(): Promise<void>;
  applyZoom(): void;
  flashIndicator(): void;
  hideIndicator(): void;
  afterZoom(): void;
}

export class ZoomController {
  private zoomPersistTimer: number | null = null;
  private zoomIndicatorTimer: number | null = null;
  private overviewZoomFrame: number | null = null;
  private pendingOverviewZoom: number | null = null;
  private touchZoomFrame: number | null = null;
  private pendingTouchZoom: number | null = null;

  constructor(private readonly port: ZoomPort) {}

  updateZoomLevel(nextZoomLevel: number): void {
    const clamped = clampZoomLevel(Number(nextZoomLevel.toFixed(3)));
    if (Math.abs(clamped - this.port.getZoom()) < 0.001) {
      return;
    }

    this.port.setZoom(clamped);
    this.port.applyZoom();
    this.scheduleZoomPersist();
    this.flashZoomIndicator();
    this.port.afterZoom();
  }

  scheduleTouchZoom(nextZoom: number): void {
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
    });
  }

  queueOverviewWheel(deltaY: number): void {
    const factor = deltaY < 0 ? 1.06 : 1 / 1.06;
    this.pendingOverviewZoom = (this.pendingOverviewZoom ?? this.port.getZoom()) * factor;
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
    });
  }

  clearOverviewZoomFrame(): void {
    if (this.overviewZoomFrame !== null) {
      window.cancelAnimationFrame(this.overviewZoomFrame);
      this.overviewZoomFrame = null;
    }
    this.pendingOverviewZoom = null;
  }

  clearTouchZoomFrame(): void {
    if (this.touchZoomFrame !== null) {
      window.cancelAnimationFrame(this.touchZoomFrame);
      this.touchZoomFrame = null;
    }
    this.pendingTouchZoom = null;
  }

  clearZoomPersistTimer(): void {
    if (this.zoomPersistTimer !== null) {
      window.clearTimeout(this.zoomPersistTimer);
      this.zoomPersistTimer = null;
    }
  }

  clearZoomIndicatorTimer(): void {
    if (this.zoomIndicatorTimer !== null) {
      window.clearTimeout(this.zoomIndicatorTimer);
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
    this.zoomPersistTimer = window.setTimeout(() => {
      this.zoomPersistTimer = null;
      void this.port.saveSettings();
    }, 180);
  }

  private flashZoomIndicator(): void {
    this.port.flashIndicator();
    this.clearZoomIndicatorTimer();
    this.zoomIndicatorTimer = window.setTimeout(() => {
      this.zoomIndicatorTimer = null;
      this.port.hideIndicator();
    }, 1100);
  }
}
