import { describe, expect, it } from "vitest";
import { intersectVisibleRects } from "../src/view/chrome/mobileViewportGeometry";

describe("visible pane intersection", () => {
  it("intersects keyboard height and a panned split pane", () => {
    expect(intersectVisibleRects([
      { left: 500, top: 80, right: 1000, bottom: 900 },
      { left: 0, top: 100, right: 900, bottom: 500 }
    ])).toEqual({ left: 500, top: 100, right: 900, bottom: 500 });
  });
  it("rejects empty, disjoint, zero-area and invalid geometry", () => {
    expect(intersectVisibleRects([])).toBeNull();
    expect(intersectVisibleRects([{ left: 0, top: 0, right: 0, bottom: 100 }])).toBeNull();
    expect(intersectVisibleRects([{ left: NaN, top: 0, right: 100, bottom: 100 }])).toBeNull();
    expect(intersectVisibleRects([
      { left: 0, top: 0, right: 100, bottom: 100 },
      { left: 200, top: 0, right: 300, bottom: 100 }
    ])).toBeNull();
  });
});
