export class ArborBadgeGeneration {
  private generation = 0;
  private disposed = false;

  beginRefresh(): number {
    return ++this.generation;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}
