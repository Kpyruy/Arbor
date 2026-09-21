import { describe, expect, it, vi } from "vitest";

import { TreeOverviewController, type TreeOverviewPort } from "../src/view/overview/TreeOverviewController";
import { readSource, sourceClass, sourceMethod } from "./helpers/viewSource";

describe("TreeOverviewController", () => {
  it("retains a pending keyboard-focus request across a cancelled render frame", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    let cleared = 0;
    // This scheduling test deliberately has no DOM: only the focus command's
    // consumption is observed. Geometry/focus placement belongs to host checks.
    const controller = new TreeOverviewController({ clearPendingFocus: () => { cleared += 1; } } as TreeOverviewPort);
    const scheduler = controller as unknown as { restoreOverviewKeyboardFocusAfterMutation(): void };
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; },
      cancelAnimationFrame: (id: number) => frames.delete(id)
    });
    try {
      controller.requestKeyboardFocusAfterMutation();
      scheduler.restoreOverviewKeyboardFocusAfterMutation();
      controller.invalidate();
      expect(frames.size).toBe(0);
      expect(cleared).toBe(0);
      scheduler.restoreOverviewKeyboardFocusAfterMutation();
      expect(frames.size).toBe(1);
      frames.get(nextId)?.(1);
      expect(cleared).toBe(1);
      frames.clear();
      scheduler.restoreOverviewKeyboardFocusAfterMutation();
      expect(frames.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("owns published overview surfaces and invalidates a stale staged render", () => {
    const source = sourceClass("src/view/overview/TreeOverviewController.ts", "TreeOverviewController");

    expect(TreeOverviewController).toBeTypeOf("function");
    expect(source).toContain("private overviewRenderVersion = 0;");
    expect(source).toContain("const previousSurface = this.overviewSurfaceEl;");
    expect(source).toContain('cls: "arbor-overview-surface is-staging"');
    expect(source).toContain("if (overviewRenderVersion !== this.overviewRenderVersion)");
    expect(source).toContain("previousSurface.remove();");
    expect(source).toContain("this.overviewSurfaceEl = surface;");
  });

  it("updates selection in the published surface without Markdown rendering", () => {
    const method = sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "syncOverviewSelection");

    expect(method).toContain("this.overviewSurfaceEl.querySelectorAll<HTMLElement>(\".arbor-overview-card\")");
    expect(method).toContain("this.port.revealSelected(selectedCard)");
    expect(method).not.toContain("markdown.render");
  });

  it("keeps overview viewport binding and cleanup together", () => {
    const source = readSource("src/view/overview/TreeOverviewController.ts");
    const reset = sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "reset");

    expect(source).toContain("private viewportDisposer: (() => void) | null = null;");
    expect(source).toContain("this.viewportDisposer = this.port.bindViewport(this.overviewViewportEl);");
    expect(reset).toContain("this.viewportDisposer?.();");
    expect(reset).toContain("this.overviewStageEl?.remove();");
  });

  it("keeps mutation and centering requests latest-request-wins", () => {
    const source = readSource("src/view/overview/TreeOverviewController.ts");
    expect(source).toContain("requestCenterOnNextRender(requested = true): void");
    expect(source).toContain("this.shouldCenterOverviewOnNextRender = requested;");
    expect(source).toContain("requestKeyboardFocusAfterMutation(requested = true): void");
    expect(source).toContain("this.shouldRestoreOverviewKeyboardFocusAfterMutation = requested;");
  });
});
