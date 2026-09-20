import { afterEach, describe, expect, it, vi } from "vitest";
import { TouchController } from "../src/view/interaction/TouchController";

class GestureViewport extends EventTarget {
  scrollLeft = 100;
  scrollTop = 200;
  readonly captured = new Set<number>();
  readonly classes = new Set<string>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    void options;
    super.addEventListener(type, listener);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    void options;
    super.removeEventListener(type, listener);
  }

  setPointerCapture(pointerId: number): void { this.captured.add(pointerId); }
  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
    this.dispatchEvent(pointer("lostpointercapture", pointerId, 0, 0));
  }
  hasPointerCapture(pointerId: number): boolean { return this.captured.has(pointerId); }
  getBoundingClientRect(): DOMRect { return { left: 10, top: 20 } as DOMRect; }
  closest(): null { return null; }
  addClass(name: string): void { this.classes.add(name); }
  removeClass(name: string): void { this.classes.delete(name); }
}

function pointer(type: string, pointerId: number, x: number, y: number, target?: EventTarget): PointerEvent {
  const event = new Event(type, { cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
    clientX: { value: x },
    clientY: { value: y }
  });
  if (target) Object.defineProperty(event, "target", { value: target, configurable: true });
  return event;
}

describe("TouchController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("schedules one branch pinch zoom, suppresses its click, and releases captures after cancellation", () => {
    vi.stubGlobal("Element", class {});
    const requestedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        requestedFrames.push(callback);
        return requestedFrames.length;
      },
      cancelAnimationFrame: vi.fn()
    });
    const viewport = new GestureViewport();
    const scheduleZoom = vi.fn();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom,
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    const dispose = controller.bindBranchTouch(viewport as unknown as HTMLElement);

    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
    viewport.dispatchEvent(pointer("pointercancel", 2, 170, 20));
    viewport.dispatchEvent(pointer("pointerup", 1, 20, 20));
    const click = new Event("click", { cancelable: true });
    viewport.dispatchEvent(click);

    expect(scheduleZoom).toHaveBeenCalledTimes(1);
    expect(scheduleZoom).toHaveBeenCalledWith(1.5);
    expect(click.defaultPrevented).toBe(true);
    expect(viewport.captured).toEqual(new Set());
    expect(viewport.classes.has("is-touch-pinching")).toBe(false);

    dispose();
  });

  it("does not suppress an ordinary overview tap and excludes editor and link targets", () => {
    class InteractiveTarget extends EventTarget {
      closest(): InteractiveTarget { return this; }
    }
    vi.stubGlobal("Element", InteractiveTarget);
    const viewport = new GestureViewport();
    const branchViewport = new GestureViewport();
    const scheduleZoom = vi.fn();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom,
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    const dispose = controller.bindOverviewTouch(viewport as unknown as HTMLElement);
    const disposeBranch = controller.bindBranchTouch(branchViewport as unknown as HTMLElement);
    viewport.dispatchEvent(pointer("pointerdown", 10, 20, 20));
    viewport.dispatchEvent(pointer("pointerup", 10, 20, 20));
    const ordinaryClick = new Event("click", { cancelable: true });
    viewport.dispatchEvent(ordinaryClick);
    const interactiveTargets = [new InteractiveTarget(), new InteractiveTarget(), new InteractiveTarget()];

    for (const [index, target] of interactiveTargets.entries()) {
      const pointerId = index + 1;
      viewport.dispatchEvent(pointer("pointerdown", pointerId, 20, 20, target));
      viewport.dispatchEvent(pointer("pointermove", pointerId, 80, 20, target));
      viewport.dispatchEvent(pointer("pointerup", pointerId, 80, 20, target));
      branchViewport.dispatchEvent(pointer("pointerdown", pointerId, 20, 20, target));
      branchViewport.dispatchEvent(pointer("pointermove", pointerId, 80, 20, target));
      branchViewport.dispatchEvent(pointer("pointerup", pointerId, 80, 20, target));
    }
    const click = new Event("click", { cancelable: true });
    viewport.dispatchEvent(click);

    expect(scheduleZoom).not.toHaveBeenCalled();
    expect(ordinaryClick.defaultPrevented).toBe(false);
    expect(click.defaultPrevented).toBe(false);
    expect(viewport.captured).toEqual(new Set());
    expect(branchViewport.captured).toEqual(new Set());

    dispose();
    disposeBranch();
  });

  it("zooms and pans the overview through a pinch followed by one-finger movement", () => {
    vi.stubGlobal("Element", class {});
    const viewport = new GestureViewport();
    const scheduleZoom = vi.fn();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom,
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 10, top: 20 }),
      revealCompactSelection: vi.fn()
    });
    const dispose = controller.bindOverviewTouch(viewport as unknown as HTMLElement);

    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
    viewport.dispatchEvent(pointer("pointerup", 2, 170, 20));
    viewport.dispatchEvent(pointer("pointermove", 1, 40, 20));

    expect(scheduleZoom).toHaveBeenCalledWith(1.5);
    expect(viewport.scrollLeft).toBe(130);
    expect(viewport.scrollTop).toBe(290);
    dispose();
  });

  it("suppresses touch clicks for 499ms but accepts them at 500ms", () => {
    vi.stubGlobal("Element", class {});
    vi.stubGlobal("window", { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const viewport = new GestureViewport();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom: vi.fn(),
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    const dispose = controller.bindBranchTouch(viewport as unknown as HTMLElement);
    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));

    now.mockReturnValue(1_499);
    const earlyClick = new Event("click", { cancelable: true });
    viewport.dispatchEvent(earlyClick);
    now.mockReturnValue(1_500);
    const boundaryClick = new Event("click", { cancelable: true });
    viewport.dispatchEvent(boundaryClick);

    expect(earlyClick.defaultPrevented).toBe(true);
    expect(boundaryClick.defaultPrevented).toBe(false);
    dispose();
  });

  it("keeps overview touch tracked after descendant loss but ends it on viewport loss", () => {
    vi.stubGlobal("Element", class {});
    const viewport = new GestureViewport();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom: vi.fn(),
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    const dispose = controller.bindOverviewTouch(viewport as unknown as HTMLElement);
    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("lostpointercapture", 1, 20, 20, new EventTarget()));
    viewport.dispatchEvent(pointer("pointermove", 1, 40, 20));

    expect(viewport.scrollLeft).toBe(80);

    viewport.dispatchEvent(pointer("lostpointercapture", 1, 40, 20));
    viewport.dispatchEvent(pointer("pointermove", 1, 60, 20));

    expect(viewport.scrollLeft).toBe(80);
    dispose();
  });

  it("cancels a queued compact-selection reveal when its binding is disposed", () => {
    vi.stubGlobal("Element", class {});
    const frames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame
    });
    const revealCompactSelection = vi.fn();
    const viewport = new GestureViewport();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom: vi.fn(),
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection
    });
    const dispose = controller.bindBranchTouch(viewport as unknown as HTMLElement);
    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
    viewport.dispatchEvent(pointer("pointercancel", 2, 170, 20));
    dispose();
    frames[0](0);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(revealCompactSelection).not.toHaveBeenCalled();
  });

  it("cleans a standalone binding so it can be disposed twice and rebound without stale gestures", () => {
    vi.stubGlobal("Element", class {});
    vi.stubGlobal("window", { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
    const viewport = new GestureViewport();
    const scheduleZoom = vi.fn();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom,
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    const dispose = controller.bindBranchTouch(viewport as unknown as HTMLElement);
    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
    dispose();
    dispose();
    scheduleZoom.mockClear();

    const reboundDispose = controller.bindBranchTouch(viewport as unknown as HTMLElement);
    viewport.dispatchEvent(pointer("pointerdown", 3, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 4, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 4, 170, 20));

    expect(viewport.captured).toEqual(new Set([4]));
    expect(scheduleZoom).toHaveBeenCalledTimes(1);
    reboundDispose();
  });

  it("shares pinch click suppression between the branch editor and Tree Overview", () => {
    vi.stubGlobal("Element", class {});
    vi.stubGlobal("window", {
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn()
    });
    const branchViewport = new GestureViewport();
    const overviewViewport = new GestureViewport();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom: vi.fn(),
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    controller.bindBranchTouch(branchViewport as unknown as HTMLElement);
    controller.bindOverviewTouch(overviewViewport as unknown as HTMLElement);

    branchViewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    branchViewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    branchViewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
    const overviewClick = new Event("click", { cancelable: true });
    overviewViewport.dispatchEvent(overviewClick);

    expect(overviewClick.defaultPrevented).toBe(true);
  });

  it("removes handlers before reset releases captures, so lost capture cannot queue a reveal", () => {
    vi.stubGlobal("Element", class {});
    const requestedFrames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        requestedFrames.push(callback);
        return requestedFrames.length;
      },
      cancelAnimationFrame
    });
    const viewport = new GestureViewport();
    const controller = new TouchController({
      getZoom: () => 1,
      scheduleZoom: vi.fn(),
      hasEditingSession: () => false,
      usesTouchControls: () => true,
      getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    controller.bindBranchTouch(viewport as unknown as HTMLElement);

    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
    controller.reset();

    expect(viewport.captured).toEqual(new Set());
    expect(viewport.classes.has("is-touch-pinching")).toBe(false);
    expect(requestedFrames).toEqual([]);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });
});
