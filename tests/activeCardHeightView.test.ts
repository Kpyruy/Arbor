import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("active card height view policy", () => {
  it("does not steal focus from a settings control when height mode changes", async () => {
    const h = await ingestionHarness("editor");
    try {
      const control = h.win.document.createElement("select"); h.win.document.body.append(control); control.focus();
      h.settings.activeCardHeightMode = "content";
      h.view.refreshCardHeightMode(); await h.view.renderNow();
      await new Promise<void>(resolve => h.win.requestAnimationFrame(() => resolve()));
      expect(h.win.document.activeElement).toBe(control);
    } finally { await h.view.onClose(); }
  });
  it("refreshes height mode without discarding an unsaved editor session", async () => {
    const h = await ingestionHarness("editor");
    try {
      h.view.editor.beginEditingBlock("first");
      const session = h.view.editor.getSession()!;
      session.value = "An unsaved draft";
      h.settings.activeCardHeightMode = "content";
      h.view.refreshCardHeightMode();
      await h.view.renderNow();
      expect(h.view.editor.getSession()).toBe(session);
      expect(h.view.editor.getSession()?.value).toBe("An unsaved draft");
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });
  it("switches the existing Branch view class without changing document content", async () => {
    const h = await ingestionHarness("editor");
    try {
      h.settings.activeCardHeightMode = "content";
      await h.view.renderNow();
      expect(h.root.classList.contains("is-content-height")).toBe(true);
      h.settings.activeCardHeightMode = "bounded";
      await h.view.renderNow();
      expect(h.root.classList.contains("is-content-height")).toBe(false);
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });

  it.each([
    ["editor", "content", 2.04],
    ["editor", "bounded", .25],
    ["overview", "content", .25]
  ] as const)("fits an actual view target in %s / %s without changing the other view's policy", async (mode, heightMode, zoom) => {
    const h = await ingestionHarness(mode);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(h.win, "requestAnimationFrame").mockImplementation(cb => { frames.push(cb); return frames.length; });
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      h.settings.activeCardHeightMode = heightMode;
      const viewport = h.root.querySelector<HTMLElement>(mode === "editor" ? ".arbor-columns-viewport" : ".arbor-overview-viewport")!;
      Object.defineProperties(viewport, { clientWidth: { value: 660 }, clientHeight: { value: 400 } });
      const card = h.card("first");
      const view = h.view as unknown as { getViewSettings(): { zoomLevel: number } };
      Object.defineProperties(card, {
        offsetWidth: { value: 300 }, offsetHeight: { value: 12000 },
        getBoundingClientRect: { value: () => new h.win.DOMRect(0, 0, 300 * view.getViewSettings().zoomLevel, 12000 * view.getViewSettings().zoomLevel) }
      });
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      for (let i = 0; i < 20 && frames.length; i++) frames.shift()!(performance.now() + 1000);
      expect(view.getViewSettings().zoomLevel).toBeCloseTo(zoom, 3);
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });
});
