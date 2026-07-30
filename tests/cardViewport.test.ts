import { describe, expect, it } from "vitest";
import {
  CARD_PREVIEW_MAX_HEIGHT_PX,
  CARD_VIEWPORT_EDGE_PADDING_PX,
  canDragCard,
  clampCardCenter,
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

  it("caps editor height at the usable canvas", () => {
    expect(resolveEditorHeight(1_200, 700, 36)).toBe(616);
    expect(resolveEditorHeight(120, 700, 36)).toBe(180);
  });

  it("clamps a card center inside canvas safety bounds", () => {
    expect(CARD_VIEWPORT_EDGE_PADDING_PX).toBe(24);
    expect(clampCardCenter(120, 520, 0, 700)).toBe(284);
    expect(clampCardCenter(640, 520, 0, 700)).toBe(416);
  });
});
