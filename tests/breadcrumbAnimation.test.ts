import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getEnteringBreadcrumbIds } from "../src/breadcrumbAnimation";

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
    const view = readFileSync(resolve(process.cwd(), "src/view/ArborView.ts"), "utf8");
    const styles = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

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
