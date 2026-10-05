import type { ArborOutputState, BranchBlock, BranchTreeMetadata } from "../../src/types";

export interface VerticalOverviewQaFixture {
  name: string;
  metadata: BranchTreeMetadata;
  outputState: ArborOutputState;
}

export function verticalOverviewQaFixtures(
  createId: () => string,
  imagePath: string
): VerticalOverviewQaFixture[] {
  const blocks: BranchBlock[] = [];
  const add = (parentId: string | null, content: string, appearance?: BranchBlock["appearance"]): string => {
    const id = createId();
    blocks.push({ id, parentId, order: blocks.filter(block => block.parentId === parentId).length, content, after: "\n\n", ...(appearance ? { appearance } : {}) });
    return id;
  };
  const root = add(null, "# Overview acceptance\n\nUse Tree overview → root at top / root at bottom, then LTR / RTL. Try arrows, Ctrl/Cmd + arrows, numbers, Enter, double-click, save/cancel, search ‘Needle’, and PNG/PDF. Return to Branch Editor: it stays horizontal.");
  const branch = add(root, "## Green branch\n\nDescendants inherit green.", { branchColor: "#44aa88" });
  add(branch, "### Inherited green\n\nNo local colour override.");
  const override = add(branch, "## Purple branch override\n\nDescendants inherit purple.", { branchColor: "#8866cc" });
  add(override, "### Orange card override\n\nOnly this card is orange; branch inheritance stays purple.", { cardColor: "#dd8844" });
  add(override, "### Inherited purple\n\nCompare with the orange card.");
  const excluded = add(root, "## Excluded branch\n\nAcceptance profile excludes this branch; Overview keeps dashed cards visible.");
  add(excluded, "### Excluded descendant\n\nClean copy should omit me.");
  const wide = add(root, "## Wide siblings\n\nNumbers select children. Search Needle to reveal the far edge.");
  for (let index = 1; index <= 12; index += 1) add(wide, `### ${index === 12 ? "Needle — " : ""}Sibling ${index}\n\nCompare order in LTR and RTL.`);
  add(root, "## Tall Markdown\n\n" + Array.from({ length: 18 }, (_, index) => `Paragraph ${index + 1}: **bold**, *italic*, and \`inline code\` remain upright.`).join("\n\n"));
  add(root, `## Image and links\n\n![[${imagePath}|200]]\n\n[[Colors and inheritance]] · [Obsidian](https://obsidian.md)`);
  add(root, "## Code and table\n\n```typescript\n" + Array.from({ length: 18 }, (_, index) => `const sample${index + 1} = ${index + 1};`).join("\n") + "\n```\n\n| Row | Value |\n| --- | --- |\n" + Array.from({ length: 12 }, (_, index) => `| ${index + 1} | Table row |`).join("\n"));
  add(null, "# Second forest root\n\nIndependent root; connectors must not bridge the roots.");
  const metadata: BranchTreeMetadata = { version: 1, prefix: "", blocks };
  const deepBlocks: BranchBlock[] = [];
  let parentId: string | null = null;
  for (let depth = 0; depth <= 50; depth += 1) {
    const id = createId();
    deepBlocks.push({ id, parentId, order: 0, content: depth === 0
      ? "# Deep chain\n\n50 edges / 51 cards. Test root at top/bottom, arrows, rapid selection, zoom to 25%, editing, and return to Branch Editor. Search ‘Depth 50’ to reveal the end."
      : `## Depth ${depth}\n\n${depth === 50 ? "Needle at deepest leaf." : "One child; no siblings."}`, after: "\n\n" });
    parentId = id;
  }
  const full: ArborOutputState = { version: 1, activeProfileId: "full", profiles: [{ id: "full", name: "Full tree", rules: [] }] };
  return [
    { name: "Overview acceptance", metadata, outputState: { version: 1, activeProfileId: "acceptance", profiles: [...full.profiles, { id: "acceptance", name: "Acceptance — exclude branch", rules: [{ blockId: excluded, state: "exclude" }] }] } },
    { name: "Deep chain", metadata: { version: 1, prefix: "", blocks: deepBlocks }, outputState: full }
  ];
}
