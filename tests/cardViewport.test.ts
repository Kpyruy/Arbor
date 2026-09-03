import { describe, expect, it } from "vitest";
import {
  CARD_PREVIEW_MAX_HEIGHT_PX,
  CARD_VIEWPORT_EDGE_PADDING_PX,
  canDragCard,
  canStartCardDrag,
  clampCardCenter,
  hasVerticalOverflow,
  isWithinHorizontalBounds,
  resolveViewportWheelAxis,
  reserveSceneWidthForColumns,
  resolveEditorHeight
} from "../src/cardViewport";

describe("bounded Arbor card viewport rules", () => {
  it("keeps previews compact", () => {
    expect(CARD_PREVIEW_MAX_HEIGHT_PX).toBe(260);
  });

  it("disables dragging while a card is being edited", () => {
    expect(canDragCard(true, true)).toBe(false);
    expect(canDragCard(true, false)).toBe(true);
    expect(canDragCard(false, false)).toBe(false);
  });

  it("blocks dragstart for the active edit session", () => {
    expect(canStartCardDrag(true, "block-1", "block-1")).toBe(false);
    expect(canStartCardDrag(true, "block-1", "block-2")).toBe(true);
    expect(canStartCardDrag(false, null, "block-1")).toBe(false);
  });

  it("caps editor height at the usable canvas", () => {
    expect(resolveEditorHeight(1_200, 700, 36)).toBe(616);
    expect(resolveEditorHeight(120, 700, 36)).toBe(180);
  });

  it("marks only content taller than its preview as truncated", () => {
    expect(hasVerticalOverflow(260, 260)).toBe(false);
    expect(hasVerticalOverflow(261, 260)).toBe(true);
  });

  it("detects pointer positions that fall inside a card column", () => {
    expect(isWithinHorizontalBounds(120, 120, 420)).toBe(true);
    expect(isWithinHorizontalBounds(420, 120, 420)).toBe(true);
    expect(isWithinHorizontalBounds(119.9, 120, 420)).toBe(false);
    expect(isWithinHorizontalBounds(420.1, 120, 420)).toBe(false);
  });

  it("routes a vertical wheel to the column under the pointer", () => {
    expect(resolveViewportWheelAxis(0, 120, false, false, true)).toBe("vertical");
    expect(resolveViewportWheelAxis(0, 120, false, false, false)).toBe("horizontal");
    expect(resolveViewportWheelAxis(120, 30, false, false, true)).toBeNull();
    expect(resolveViewportWheelAxis(0, 120, true, false, true)).toBeNull();
  });

  it("clamps a card center inside canvas safety bounds", () => {
    expect(CARD_VIEWPORT_EDGE_PADDING_PX).toBe(24);
    expect(clampCardCenter(120, 520, 0, 700)).toBe(284);
    expect(clampCardCenter(640, 520, 0, 700)).toBe(416);
  });

  it("reserves room for columns that will be added outside the RTL viewport", () => {
    expect(reserveSceneWidthForColumns(1_000, 800, 2, 3, 300, 20, 1)).toBe(1_320);
    expect(reserveSceneWidthForColumns(1_000, 800, 3, 2, 300, 20, 1)).toBe(1_000);
    expect(reserveSceneWidthForColumns(600, 800, 0, 1, 300, 20, 1)).toBe(900);
  });
});
