import { expect, it } from "vitest";
import { sourceMethod, readSource } from "./helpers/viewSource";

it("keeps layout writer independent of live camera and document state", () => {
  const source = readSource("src/view/overview/overviewDom.ts");
  expect(source).toContain("export function applyOverviewLayout(");
  expect(source).not.toContain("this.");
  expect(source).toContain("buildOverviewLinkPath");
  expect(sourceMethod("src/view/overview/TreeOverviewController.ts", "TreeOverviewController", "syncTreeOverview"))
    .toContain("applyOverviewLayout(");
});
