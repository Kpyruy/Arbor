export interface ActiveZoomTarget { card: HTMLElement; viewport: HTMLElement }

export interface ActiveZoomPort {
  prepareTarget?(target: ActiveZoomTarget): void;
  getTarget(): ActiveZoomTarget | null;
  getZoom(): number;
  getBounds(): { min: number; max: number };
  getNaturalSize?(target: ActiveZoomTarget, zoom: number): { width: number; height: number } | null;
  applyZoom(value: number): void;
  center(target: ActiveZoomTarget): void;
  onEnabledChanged(enabled: boolean): void;
}

/** View-local fit mode. Automatic updates never enter the manual-zoom path. */
export class ActiveZoomController {
  private enabled = false;
  private generation = 0;
  private frame: { win: Window; id: number } | null = null;
  private observer: ResizeObserver | null = null;
  private observedCard: HTMLElement | null = null;
  private observedViewport: HTMLElement | null = null;
  private watchedAnimations = new WeakSet<Animation>();

  constructor(private readonly port: ActiveZoomPort) {}

  isEnabled(): boolean { return this.enabled; }

  enable(): void {
    if (!this.enabled) {
      this.enabled = true;
      this.port.onEnabledChanged(true);
    }
    this.schedule();
  }

  disable(): void {
    this.generation++;
    if (this.frame) this.frame.win.cancelAnimationFrame(this.frame.id);
    this.frame = null;
    this.observer?.disconnect();
    this.observer = null;
    this.observedCard = null;
    this.observedViewport = null;
    this.watchedAnimations = new WeakSet();
    if (this.enabled) {
      this.enabled = false;
      this.port.onEnabledChanged(false);
    }
  }

  reset(): void { this.disable(); }

  schedule(): void {
    if (!this.enabled || this.frame) return;
    const target = this.port.getTarget();
    const win = target?.card.ownerDocument.defaultView;
    if (!target || !win) return;
    const generation = this.generation;
    const id = win.requestAnimationFrame(() => {
      if (generation !== this.generation || !this.enabled) return;
      this.frame = null;
      const current = this.port.getTarget();
      if (!current || !current.card.isConnected || !current.viewport.isConnected) return;
      this.observe(current);
      this.followAnimationCompletion(current);
      this.port.prepareTarget?.(current);
      const rect = current.card.getBoundingClientRect();
      const zoom = this.port.getZoom();
      if (rect.width <= 0 || rect.height <= 0 || zoom <= 0
        || current.viewport.clientWidth <= 48 || current.viewport.clientHeight <= 48) return;
      const { min, max } = this.port.getBounds();
      const size = this.port.getNaturalSize?.(current, zoom) ?? { width: rect.width / zoom, height: rect.height / zoom };
      if (size.width <= 0 || size.height <= 0) return;
      const fit = Math.max(min, Math.min(max,
        (current.viewport.clientWidth - 48) / size.width,
        (current.viewport.clientHeight - 48) / size.height));
      const next = Math.round(fit * 1000) / 1000;
      if (Math.abs(next - zoom) >= 0.003) {
        this.port.applyZoom(next);
        // CSS min-heights, editor caps and scrollbars need not scale linearly.
        // Re-measure the result even when ResizeObserver's content box is stable.
        this.schedule();
      }
      this.port.center(current);
    });
    this.frame = { win, id };
  }

  private observe(target: ActiveZoomTarget): void {
    if (this.observedCard === target.card && this.observedViewport === target.viewport) return;
    this.observer?.disconnect();
    this.observedCard = target.card;
    this.observedViewport = target.viewport;
    const win = target.card.ownerDocument.defaultView;
    if (!win || typeof win.ResizeObserver !== "function") return;
    const generation = this.generation;
    this.observer = new win.ResizeObserver(() => {
      if (generation === this.generation && this.enabled) this.schedule();
    });
    this.observer.observe(target.card);
    this.observer.observe(target.viewport);
  }

  private followAnimationCompletion(target: ActiveZoomTarget): void {
    for (const element of [target.card, target.card.parentElement]) {
      if (!element || typeof element.getAnimations !== "function") continue;
      for (const animation of element.getAnimations()) {
        if (this.watchedAnimations.has(animation)) continue;
        this.watchedAnimations.add(animation);
        const generation = this.generation;
        void animation.finished.then(() => {
          if (this.enabled && generation === this.generation && this.port.getTarget()?.card === target.card) this.schedule();
        }, () => {});
      }
    }
  }
}
