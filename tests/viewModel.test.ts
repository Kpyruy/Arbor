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

it("builds a searchable result with its title, matching snippet, and ancestry path", () => {
  const tree = fixtureTree();
  const leaf = tree.blocks.find((block) => block.id === "leaf");
  if (!leaf) throw new Error("Fixture leaf is missing");
  leaf.content = "# Leaf title\nA searchable detail appears here.";

  const context = buildViewContext(tree, "first", fixtureOutput(), "searchable detail", {
    breadcrumbLabelPreferredPrefix: fixtureSettings().breadcrumbLabelPreferredPrefix,
    breadcrumbLabelFallback: fixtureSettings().breadcrumbLabelFallback
  });

  expect(context.searchResults).toEqual([{
    id: "leaf",
    title: "Leaf title",
    snippet: "# Leaf title A searchable detail appears here.",
    path: "Root / First / Leaf title"
  }]);
});

it("keeps every broad search match available to the scrollable result list", () => {
  const tree = fixtureTree();
  for (let index = 0; index < 51; index += 1) {
    tree.blocks.push({
      id: `match-${index}`,
      parentId: null,
      order: index + 1,
      content: `Needle ${index}`,
      after: "\n\n"
    });
  }

  const context = buildViewContext(tree, "first", fixtureOutput(), "needle", {
    breadcrumbLabelPreferredPrefix: fixtureSettings().breadcrumbLabelPreferredPrefix,
    breadcrumbLabelFallback: fixtureSettings().breadcrumbLabelFallback
  });

  expect(context.searchResults).toHaveLength(51);
  expect(context.searchResults[0]?.id).toBe("match-0");
  expect(context.searchResults[50]?.id).toBe("match-50");
});
