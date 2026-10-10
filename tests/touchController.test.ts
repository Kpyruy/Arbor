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
  contains(target: Node | null): boolean { return target !== null; }
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
  it("owns branch reveal frames in the viewport window and rejects stale reused IDs", () => {
    vi.stubGlobal("Element", class {});
    const frames: FrameRequestCallback[] = [];
    const owner = {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return 1; },
      cancelAnimationFrame: vi.fn()
    };
    const globalOwner = { requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn() };
    vi.stubGlobal("window", globalOwner);
    const viewport = new GestureViewport();
    Object.defineProperty(viewport, "ownerDocument", { value: { defaultView: owner } });
    let reveals = 0;
    const controller = new TouchController({
      getZoom: () => 1, scheduleZoom: () => {}, hasEditingSession: () => false,
      usesTouchControls: () => true, getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: () => { reveals++; }
    });
    const gesture = () => {
      viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
      viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
      viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
      viewport.dispatchEvent(pointer("pointerup", 2, 170, 20));
    };
    const dispose = controller.bindBranchTouch(viewport as unknown as HTMLElement);
    gesture();
    dispose();
    expect(owner.cancelAnimationFrame).toHaveBeenCalledWith(1);
    const disposeAgain = controller.bindBranchTouch(viewport as unknown as HTMLElement);
    gesture();
    frames[0](0);
    expect(reveals).toBe(0);
    frames[1](0);
    expect(reveals).toBe(1);
    expect(globalOwner.requestAnimationFrame).not.toHaveBeenCalled();
    disposeAgain();
  });
  it.each(["branch", "overview"] as const)("honors configured %s pinch bounds and overview anchor geometry", (mode) => {
    vi.stubGlobal("Element", class {});
    const viewport = new GestureViewport();
    let zoom = 1;
    const controller = new TouchController({
      getZoom: () => zoom, getZoomBounds: () => ({ min: 0.5, max: 2 }),
      scheduleZoom: (value) => { zoom = value; }, hasEditingSession: () => false,
      usesTouchControls: () => true, getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
      revealCompactSelection: vi.fn()
    });
    const dispose = mode === "branch" ? controller.bindBranchTouch(viewport as unknown as HTMLElement) : controller.bindOverviewTouch(viewport as unknown as HTMLElement);
    viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
    viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
    viewport.dispatchEvent(pointer("pointermove", 2, 420, 20));
    expect(zoom).toBe(2);
    if (mode === "overview") {
      expect(viewport.scrollLeft).toBe(110);
      expect(viewport.scrollTop).toBe(400);
    }
    dispose();
  });
  afterEach(() => {
    vi.restoreAllMocks();
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

  describe.each(["branch", "overview"] as const)("%s link taps after a gesture", (mode) => {
    function setup() {
      class Link extends EventTarget {
        nodeType = 1;
        closest(selector: string): Link | null { return selector === "a" ? this : null; }
      }
      vi.stubGlobal("Element", Link);
      vi.stubGlobal("window", { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
      const now = vi.spyOn(Date, "now").mockReturnValue(1000);
      const viewport = new GestureViewport();
      const controller = new TouchController({
        getZoom: () => 1, scheduleZoom: vi.fn(), hasEditingSession: () => false,
        usesTouchControls: () => true, getOverviewSceneOffset: () => ({ left: 0, top: 0 }),
        revealCompactSelection: vi.fn()
      });
      const dispose = mode === "branch"
        ? controller.bindBranchTouch(viewport as unknown as HTMLElement)
        : controller.bindOverviewTouch(viewport as unknown as HTMLElement);
      viewport.dispatchEvent(pointer("pointerdown", 1, 20, 20));
      viewport.dispatchEvent(pointer("pointerdown", 2, 120, 20));
      viewport.dispatchEvent(pointer("pointermove", 2, 170, 20));
      viewport.dispatchEvent(pointer("pointerup", 2, 170, 20));
      viewport.dispatchEvent(pointer("pointerup", 1, 20, 20));
      now.mockReturnValue(1100);
      const anchor = new Link();
      const click = (target: EventTarget = anchor, fields: Record<string, string | number> = {}) => {
        const event = new Event("click", { cancelable: true });
        Object.defineProperties(event, {
          target: { value: target }, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }]))
        });
        viewport.dispatchEvent(event);
        return event;
      };
      return { viewport, controller, dispose, anchor, now, click };
    }

    it("blocks a ghost link click without a new pointerdown", () => {
      const f = setup();
      expect(f.click().defaultPrevented).toBe(true);
      f.dispose();
    });

    it("allows one fresh tap immediately, not a second compatibility click", () => {
      const f = setup();
      f.viewport.dispatchEvent(pointer("pointerdown", 20, 30, 30, f.anchor));
      f.viewport.dispatchEvent(pointer("pointerup", 20, 30, 30, f.anchor));
      expect(f.click().defaultPrevented).toBe(false);
      expect(f.click().defaultPrevented).toBe(true);
      f.dispose();
    });

    it.each(["move", "cancel", "second-pointer", "other-link"])("invalidates a fresh tap after %s", (reason) => {
      const f = setup();
      f.viewport.dispatchEvent(pointer("pointerdown", 20, 30, 30, f.anchor));
      if (reason === "move") f.viewport.dispatchEvent(pointer("pointermove", 20, 39, 30, f.anchor));
      if (reason === "cancel") f.viewport.dispatchEvent(pointer("pointercancel", 20, 30, 30, f.anchor));
      if (reason === "second-pointer") {
        f.viewport.dispatchEvent(pointer("pointerdown", 21, 40, 30, f.anchor));
        f.viewport.dispatchEvent(pointer("pointerup", 21, 40, 30, f.anchor));
      }
      const target = reason === "other-link" ? new EventTarget() : f.anchor;
      f.viewport.dispatchEvent(pointer("pointerup", 20, 30, 30, target));
      expect(f.click().defaultPrevented).toBe(true);
      f.dispose();
    });

    it("keeps a valid token scoped to its link", () => {
      const f = setup();
      f.viewport.dispatchEvent(pointer("pointerdown", 20, 30, 30, f.anchor));
      f.viewport.dispatchEvent(pointer("pointerup", 20, 30, 30, f.anchor));
      expect(f.click(new EventTarget()).defaultPrevented).toBe(true);
      f.dispose();
    });

    it("does not suppress explicit mouse or keyboard activation", () => {
      const f = setup();
      expect(f.click(f.anchor, { pointerType: "mouse", detail: 1 }).defaultPrevented).toBe(false);
      expect(f.click(f.anchor, { detail: 0 }).defaultPrevented).toBe(false);
      f.dispose();
    });

    it("discards a fresh token when disposed and rebound", () => {
      const f = setup();
      f.viewport.dispatchEvent(pointer("pointerdown", 20, 30, 30, f.anchor));
      f.viewport.dispatchEvent(pointer("pointerup", 20, 30, 30, f.anchor));
      f.dispose();
      const dispose = mode === "branch"
        ? f.controller.bindBranchTouch(f.viewport as unknown as HTMLElement)
        : f.controller.bindOverviewTouch(f.viewport as unknown as HTMLElement);
      expect(f.click().defaultPrevented).toBe(true);
      dispose();
    });

    it("does not reuse an expired tap during a later gesture suppression window", () => {
      const f = setup();
      f.viewport.dispatchEvent(pointer("pointerdown", 20, 30, 30, f.anchor));
      f.viewport.dispatchEvent(pointer("pointerup", 20, 30, 30, f.anchor));
      const other = new GestureViewport();
      const disposeOther = f.controller.bindOverviewTouch(other as unknown as HTMLElement);
      f.now.mockReturnValue(1300);
      other.dispatchEvent(pointer("pointerdown", 30, 20, 20));
      other.dispatchEvent(pointer("pointermove", 30, 50, 20));
      other.dispatchEvent(pointer("pointerup", 30, 50, 20));
      f.now.mockReturnValue(1700);
      expect(f.click().defaultPrevented).toBe(true);
      disposeOther();
      f.dispose();
    });

    it("does not mistake an explicitly touch-origin click for keyboard activation", () => {
      const f = setup();
      expect(f.click(f.anchor, { pointerType: "touch", detail: 0 }).defaultPrevented).toBe(true);
      f.dispose();
    });

    it("rejects a moved pointerup even when no pointermove was delivered", () => {
      const f = setup();
      f.viewport.dispatchEvent(pointer("pointerdown", 20, 30, 30, f.anchor));
      f.viewport.dispatchEvent(pointer("pointerup", 20, 40, 30, f.anchor));
      expect(f.click().defaultPrevented).toBe(true);
      f.dispose();
    });
  });
});
