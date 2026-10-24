/** Owner-window subscriptions; resize and viewport scroll share a single frame. */
export class MobileViewportController {
  private frame: number | null = null;
  private disposed = false;
  private readonly observer: ResizeObserver;
  private readonly owner: Window;
  private readonly viewport: VisualViewport | null;
  private readonly transition = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.matches?.(".mobile-navbar, .mobile-toolbar")) this.schedule();
  };

  constructor(private readonly root: HTMLElement, private readonly resize: () => void) {
    this.owner = root.win;
    this.viewport = this.owner.visualViewport;
    this.observer = new (root.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver(() => this.schedule());
    this.observer.observe(root);
    root.ownerDocument.querySelectorAll(".mobile-navbar, .mobile-toolbar").forEach(bar => this.observer.observe(bar));
    this.viewport?.addEventListener("resize", this.schedule);
    this.viewport?.addEventListener("scroll", this.schedule);
    this.owner.addEventListener("resize", this.schedule);
    root.ownerDocument.addEventListener("transitionend", this.transition, true);
    this.schedule();
  }

  schedule = (): void => {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.owner.requestAnimationFrame(() => {
      this.frame = null;
      if (!this.disposed) this.resize();
    });
  };

  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) this.owner.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.observer.disconnect();
    this.viewport?.removeEventListener("resize", this.schedule);
    this.viewport?.removeEventListener("scroll", this.schedule);
    this.owner.removeEventListener("resize", this.schedule);
    this.root.ownerDocument.removeEventListener("transitionend", this.transition, true);
  }
}
