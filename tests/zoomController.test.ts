import { afterEach, describe, expect, it, vi } from "vitest";
import { ZoomController } from "../src/view/interaction/ZoomController";

describe("ZoomController", () => {
  it("uses each scheduled owner and rejects stale callbacks after reset and rescheduling", () => {
    const frames: FrameRequestCallback[] = [];
    const timers: (() => void)[] = [];
    const firstOwner = {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return 1; },
      cancelAnimationFrame: vi.fn(),
      setTimeout: (callback: () => void) => { timers.push(callback); return 1; }, clearTimeout: vi.fn()
    };
    const globalOwner = { requestAnimationFrame: vi.fn(), setTimeout: vi.fn(), cancelAnimationFrame: vi.fn(), clearTimeout: vi.fn() };
    vi.stubGlobal("window", globalOwner);
    let owner = firstOwner;
    let zoom = 1;
    let saves = 0;
    let hides = 0;
    const controller = activeController = new ZoomController({
      getWindow: () => owner as unknown as Window,
      getZoom: () => zoom, setZoom: value => { zoom = value; }, saveSettings: async () => { saves++; },
      applyZoom: vi.fn(), flashIndicator: vi.fn(), hideIndicator: () => { hides++; }, afterZoom: vi.fn()
    });
    controller.queueOverviewWheel(-1);
    controller.scheduleTouchZoom(1.5);
    expect(frames).toHaveLength(2);
    frames[0](0);
    expect(zoom).toBe(1.06);
    expect(timers).toHaveLength(2);
    owner = { ...firstOwner, cancelAnimationFrame: vi.fn(), clearTimeout: vi.fn() };
    controller.reset();
    expect(firstOwner.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(firstOwner.clearTimeout).toHaveBeenCalledTimes(2);
    expect(owner.cancelAnimationFrame).not.toHaveBeenCalled();
    controller.scheduleTouchZoom(2);
    frames[1](0);
    timers.forEach(callback => callback());
    expect(zoom).toBe(1.06);
    expect([saves, hides]).toEqual([0, 0]);
    frames[2](0);
    expect(zoom).toBe(2);
    expect(globalOwner.requestAnimationFrame).not.toHaveBeenCalled();
    expect(globalOwner.setTimeout).not.toHaveBeenCalled();
  });
  it("announces manual zoom intent even when already at the limit", () => {
    let active = true;
    const controller = new ZoomController({
      getZoom: () => 5,
      onManualZoom: () => { active = false; },
      setZoom: () => { throw Error("At the boundary no zoom write is needed"); },
      saveSettings: async () => undefined, applyZoom: () => {}, flashIndicator: () => {},
      hideIndicator: () => {}, afterZoom: () => {}
    });
    controller.updateZoomLevel(6);
    expect(active).toBe(false);
  });
  it("honors configured bounds for direct, wheel and queued touch inputs", () => {
    let zoom = 1;
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frame = callback; return 1; },
      cancelAnimationFrame: vi.fn(), setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout
    });
    const controller = activeController = new ZoomController({
      getZoom: () => zoom, getZoomBounds: () => ({ min: 0.5, max: 2 }),
      setZoom: (value) => { zoom = value; }, saveSettings: async () => undefined,
      applyZoom: vi.fn(), flashIndicator: vi.fn(), hideIndicator: vi.fn(), afterZoom: vi.fn()
    });
    controller.updateZoomLevel(4);
    expect(zoom).toBe(2);
    controller.queueOverviewWheel(-1);
    frame!(0);
    expect(zoom).toBe(2);
    controller.scheduleTouchZoom(0.1);
    frame!(0);
    expect(zoom).toBe(0.5);
  });
  let activeController: ZoomController | null = null;

  afterEach(() => {
    activeController?.reset();
    activeController = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("persists the final normalized zoom once after the 180ms debounce", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      requestAnimationFrame: vi.fn(),
      cancelAnimationFrame: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    let zoom = 1;
    const saveSettings = vi.fn(async () => undefined);
    const controller = activeController = new ZoomController({
      getZoom: () => zoom,
      setZoom: (value) => { zoom = value; },
      saveSettings,
      applyZoom: vi.fn(),
      flashIndicator: vi.fn(),
      hideIndicator: vi.fn(),
      afterZoom: vi.fn()
    });

    controller.updateZoomLevel(0.5004);
    controller.updateZoomLevel(0.25);

    await vi.advanceTimersByTimeAsync(179);
    expect(saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(zoom).toBe(0.25);

    controller.reset();
  });

  it("accumulates overview wheel factors against pending zoom in one frame", () => {
    let zoom = 1;
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const applyZoom = vi.fn();
    const afterZoom = vi.fn();
    const controller = activeController = new ZoomController({
      getZoom: () => zoom,
      setZoom: (value) => { zoom = value; },
      saveSettings: async () => undefined,
      applyZoom,
      flashIndicator: vi.fn(),
      hideIndicator: vi.fn(),
      afterZoom
    });

    controller.queueOverviewWheel(-1);
    controller.queueOverviewWheel(-1);
    expect(zoom).toBe(1);
    expect(frame).not.toBeNull();
    frame!(0);

    expect(zoom).toBe(1.124);
    expect(applyZoom).toHaveBeenCalledTimes(1);
    expect(afterZoom).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued touch zoom before its animation frame", () => {
    let frame: FrameRequestCallback | null = null;
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frame = callback;
        return 2;
      },
      cancelAnimationFrame,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const setZoom = vi.fn();
    const controller = activeController = new ZoomController({
      getZoom: () => 1,
      setZoom,
      saveSettings: async () => undefined,
      applyZoom: vi.fn(),
      flashIndicator: vi.fn(),
      hideIndicator: vi.fn(),
      afterZoom: vi.fn()
    });

    controller.scheduleTouchZoom(1.2);
    controller.clearTouchZoomFrame();
    frame!(0);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("hides the flashed indicator after exactly 1100ms", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      requestAnimationFrame: vi.fn(),
      cancelAnimationFrame: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const flashIndicator = vi.fn();
    const hideIndicator = vi.fn();
    const controller = activeController = new ZoomController({
      getZoom: () => 1,
      setZoom: vi.fn(),
      saveSettings: async () => undefined,
      applyZoom: vi.fn(),
      flashIndicator,
      hideIndicator,
      afterZoom: vi.fn()
    });

    controller.updateZoomLevel(1.1);
    await vi.advanceTimersByTimeAsync(1099);
    expect(flashIndicator).toHaveBeenCalledTimes(1);
    expect(hideIndicator).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(hideIndicator).toHaveBeenCalledTimes(1);
  });
});
