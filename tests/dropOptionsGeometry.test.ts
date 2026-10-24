import { describe, expect, it } from "vitest";
import { fitDropOptions } from "../src/view/ingestion/dropOptionsGeometry";

describe("drop target fitting", () => {
  const sizes = { stackSize: { width: 232, height: 112 }, rowSize: { width: 300, height: 64 } };
  it("keeps the whole stack inside bounds, not just its origin", () => {
    expect(fitDropOptions({ ...sizes, bounds: { left: 20, top: 80, right: 600, bottom: 400 }, preferred: { x: 590, y: 390 } }))
      .toEqual({ x: 368, y: 288, layout: "stack" });
  });
  it("uses two independent compact targets when height is constrained", () => {
    expect(fitDropOptions({ ...sizes, bounds: { left: 20, top: 80, right: 600, bottom: 160 }, preferred: { x: -100, y: 0 } }))
      .toEqual({ x: 20, y: 80, layout: "row" });
  });
  it("offers no guessed target when neither layout can fit", () => {
    expect(fitDropOptions({ ...sizes, bounds: { left: 0, top: 0, right: 600, bottom: 30 }, preferred: { x: 0, y: 0 } })).toBeNull();
    expect(fitDropOptions({ ...sizes, bounds: { left: 0, top: 0, right: 40, bottom: 500 }, preferred: { x: 0, y: 0 } })).toBeNull();
  });
});
