export class ViewWorkScope {
  private generation = 0;
  private disposed = false;
  private cleanups = new Set<() => void>();

  token(): number {
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return !this.disposed && token === this.generation;
  }

  register(cleanup: () => void): () => void {
    let active = true;
    const cancel = () => {
      if (!active) return;
      active = false;
      this.cleanups.delete(cancel);
      cleanup();
    };
    if (this.disposed) cancel();
    else this.cleanups.add(cancel);
    return cancel;
  }

  timeout(callback: () => void, delay: number, win: Window = window): () => void {
    if (this.disposed) return () => undefined;
    const token = this.token();
    const id = win.setTimeout(() => {
      cancel();
      if (this.isCurrent(token)) callback();
    }, delay);
    const cancel = this.register(() => win.clearTimeout(id));
    return cancel;
  }

  frame(win: Window, callback: (time: number) => void): () => void {
    if (this.disposed) return () => undefined;
    const token = this.token();
    const id = win.requestAnimationFrame((time) => {
      cancel();
      if (this.isCurrent(token)) callback(time);
    });
    const cancel = this.register(() => win.cancelAnimationFrame(id));
    return cancel;
  }

  reset(): void {
    this.generation += 1;
    for (const cancel of this.cleanups) cancel();
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
