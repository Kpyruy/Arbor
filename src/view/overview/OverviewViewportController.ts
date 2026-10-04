export interface OverviewViewportPort {
  getElements(): { viewport: HTMLElement | null; scene: HTMLElement | null; surface: HTMLElement | null };
  getZoom(): number;
}

export class OverviewViewportController {
  private panState: { pointerId: number; startClientX: number; startClientY: number; startScrollLeft: number; startScrollTop: number } | null = null;
  private pendingViewportPosition: { left: number; top: number } | null = null;

  constructor(private readonly port: OverviewViewportPort) {}

  syncOverviewZoom(): void {
    const { scene, viewport } = this.port.getElements();
    if (!scene) return;
    const width = Number(scene.dataset.overviewWidth);
    const height = Number(scene.dataset.overviewHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const zoom = this.port.getZoom();
    scene.setCssProps({
      "--arbor-overview-zoom": String(zoom),
      "--arbor-overview-width": `${width * zoom}px`,
      "--arbor-overview-height": `${height * zoom}px`
    });
    viewport?.classList.toggle("is-zoomed-out", zoom < 0.78);
  }

  centerOverviewOnSelectedBlock(): void {
    const { viewport, scene, surface } = this.port.getElements();
    const selectedCard = surface?.querySelector<HTMLElement>(".arbor-overview-card.is-active")
      ?? surface?.querySelector<HTMLElement>(".arbor-overview-card");
    if (!viewport || !scene || !selectedCard) return;
    const zoom = this.port.getZoom();
    viewport.scrollTo({
      left: Math.max(0, scene.offsetLeft + (selectedCard.offsetLeft + selectedCard.offsetWidth / 2) * zoom - viewport.clientWidth / 2),
      top: Math.max(0, scene.offsetTop + (selectedCard.offsetTop + selectedCard.offsetHeight / 2) * zoom - viewport.clientHeight / 2),
      behavior: "smooth"
    });
  }

  revealOverviewSelectedCard(selectedCard: HTMLElement): void {
    const { viewport, scene } = this.port.getElements();
    if (!viewport || !scene) return;
    const zoom = this.port.getZoom();
    const padding = 36;
    const cardLeft = scene.offsetLeft + selectedCard.offsetLeft * zoom;
    const cardTop = scene.offsetTop + selectedCard.offsetTop * zoom;
    const cardRight = cardLeft + selectedCard.offsetWidth * zoom;
    const cardBottom = cardTop + selectedCard.offsetHeight * zoom;
    const viewportRight = viewport.scrollLeft + viewport.clientWidth;
    const viewportBottom = viewport.scrollTop + viewport.clientHeight;
    if (cardLeft >= viewport.scrollLeft + padding && cardRight <= viewportRight - padding && cardTop >= viewport.scrollTop + padding && cardBottom <= viewportBottom - padding) return;

    let targetLeft = viewport.scrollLeft;
    let targetTop = viewport.scrollTop;
    if (cardLeft < viewport.scrollLeft + padding) targetLeft = cardLeft - padding;
    else if (cardRight > viewportRight - padding) targetLeft = cardRight - viewport.clientWidth + padding;
    if (selectedCard.offsetHeight * zoom > viewport.clientHeight - padding * 2 && selectedCard.classList.contains("is-editing")) targetTop = cardTop - padding;
    else if (cardTop < viewport.scrollTop + padding) targetTop = cardTop - padding;
    else if (cardBottom > viewportBottom - padding) targetTop = cardBottom - viewport.clientHeight + padding;
    viewport.scrollTo({
      left: Math.max(0, Math.min(targetLeft, viewport.scrollWidth - viewport.clientWidth)),
      top: Math.max(0, Math.min(targetTop, viewport.scrollHeight - viewport.clientHeight)),
      behavior: "smooth"
    });
  }

  preserve(): void {
    const { viewport } = this.port.getElements();
    if (!viewport) {
      return;
    }

    viewport.scrollTo({ left: viewport.scrollLeft, top: viewport.scrollTop, behavior: "auto" });
    this.pendingViewportPosition = { left: viewport.scrollLeft, top: viewport.scrollTop };
  }

  discardPendingRestore(): void {
    this.pendingViewportPosition = null;
  }

  restore(): void {
    const { viewport } = this.port.getElements();
    const position = this.pendingViewportPosition;
    if (!viewport || !position) {
      return;
    }

    viewport.scrollTo({
      left: Math.max(0, Math.min(position.left, viewport.scrollWidth - viewport.clientWidth)),
      top: Math.max(0, Math.min(position.top, viewport.scrollHeight - viewport.clientHeight)),
      behavior: "auto"
    });
    this.pendingViewportPosition = null;
  }

  handleOverviewPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const { viewport } = this.port.getElements();
    if (!viewport || event.button !== 0 || event.target instanceof HTMLButtonElement) return;
    this.panState = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startScrollLeft: viewport.scrollLeft, startScrollTop: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  }

  handleOverviewPointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const { viewport } = this.port.getElements();
    const pan = this.panState;
    if (!viewport || !pan || pan.pointerId !== event.pointerId) return;
    viewport.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startClientX);
    viewport.scrollTop = pan.startScrollTop - (event.clientY - pan.startClientY);
  }

  handleOverviewPointerUp(event: PointerEvent): void {
    if (event.pointerType !== "touch" && this.panState?.pointerId === event.pointerId) this.cleanupOverviewPan();
  }

  cleanupOverviewPan(): void {
    const { viewport } = this.port.getElements();
    const pointerId = this.panState?.pointerId;
    if (viewport && pointerId !== undefined && viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    viewport?.classList.remove("is-panning");
    this.panState = null;
  }

  reset(): void {
    this.cleanupOverviewPan();
    this.pendingViewportPosition = null;
  }
}
