import { describe, expect, it, vi } from "vitest";
import { BranchViewportController } from "../src/view/branch/BranchViewportController";

describe("branch card anchor through reflow", () => {
  it("compensates card reflow and moving midpoint without a release recenter", () => {
    let rect = { left: 100, top: 100, width: 200, height: 100 };
    const card = { isConnected: true, getBoundingClientRect: () => rect };
    const viewport = {
      scrollLeft: 100, scrollTop: 200,
      ownerDocument: { elementFromPoint: () => ({ closest: () => card }) },
      contains: () => true,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      querySelector: () => card
    } as unknown as HTMLElement;
    vi.stubGlobal("window", { cancelAnimationFrame() {} });
    const camera = new BranchViewportController({
      read: {} as never, getElements: () => ({ root: viewport, viewport, columns: null, stage: null, previewContent: null }),
      getSession: () => null, isCompact: () => false, consumeAutofocus() {}
    });
    camera.beginBranchPinch(viewport, { x: 200, y: 150 });
    rect = { left: 80, top: 90, width: 300, height: 160 };
    camera.commitBranchPinch(viewport, { x: 210, y: 150 });
    expect(viewport.scrollLeft).toBe(120);
    expect(viewport.scrollTop).toBe(220);
    camera.endBranchPinch();
    expect(viewport.scrollLeft).toBe(120);
    expect(viewport.scrollTop).toBe(220);
    vi.unstubAllGlobals();
  });
});
