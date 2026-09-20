import { describe, expect, it } from "vitest";

import { TreeOverviewController } from "../src/view/overview/TreeOverviewController";
import { readSource, sourceClass, sourceMethod } from "./helpers/viewSource";

describe("TreeOverviewController", () => {
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
