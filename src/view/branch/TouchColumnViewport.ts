interface ColumnPosition {
  list: HTMLElement;
  target: HTMLElement;
  paddingTop: number;
  paddingBottom: number;
  desired: number | null;
  manual: boolean;
  stopTracking(): void;
}

/** Native tablet columns own vertical scrolling; the scene owns horizontal pan. */
export class TouchColumnViewport {
  private readonly positions = new Map<HTMLElement, ColumnPosition>();
  private paused = false;

  align(list: HTMLElement, target: HTMLElement, instant: boolean, force = false): void {
    this.prune();
    if (this.paused || list.clientHeight <= 0) return;
    let position = this.positions.get(list);
    const changedTarget = position?.target !== target;
    const initial = !position;
    if (!position) {
      const created: ColumnPosition = { list, target, paddingTop: 0, paddingBottom: 0, desired: null, manual: false, stopTracking: () => {} };
      const manualInput = (event: Event) => {
        if (event.type !== "touchstart" || (event as TouchEvent).touches.length === 1) created.manual = true;
      };
      list.addEventListener("touchstart", manualInput, { passive: true });
      list.addEventListener("wheel", manualInput, { passive: true });
      created.stopTracking = () => {
        list.removeEventListener("touchstart", manualInput);
        list.removeEventListener("wheel", manualInput);
      };
      position = created;
      this.positions.set(list, position);
    }
    position.target = target;
    if (changedTarget || instant || force) position.manual = false;
    this.measure(position, !initial);
    const desired = this.targetTop(position);
    if (initial || changedTarget || instant || force || position.desired === null || (!position.manual && Math.abs(desired - position.desired) > 0.5)) {
      const reduced = list.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
      list.scrollTo({ top: desired, behavior: initial || instant || reduced ? "instant" : "smooth" });
    }
    position.desired = desired;
  }

  refresh(): void {
    this.prune();
    if (this.paused) return;
    for (const position of this.positions.values()) {
      if (position.list.clientHeight <= 0) continue;
      this.measure(position, true);
      position.desired = this.targetTop(position);
    }
  }

  pause(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      for (const { list } of this.positions.values()) {
        list.scrollTo({ top: list.scrollTop, behavior: "instant" });
      }
    } else this.refresh();
  }

  reset(): void {
    for (const position of this.positions.values()) position.stopTracking();
    this.positions.clear(); this.paused = false;
  }

  private measure(position: ColumnPosition, preserve: boolean): void {
    const { list } = position;
    const first = list.firstElementChild as HTMLElement | null;
    const last = list.lastElementChild as HTMLElement | null;
    const top = Math.max(0, list.clientHeight * 0.44 - (first?.offsetHeight ?? 0) / 2);
    const bottom = Math.max(0, list.clientHeight * 0.56 - (last?.offsetHeight ?? 0) / 2);
    if (Math.abs(top - position.paddingTop) < 0.5 && Math.abs(bottom - position.paddingBottom) < 0.5) return;
    const delta = preserve ? top - position.paddingTop : 0;
    // Shrinking padding can clamp scrollTop. Move the anchor before that clamp.
    if (delta < 0) list.scrollTop += delta;
    list.setCssProps({ "--arbor-touch-list-top": `${top}px`, "--arbor-touch-list-bottom": `${bottom}px` });
    if (delta > 0) list.scrollTop += delta;
    if (position.desired !== null) position.desired += delta;
    position.paddingTop = top;
    position.paddingBottom = bottom;
  }

  private targetTop({ list, target }: ColumnPosition): number {
    // Selection transforms can shift a tall card by hundreds of screen pixels.
    // Native scrolling uses layout coordinates, never the temporary animation.
    const top = this.layoutTop(target) - this.layoutTop(list);
    const desired = target.offsetHeight > list.clientHeight - 48
      ? top - 24 : top + target.offsetHeight / 2 - list.clientHeight * 0.44;
    return Math.max(0, Math.min(desired, list.scrollHeight - list.clientHeight));
  }

  private layoutTop(element: HTMLElement): number {
    let top = 0;
    for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
    return top;
  }

  private prune(): void {
    for (const [list, position] of this.positions) {
      if (!list.isConnected || !position.target.isConnected || !list.contains(position.target)) {
        position.stopTracking();
        this.positions.delete(list);
      }
    }
  }
}
