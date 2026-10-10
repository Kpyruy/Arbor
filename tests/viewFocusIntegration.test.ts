import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("View focus controls", () => {
  it("keeps a Branch card's horizontal screen anchor when active fit changes scale", async () => {
    const h = await ingestionHarness("editor");
    h.win.matchMedia = () => ({ matches: false }) as MediaQueryList;
    try {
      const viewport = h.root.querySelector<HTMLElement>(".arbor-columns-viewport")!;
      const card = h.card("first");
      const view = h.view as unknown as { activeZoom: { port: { applyZoom(value: number): void } }; getViewSettings(): { zoomLevel: number } };
      Object.defineProperties(viewport, { clientWidth: { value: 660 }, scrollWidth: { value: 4000 },
        getBoundingClientRect: { value: () => ({ left: 0, top: 0 }) } });
      Object.defineProperty(card, "getBoundingClientRect", { value: () => {
        const zoom = view.getViewSettings().zoomLevel;
        return { left: 500 * zoom - viewport.scrollLeft, top: 0, width: 300 * zoom, height: 100 * zoom };
      } });
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      view.activeZoom.port.applyZoom(2);
      viewport.scrollLeft = 970;
      const before = card.getBoundingClientRect();
      expect(before.left + before.width / 2).toBe(330);
      view.activeZoom.port.applyZoom(0.75);
      const after = card.getBoundingClientRect();
      expect(after.left + after.width / 2).toBeCloseTo(330);
    } finally { await h.view.onClose(); }
  });

  it("cancels the active Branch camera destination on manual zoom", async () => {
    const h = await ingestionHarness("editor");
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(h.win, "requestAnimationFrame").mockImplementation(cb => { frames.set(++frameId, cb); return frameId; });
    vi.spyOn(h.win, "cancelAnimationFrame").mockImplementation(id => frames.delete(id));
    h.win.matchMedia = () => ({ matches: false }) as MediaQueryList;
    try {
      const viewport = h.root.querySelector<HTMLElement>(".arbor-columns-viewport")!;
      Object.defineProperties(viewport, { clientWidth: { value: 660 }, scrollWidth: { value: 2400 } });
      const view = h.view as unknown as { branchViewport: { centerActiveTarget(viewport: HTMLElement, left: number): void };
        zoomController: { updateZoomLevel(value: number): void } };
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      view.branchViewport.centerActiveTarget(viewport, 600);
      view.zoomController.updateZoomLevel(1.25);
      for (const [id, cb] of [...frames]) { frames.delete(id); cb(performance.now() + 1000); }
      expect(viewport.scrollLeft).toBe(0);
      expect(h.root.querySelector(".arbor-active-zoom-exit")).toBeNull();
    } finally { await h.view.onClose(); }
  });

  it.each(["exit", "indicator"])("keeps a deep Overview selection visible at 100%% after stopping via %s", async control => {
    const h = await ingestionHarness("overview");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      const { viewport, scene } = h.view.overview.getElements();
      const card = h.card("first");
      Object.defineProperties(viewport!, { clientWidth: { value: 660 }, clientHeight: { value: 400 },
        getBoundingClientRect: { value: () => ({ left: 0, top: 0 }) } });
      viewport!.scrollTo = options => {
        const position = options as ScrollToOptions;
        viewport!.scrollLeft = position.left ?? viewport!.scrollLeft;
        viewport!.scrollTop = position.top ?? viewport!.scrollTop;
      };
      Object.defineProperties(card, { offsetWidth: { value: 300 }, offsetHeight: { value: 150 },
        getBoundingClientRect: { value: () => {
          const zoom = Number(scene!.style.getPropertyValue("--arbor-overview-zoom")) || 1;
          return { left: 800 * zoom - viewport!.scrollLeft, top: 1000 * zoom - viewport!.scrollTop,
            width: 300 * zoom, height: 150 * zoom };
        } } });
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      await h.settle();
      expect(viewport!.scrollTop).toBeGreaterThan(1000);
      h.root.querySelector<HTMLButtonElement>(control === "exit" ? ".arbor-active-zoom-exit" : ".arbor-zoom-indicator")!.click();
      await h.settle();
      const bounds = card.getBoundingClientRect();
      expect(Number(scene!.style.getPropertyValue("--arbor-overview-zoom"))).toBe(1);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.top + bounds.height).toBeLessThanOrEqual(400);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.left + bounds.width).toBeLessThanOrEqual(660);
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });

  it("keeps the active-zoom exit visible until clicked", async () => {
    const h = await ingestionHarness("overview");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      const item = h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom");
      expect(item).toBeDefined();
      item!.action();
      const exit = h.root.querySelector<HTMLButtonElement>(".arbor-active-zoom-exit");
      expect(exit?.textContent).toContain("Stop zoom");
      expect(exit?.querySelector(".arbor-focus-control-icon")).not.toBeNull();
      expect(exit?.hidden).toBe(false);
      expect(exit?.closest(".arbor-mode-controls")).not.toBeNull();
      exit!.click();
      expect(h.root.querySelector(".arbor-active-zoom-exit")).toBeNull();
      expect(h.writes).toHaveLength(0);
    } finally { await h.settle(); await h.view.onClose(); }
  });

  it("uses the zoom indicator to stop active fitting and reset to 100 percent", async () => {
    const h = await ingestionHarness("overview");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      const { viewport, scene } = h.view.overview.getElements();
      Object.defineProperties(viewport!, { clientWidth: { value: 660 }, clientHeight: { value: 400 } });
      const card = h.card("first");
      Object.defineProperties(card, { offsetWidth: { value: 300 }, offsetHeight: { value: 150 },
        getBoundingClientRect: { value: () => { const zoom = Number(scene!.style.getPropertyValue("--arbor-overview-zoom")) || 1; return { width: 300 * zoom, height: 150 * zoom }; } } });
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      await h.settle();
      expect(Number(scene!.style.getPropertyValue("--arbor-overview-zoom"))).toBeCloseTo(2.04);
      h.root.querySelector<HTMLButtonElement>(".arbor-zoom-indicator")!.click();
      await h.settle();
      expect(Number(scene!.style.getPropertyValue("--arbor-overview-zoom"))).toBeCloseTo(1);
      expect(h.root.querySelector(".arbor-active-zoom-exit")).toBeNull();
      expect(h.settings.zoomLevel).toBe(1);
    } finally { await h.view.onClose(); }
  });

  it.each([false, true])("uses the viewport midpoint while active without changing normal Branch alignment (compact=%s)", async compact => {
    const h = await ingestionHarness("editor");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      const viewport = h.root.querySelector<HTMLElement>(".arbor-columns-viewport")!;
      const columns = h.root.querySelector<HTMLElement>(".arbor-columns")!;
      if (compact) {
        Object.defineProperty(h.root, "clientWidth", { value: 390 });
        (h.view as unknown as { applyViewClasses(root: HTMLElement): void }).applyViewClasses(h.root);
      }
      Object.defineProperties(viewport, { clientHeight: { value: 400 }, getBoundingClientRect: { value: () => ({ top: 0 }) } });
      Object.defineProperty(columns, "getBoundingClientRect", { value: () => ({ top: 0 }) });
      h.root.querySelectorAll<HTMLElement>(".arbor-card").forEach(card => Object.defineProperties(card, { offsetTop: { value: 0 }, offsetHeight: { value: 100 } }));
      const view = h.view as unknown as { alignColumnsToActivePath(): void };
      view.alignColumnsToActivePath();
      expect(h.card("first").parentElement!.style.getPropertyValue("--arbor-card-list-offset-y")).toBe(compact ? "0px" : "126px");
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      view.alignColumnsToActivePath();
      expect(h.card("first").parentElement!.style.getPropertyValue("--arbor-card-list-offset-y")).toBe("150px");
    } finally { await h.view.onClose(); }
  });

  it("focuses the branch without leaving Branch Editor and keeps scope when switching views", async () => {
    const h = await ingestionHarness("editor");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      h.view.buildBlockMenu("first").items.find(i => i.title === "Focus on branch")!.action();
      await h.settle(); await h.view.renderNow();
      expect(h.view.presentationMode).toBe("editor");
      const visible = () => Array.from(h.root.querySelectorAll<HTMLElement>(".arbor-card"), c => c.dataset.blockId);
      expect(visible()).toEqual(["first", "leaf"]);
      h.view.selectParentBlock();
      expect(h.view.documentController.getState()?.selectedBlockId).toBe("first");
      h.view.openTreeOverview(); await h.settle(); await h.view.renderNow();
      expect(h.root.querySelectorAll(".arbor-overview-surface:not(.is-staging) .arbor-overview-card")).toHaveLength(2);
      h.view.closeTreeOverview(); await h.settle(); await h.view.renderNow();
      expect(visible()).toEqual(["first", "leaf"]);
      h.root.querySelector<HTMLButtonElement>(".arbor-branch-focus-exit")!.click();
      await h.view.renderNow();
      expect(visible()).toEqual(["root", "first", "second", "leaf"]);
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });

  it("does not let queued normal Overview centering override the active camera", async () => {
    const h = await ingestionHarness("overview");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      const viewport = h.view.overview.getElements().viewport!;
      const moves: ScrollToOptions[] = [];
      viewport.scrollTo = options => { moves.push(options as ScrollToOptions); };
      const view = h.view as unknown as { centerOverviewOnSelectedBlock(): void };
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      moves.length = 0;
      view.centerOverviewOnSelectedBlock();
      expect(moves).toHaveLength(0);
      h.root.querySelector<HTMLButtonElement>(".arbor-active-zoom-exit")!.click();
      moves.length = 0;
      view.centerOverviewOnSelectedBlock();
      expect(moves).toHaveLength(1);
    } finally { await h.view.onClose(); }
  });

  it("does not reorder hidden siblings when dropping the focused root onto itself", async () => {
    const h = await ingestionHarness("editor");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      h.view.buildBlockMenu("second").items.find(i => i.title === "Focus on branch")!.action();
      await h.settle(); await h.view.renderNow();
      const before = h.view.documentController.getState()!.metadata.blocks.map(b => ({ id: b.id, parentId: b.parentId, order: b.order }));
      const card = h.card("second"), transfer = h.transfer();
      card.dispatchEvent(h.event("dragstart", transfer));
      const over = h.event("dragover", transfer);
      Object.defineProperty(over, "clientY", { value: -1 });
      card.dispatchEvent(over);
      card.dispatchEvent(h.event("drop", transfer));
      await h.settle();
      expect(h.view.documentController.getState()!.metadata.blocks.map(b => ({ id: b.id, parentId: b.parentId, order: b.order }))).toEqual(before);
    } finally { await h.view.onClose(); }
  });

  it.each(["horizontal", "vertical-top-down", "vertical-bottom-up"] as const)("renders only the focused branch in %s, then restores full tree", async orientation => {
    const h = await ingestionHarness("overview", orientation);
    try {
      const item = h.view.buildBlockMenu("first").items.find(i => i.title === "Focus on branch");
      expect(item).toBeDefined();
      await item!.action(); await h.settle(); await h.view.renderNow();
      const visible = () => Array.from(h.root.querySelectorAll<HTMLElement>(".arbor-overview-surface:not(.is-staging) .arbor-overview-card"), c => c.dataset.blockId);
      expect(visible()).toEqual(["first", "leaf"]);
      expect(h.view.documentController.getState()?.metadata.blocks.find(b => b.id === "first")?.parentId).toBe("root");
      expect(h.writes).toHaveLength(0);
      const exit = h.root.querySelector<HTMLButtonElement>(".arbor-branch-focus-exit");
      expect(exit).not.toBeNull(); exit!.click(); await h.view.renderNow();
      expect(visible()).toEqual(["root", "first", "leaf", "second"]);
    } finally { await h.view.onClose(); }
  });

  it("keeps parent navigation within scope, but explicitly selecting an outside search target exits", async () => {
    const h = await ingestionHarness("overview");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      h.view.buildBlockMenu("first").items.find(i => i.title === "Focus on branch")!.action();
      await h.settle(); await h.view.renderNow();
      h.view.selectParentBlock();
      expect(h.view.documentController.getState()?.selectedBlockId).toBe("first");
      expect(h.root.querySelector(".arbor-branch-focus-exit")).not.toBeNull();
      const searchInput = h.root.createEl("input");
      searchInput.focus();
      h.view.selectBlock("second", { focus: true, reveal: true });
      await h.view.renderNow();
      await h.settle();
      expect(h.root.querySelector(".arbor-branch-focus-exit")).toBeNull();
      expect(h.win.document.activeElement).toBe(h.view.overview.getElements().viewport);
      expect(h.root.querySelectorAll(".arbor-overview-surface:not(.is-staging) .arbor-overview-card")).toHaveLength(4);
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });

  it("turns off active fit on manual wheel zoom without changing source content", async () => {
    const h = await ingestionHarness("overview");
    h.win.matchMedia = () => ({ matches: true }) as MediaQueryList;
    try {
      h.view.buildBlockMenu("first").items.find(i => i.title === "Active zoom")!.action();
      const viewport = h.view.overview.getElements().viewport!;
      const wheel = new h.win.MouseEvent("wheel", { ctrlKey: true, bubbles: true, cancelable: true });
      Object.defineProperty(wheel, "deltaY", { value: -1 });
      viewport.dispatchEvent(wheel);
      await h.settle();
      expect(h.root.querySelector(".arbor-active-zoom-exit")).toBeNull();
      expect(h.settings.zoomLevel).toBeCloseTo(1.06);
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });
});
