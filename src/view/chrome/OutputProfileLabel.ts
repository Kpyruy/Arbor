export class OutputProfileLabel {
  private readonly label: HTMLElement;
  private readonly text: HTMLElement;
  private readonly observer: ResizeObserver;
  private readonly motion: MediaQueryList;
  private animation: Animation | null = null;
  private hovered = false;
  private disposed = false;

  constructor(private readonly button: HTMLButtonElement) {
    const initial = button.textContent ?? "";
    button.empty();
    this.label = button.createSpan({ cls: "arbor-output-profile-label", attr: { dir: "auto" } });
    this.text = this.label.createSpan({ cls: "arbor-output-profile-text", text: initial });
    const win = button.ownerDocument.defaultView ?? window;
    this.motion = win.matchMedia("(prefers-reduced-motion: reduce)");
    this.observer = new ResizeObserver(this.refresh);
    this.observer.observe(this.label);
    button.addEventListener("mouseenter", this.enter);
    button.addEventListener("mouseleave", this.leave);
    this.motion.addEventListener("change", this.refresh);
  }

  setText(value: string): void {
    if (this.disposed || this.text.textContent === value) return;
    this.stop();
    this.text.setText(value);
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.observer.disconnect();
    this.motion.removeEventListener("change", this.refresh);
    this.button.removeEventListener("mouseenter", this.enter);
    this.button.removeEventListener("mouseleave", this.leave);
  }

  private readonly enter = (): void => {
    this.hovered = true;
    this.refresh();
  };

  private readonly leave = (): void => {
    this.hovered = false;
    this.stop();
  };

  private readonly refresh = (): void => {
    this.stop();
    if (this.disposed || !this.hovered || this.motion.matches || !this.button.isConnected) return;
    const distance = this.text.getBoundingClientRect().width - this.label.clientWidth;
    if (distance <= 1) return;
    const win = this.button.ownerDocument.defaultView ?? window;
    const offset = win.getComputedStyle(this.label).direction === "rtl" ? distance : -distance;
    this.label.addClass("is-marquee");
    this.animation = this.text.animate([
      { transform: "translateX(0)", offset: 0 },
      { transform: "translateX(0)", offset: 0.1 },
      { transform: `translateX(${offset}px)`, offset: 0.45 },
      { transform: `translateX(${offset}px)`, offset: 0.55 },
      { transform: "translateX(0)", offset: 0.9 },
      { transform: "translateX(0)", offset: 1 }
    ], { duration: Math.max(6000, distance * 2 / 18 * 1000 + 2000), iterations: Infinity, easing: "linear" });
  };

  private stop(): void {
    this.animation?.cancel();
    this.animation = null;
    this.label.removeClass("is-marquee");
  }
}
