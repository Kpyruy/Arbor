import { describe, expect, it } from "vitest";
import { getEnteringBreadcrumbIds } from "../src/breadcrumbAnimation";
import { readSource } from "./helpers/viewSource";

describe("breadcrumb animation", () => {
  it("marks only blocks newly added to the path for entrance animation", () => {
    expect(
      [...getEnteringBreadcrumbIds(["root", "outline"], ["root", "outline", "scene"])].sort()
    ).toEqual(["scene"]);
  });

  it("does not replay an entrance animation for a block that remains on the path", () => {
    expect(
      [...getEnteringBreadcrumbIds(["root", "outline", "scene"], ["root", "outline"])].sort()
    ).toEqual([]);
  });

  it("applies the entrance class only from the newly entering path IDs", () => {
    const view = readSource("src/view/chrome/BreadcrumbsController.ts");
    const styles = readSource("styles.css");

    expect(view).toContain("getEnteringBreadcrumbIds(previousPathIds, path.map((block) => block.id))");
    expect(view).toContain('button.toggleClass("is-entering", enteringBlockIds.has(block.id));');
    expect(styles).toContain(".arbor-breadcrumbs button.is-entering");
    const activeRule = styles.slice(
      styles.indexOf(".arbor-breadcrumbs button.is-active"),
      styles.indexOf(".arbor-breadcrumbs button.is-entering")
    );
    expect(activeRule).not.toContain("animation:");
  });
});
