import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Branch column publication", () => {
  it.each(["tablet", "desktop", "phone"])("reveals rendered descendants on open and after parent changes (%s)", async layout => {
    const h = await ingestionHarness("editor");
    // happy-dom cannot measure paint: this guards the renderer/camera lifecycle.
    // The browser check separately asserts computed opacity and visible bounds.
    Object.defineProperty(h.view, "usesTouchControls", { get: () => layout !== "desktop" });
    Object.defineProperty(h.root, "clientWidth", { value: layout === "phone" ? 390 : 1024 });
    h.win.matchMedia = () => ({ matches: false }) as MediaQueryList;
    try {
      for (const selected of ["root", "first", "leaf", "second", "first", "leaf", "root"]) {
        h.view.selectBlock(selected, { focus: true, reveal: true });
        await h.view.renderNow();
        await new Promise<void>(resolve => h.win.requestAnimationFrame(() => resolve()));
        const lists = Array.from(h.root.querySelectorAll<HTMLElement>(".arbor-card-list"));
        expect(lists.length).toBeGreaterThan(0);
        expect(lists.filter(list => list.classList.contains("is-rebinding")).map(list => list.dataset.parentId),
          `Hidden columns after selecting ${selected}`).toEqual([]);
        expect(h.root.querySelector(`.arbor-card.is-active[data-block-id="${selected}"]`)).not.toBeNull();
      }
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });
});
