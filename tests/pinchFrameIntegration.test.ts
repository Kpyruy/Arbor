import { afterEach, describe, expect, it, vi } from "vitest";
import { TouchController } from "../src/view/interaction/TouchController";
import { ZoomController } from "../src/view/interaction/ZoomController";

class Viewport extends EventTarget {
  scrollLeft = 100;
  scrollTop = 200;
  classes = new Set<string>();
  closest() { return null; }
  contains() { return true; }
  addClass(name: string) { this.classes.add(name); }
  removeClass(name: string) { this.classes.delete(name); }
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() { return { left: 10, top: 20 }; }
}

function fixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const owner = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (key: number) => frames.delete(key),
    setTimeout, clearTimeout
  };
  vi.stubGlobal("window", owner);
  let zoom = 1;
  let editing = false;
  const viewport = new Viewport();
  const applied: number[] = [];
  const zooms = new ZoomController({
    canApplyTouchZoom: () => !editing,
    getWindow: () => owner as unknown as Window, getZoom: () => zoom, setZoom: value => { zoom = value; },
    applyZoom: () => { applied.push(zoom); }, afterZoom: () => {},
    saveSettings: async () => {}, flashIndicator: () => {}, hideIndicator: () => {}
  });
  const touches = new TouchController({
    getZoom: () => zoom, scheduleZoom: (value, commit) => zooms.scheduleTouchZoom(value, commit),
    flushZoom: () => zooms.flushTouchZoom(), cancelZoom: () => zooms.clearTouchZoomFrame(),
    hasEditingSession: () => false, usesTouchControls: () => true,
    getOverviewSceneOffset: () => ({ left: 0, top: 0 }), revealCompactSelection: () => {}
  });
  const dispose = touches.bindOverviewTouch(viewport as unknown as HTMLElement);
  const pointer = (type: string, pointerId: number, x: number) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { pointerType: { value: "touch" }, pointerId: { value: pointerId }, clientX: { value: x }, clientY: { value: 20 } });
    viewport.dispatchEvent(event);
  };
  const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
  const close = () => { dispose(); zooms.reset(); };
  pointer("pointerdown", 1, 20); pointer("pointerdown", 2, 120);
  return { viewport, zooms, pointer, frame, close, applied, zoom: () => zoom, frames, startEditing: () => { editing = true; } };
}

afterEach(() => vi.unstubAllGlobals());
describe("real touch and zoom frame integration", () => {
  it("keeps scroll unchanged until matching scale is applied, coalescing the latest pair", () => {
    const f = fixture();
    try {
      f.pointer("pointermove", 2, 170);
      expect(f.viewport.scrollLeft).toBe(100);
      expect(f.viewport.scrollTop).toBe(200);
      expect(f.zoom()).toBe(1);
      f.pointer("pointermove", 2, 220);
      f.frame();
      expect(f.zoom()).toBe(2);
      expect(f.viewport.scrollLeft).toBe(210);
      expect(f.viewport.scrollTop).toBe(400);
      expect(f.applied).toEqual([2]);
    } finally { f.close(); }
  });
  it("flushes a final sample before rebasing to one finger", () => {
    const f = fixture();
    try {
      f.pointer("pointermove", 2, 170);
      f.pointer("pointerup", 2, 170);
      expect(f.zoom()).toBe(1.5);
      expect(f.viewport.scrollLeft).toBe(155);
      f.pointer("pointermove", 1, 40);
      expect(f.viewport.scrollLeft).toBe(135);
      f.frame();
      expect(f.viewport.scrollLeft).toBe(135);
    } finally { f.close(); }
  });
  it("rejects queued updates after cancellation and teardown", () => {
    const f = fixture();
    f.pointer("pointermove", 2, 170);
    f.pointer("pointercancel", 2, 170);
    f.frame();
    expect(f.zoom()).toBe(1);
    expect(f.viewport.scrollLeft).toBe(100);
    f.close();
    f.frame();
    expect(f.applied).toEqual([]);
  });
  it("commits a moving midpoint even at an unchanged scale boundary", () => {
    const f = fixture();
    try {
      let commits = 0;
      f.zooms.scheduleTouchZoom(1, () => { commits++; });
      f.frame();
      expect(commits).toBe(1);
      expect(f.applied).toEqual([]);
    } finally { f.close(); }
  });
  it("lets the latest pinch supersede a queued wheel camera update", () => {
    const f = fixture();
    try {
      f.zooms.queueOverviewWheel(-1);
      f.pointer("pointermove", 2, 170);
      f.frame();
      expect(f.zoom()).toBe(1.5);
      expect(f.viewport.scrollLeft).toBe(155);
    } finally { f.close(); }
  });
  it("does not apply a queued scale after an editor takes ownership before RAF", () => {
    const f = fixture();
    try {
      f.pointer("pointermove", 2, 170);
      f.startEditing();
      f.frame();
      expect(f.zoom()).toBe(1);
      expect(f.viewport.scrollLeft).toBe(100);
    } finally { f.close(); }
  });
});
