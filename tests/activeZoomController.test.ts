import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { ActiveZoomController } from "../src/view/interaction/ActiveZoomController";

afterEach(() => vi.restoreAllMocks());

function harness() {
  const win = new Window();
  const viewport = win.document.createElement("div");
  const first = win.document.createElement("div");
  const second = win.document.createElement("div");
  viewport.append(first, second);
  win.document.body.append(viewport);
  let card = first;
  let zoom = 1;
  let height = 100;
  let naturalSize: { width: number; height: number } | null = null;
  const frames: FrameRequestCallback[] = [];
  const centered: HTMLElement[] = [];
  const modes: boolean[] = [];
  Object.defineProperties(viewport, { clientWidth: { value: 660, configurable: true }, clientHeight: { value: 400 } });
  for (const el of [first, second]) Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => ({ width: 300 * zoom, height: height * zoom }) });
  vi.spyOn(win as unknown as globalThis.Window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(win as unknown as globalThis.Window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const controller = new ActiveZoomController({
    getTarget: () => ({ card: card as unknown as HTMLElement, viewport: viewport as unknown as HTMLElement }),
    getZoom: () => zoom,
    getBounds: () => ({ min: 0.25, max: 5 }),
    getNaturalSize: () => naturalSize,
    applyZoom: value => { zoom = value; },
    center: target => { centered.push(target.card); },
    onEnabledChanged: enabled => { modes.push(enabled); }
  });
  return { controller, frames, first, second, centered, modes, zoom: () => zoom,
    setHeight: (value: number) => { height = value; },
    setAnimatedGeometry: () => {
      naturalSize = { width: 300, height: 120 };
      Object.defineProperty(viewport, "clientWidth", { value: 1243 });
      Object.defineProperty(first, "getBoundingClientRect", { value: () => ({ width: 291 * zoom, height: 116.4 * zoom }) });
    },
    setFixedHeight: (value: number) => { Object.defineProperty(first, "getBoundingClientRect", { configurable: true, value: () => ({ width: 300 * zoom, height: Math.max(120 * zoom, value - 24 * zoom) }) }); },
    selectSecond: () => { card = second; },
    flush: () => { frames.shift()?.(0); } };
}

describe("Active zoom", () => {
  it("fits the entire card closely with a 24px margin", () => {
    const h = harness(); h.controller.enable(); h.flush();
    expect(h.zoom()).toBeCloseTo(2.04, 3);
    expect(h.centered).toEqual([h.first]);
    expect(h.modes).toEqual([true]);
    h.controller.reset();
  });

  it("refits a taller editor instead of clipping it", () => {
    const h = harness(); h.controller.enable(); h.flush();
    h.setHeight(800); h.controller.schedule(); h.flush();
    expect(h.zoom()).toBeCloseTo(0.44, 3);
    h.controller.reset();
  });

  it("follows a newly selected card and coalesces resize work", () => {
    const h = harness(); h.controller.enable(); h.flush();
    h.selectSecond(); h.controller.schedule(); h.controller.schedule(); h.flush();
    expect(h.centered.at(-1)).toBe(h.second);
    expect(h.frames).toHaveLength(0);
    h.controller.reset();
  });

  it("does not refit after disable even if a detached frame fires", () => {
    const h = harness(); h.controller.enable(); const queued = h.frames.shift()!;
    h.controller.disable(); queued(0);
    expect(h.zoom()).toBe(1);
    expect(h.centered).toHaveLength(0);
    expect(h.controller.isEnabled()).toBe(false);
    expect(h.modes).toEqual([true, false]);
  });

  it("clamps oversized content at 25%", () => {
    const h = harness(); h.setHeight(4000); h.controller.enable(); h.flush();
    expect(h.zoom()).toBe(0.25);
    h.controller.reset();
  });

  it("remeasures nonlinear card geometry after applying a new scale even without an observer notification", () => {
    const h = harness();
    h.setFixedHeight(400);
    h.controller.enable(); h.flush();
    expect(h.frames.length).toBeGreaterThan(0);
    for (let i = 0; i < 25 && h.frames.length; i++) h.flush();
    expect(h.frames).toHaveLength(0);
    expect(h.zoom()).toBeGreaterThanOrEqual(0.25);
    h.controller.reset();
  });

  it("fits layout dimensions rather than the temporarily smaller selection animation", () => {
    const h = harness(); h.setAnimatedGeometry(); h.controller.enable(); h.flush();
    expect(h.zoom()).toBeCloseTo(2.933, 3);
    h.controller.reset();
  });

  it("re-centers after the browser completes a position-only animation", async () => {
    const h = harness();
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const animation = { finished };
    Object.defineProperty(h.first, "getAnimations", { value: () => [animation] });
    h.controller.enable(); while (h.frames.length) h.flush();
    const before = h.centered.length;
    finish(); await Promise.resolve();
    h.flush();
    expect(h.centered.length).toBeGreaterThan(before);
    h.controller.reset();
  });
});
