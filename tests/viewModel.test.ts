import { expect, it } from "vitest";
import { buildViewContext } from "../src/view/state/viewModel";
import { fixtureOutput, fixtureSettings, fixtureTree } from "./helpers/arborFixtures";

it("keeps search ancestry separate from output exclusion", () => {
  const tree = fixtureTree();
  const before = structuredClone(tree);
  const context = buildViewContext(tree, "first", fixtureOutput(), "leaf", {
    breadcrumbLabelPreferredPrefix: fixtureSettings().breadcrumbLabelPreferredPrefix,
    breadcrumbLabelFallback: fixtureSettings().breadcrumbLabelFallback
  });

  expect([...context.searchMatchedIds]).toEqual(["leaf"]);
  expect([...context.searchRelatedIds]).toEqual(["root", "first", "leaf"]);
  expect(context.outputResolutions.get("leaf")?.included).toBe(false);
  expect(tree).toEqual(before);
});
