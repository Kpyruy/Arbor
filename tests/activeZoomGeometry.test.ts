import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { measureBranchCard } from "../src/view/interaction/activeZoomGeometry";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Stable active zoom geometry", () => {
  it.each([0.5, 1, 2.5])("measures compact ancestor-owned width at native scale from zoom %s", async initial => {
    const h = await ingestionHarness("editor");
    try {
      h.root.classList.add("is-compact");
      h.root.setCssProps({ "--bw-zoom": String(initial) });
      const card = h.card("first"), columns = card.closest<HTMLElement>(".arbor-columns")!;
      Object.defineProperties(card, {
        offsetWidth: { get: () => 366 * Number(columns.style.getPropertyValue("--bw-zoom") || h.root.style.getPropertyValue("--bw-zoom")) },
        offsetHeight: { get: () => 12000 }
      });
      expect(measureBranchCard(card, () => {})).toEqual({ width: 366, height: 12000 });
      expect(columns.style.getPropertyValue("--bw-zoom")).toBe("");
      expect(h.root.style.getPropertyValue("--bw-zoom")).toBe(String(initial));
    } finally { await h.view.onClose(); }
  });
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
