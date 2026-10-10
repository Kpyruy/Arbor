import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { measureBranchCard } from "../src/view/interaction/activeZoomGeometry";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Stable active zoom geometry", () => {
  it.each([0.5, 1, 2.5])("measures the same native card from zoom %s and restores the column", async initial => {
    const h = await ingestionHarness("editor");
    try {
      const card = h.card("first"), column = card.closest<HTMLElement>(".arbor-column")!;
      column.setCssProps({ "--bw-zoom": String(initial), "--bw-content-zoom": String(initial) });
      Object.defineProperties(card, {
        offsetWidth: { get: () => 300 * Number(column.style.getPropertyValue("--bw-zoom")) },
        offsetHeight: { get: () => Math.min(400, 210 * Number(column.style.getPropertyValue("--bw-zoom"))) }
      });
      expect(measureBranchCard(card, () => {})).toEqual({ width: 300, height: 210 });
      expect(column.style.getPropertyValue("--bw-zoom")).toBe(String(initial));
      expect(column.style.getPropertyValue("--bw-content-zoom")).toBe(String(initial));
    } finally { await h.view.onClose(); }
  });
});
