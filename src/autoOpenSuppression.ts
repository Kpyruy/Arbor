export class AutoOpenSuppression {
  private readonly untilByPath = new Map<string, number>();

  constructor(private readonly durationMs: number) {}

  suppress(path: string, now = Date.now()): void {
    this.untilByPath.set(path, now + this.durationMs);
  }

  isSuppressed(path: string, now = Date.now()): boolean {
    const until = this.untilByPath.get(path);
    if (until === undefined) {
      return false;
    }
    if (until <= now) {
      this.untilByPath.delete(path);
      return false;
    }
    return true;
  }
}
