import { describe, expect, it } from "vitest";
import { buildOverviewLayout, buildOverviewLinkPath } from "../src/model/overviewLayout";
import { BranchTreeMetadata } from "../src/types";

const tree: BranchTreeMetadata = {
  version: 1,
  prefix: "",
  blocks: [
    { id: "root", parentId: null, order: 0, content: "# Root", after: "" },
    { id: "a", parentId: "root", order: 0, content: "A", after: "" },
    { id: "b", parentId: "root", order: 1, content: "B", after: "" },
    { id: "a1", parentId: "a", order: 0, content: "A.1", after: "" }
  ]
};

describe("overview layout", () => {
  it("shows every block once in depth columns and keeps sibling order", () => {
    const layout = buildOverviewLayout(tree);

    expect(layout.nodes.map((node) => node.id)).toEqual(["root", "a", "a1", "b"]);
    expect(layout.nodes.find((node) => node.id === "root")?.depth).toBe(0);
    expect(layout.nodes.find((node) => node.id === "a1")?.depth).toBe(2);
    expect(layout.nodes.find((node) => node.id === "a")!.y)
      .toBeLessThan(layout.nodes.find((node) => node.id === "b")!.y);
  });

  it("links all non-roots and does not hide collapsed descendants", () => {
    const collapsed = structuredClone(tree);
    collapsed.blocks.find((block) => block.id === "a")!.collapsed = true;

    const layout = buildOverviewLayout(collapsed);

    expect(layout.links).toEqual([
      { parentId: "root", childId: "a" },
      { parentId: "a", childId: "a1" },
      { parentId: "root", childId: "b" }
    ]);
    expect(layout.nodes.map((node) => node.id)).toContain("a1");
  });

  it("centres a parent vertically over the span of its children", () => {
    const branching: BranchTreeMetadata = {
      version: 1,
      prefix: "",
      blocks: [
        { id: "root", parentId: null, order: 0, content: "Root", after: "" },
        { id: "left", parentId: "root", order: 0, content: "Left", after: "" },
        { id: "right", parentId: "root", order: 1, content: "Right", after: "" }
      ]
    };

    const layout = buildOverviewLayout(branching);
    const root = layout.nodes.find((node) => node.id === "root")!;
    const left = layout.nodes.find((node) => node.id === "left")!;
    const right = layout.nodes.find((node) => node.id === "right")!;

    expect(root.y).toBe((left.y + right.y) / 2);
  });

  it("uses measured card heights without allowing adjacent rows to overlap", () => {
    const layout = buildOverviewLayout(tree, {
      cardHeights: new Map([
        ["root", 180],
        ["a", 76],
        ["b", 76],
        ["a1", 112]
      ])
    });
    const a = layout.nodes.find((node) => node.id === "a")!;
    const b = layout.nodes.find((node) => node.id === "b")!;

    expect(layout.nodes.find((node) => node.id === "root")?.height).toBe(180);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  });

  it("creates finite empty-tree bounds and cubic parent-child links", () => {
    expect(buildOverviewLayout({ version: 1, prefix: "", blocks: [] }).width).toBeGreaterThan(0);

    const layout = buildOverviewLayout(tree);
    const parent = layout.nodes.find((node) => node.id === "root")!;
    const child = layout.nodes.find((node) => node.id === "a")!;

    expect(buildOverviewLinkPath(parent, child)).toContain(`M ${parent.x + parent.width}`);
    expect(buildOverviewLinkPath(parent, child)).toContain(`${child.x} ${child.y + child.height / 2}`);
  });

  it("mirrors node positions and connector endpoints for RTL without changing tree order", () => {
    const ltr = buildOverviewLayout(tree);
    const rtl = buildOverviewLayout(tree, { direction: "rtl" });
    const ltrRoot = ltr.nodes.find((node) => node.id === "root")!;
    const rtlRoot = rtl.nodes.find((node) => node.id === "root")!;
    const rtlChild = rtl.nodes.find((node) => node.id === "a")!;

    expect(rtl.nodes.map((node) => node.id)).toEqual(ltr.nodes.map((node) => node.id));
    expect(rtlRoot.x).toBe(rtl.width - ltrRoot.x - ltrRoot.width);
    expect(buildOverviewLinkPath(rtlRoot, rtlChild, "rtl")).toContain(`M ${rtlRoot.x}`);
    expect(buildOverviewLinkPath(rtlRoot, rtlChild, "rtl")).toContain(`${rtlChild.x + rtlChild.width} ${rtlChild.y + rtlChild.height / 2}`);
  });
});

const measuredOptions = {
  cardWidth: 200, cardHeight: 76, columnGap: 80, rowGap: 24,
  cardHeights: new Map([["root", 180], ["a", 76], ["b", 112], ["a1", 200]])
};
const forest: BranchTreeMetadata = {
  ...tree,
  blocks: [...tree.blocks, { id: "r2", parentId: null, order: 1, content: "Second root", after: "" }]
};
const rectangles = (layout: ReturnType<typeof buildOverviewLayout>) =>
  layout.nodes.map(({ id, x, y, width, height }) => [id, x, y, width, height]);

describe("horizontal regression fixtures", () => {
  it.each([
    { name: "small LTR", metadata: { ...tree, blocks: [tree.blocks[0]] }, direction: "ltr" as const,
      want: [["root", 0, 10, 200, 180]], bounds: [200, 190], path: null },
    { name: "small RTL", metadata: { ...tree, blocks: [tree.blocks[0]] }, direction: "rtl" as const,
      want: [["root", 0, 10, 200, 180]], bounds: [200, 190], path: null },
    { name: "mixed LTR", metadata: tree, direction: "ltr" as const,
      want: [["root", 0, 122, 200, 180], ["a", 280, 62, 200, 76], ["a1", 560, 0, 200, 200], ["b", 280, 268, 200, 112]],
      bounds: [760, 380], path: "M 200 212 C 240 212, 240 100, 280 100" },
    { name: "mixed RTL", metadata: tree, direction: "rtl" as const,
      want: [["root", 560, 122, 200, 180], ["a", 280, 62, 200, 76], ["a1", 0, 0, 200, 200], ["b", 280, 268, 200, 112]],
      bounds: [760, 380], path: "M 560 212 C 520 212, 520 100, 480 100" },
    { name: "forest LTR", metadata: forest, direction: "ltr" as const,
      want: [["root", 0, 122, 200, 180], ["a", 280, 62, 200, 76], ["a1", 560, 0, 200, 200], ["b", 280, 268, 200, 112], ["r2", 0, 510, 200, 76]],
      bounds: [760, 586], path: "M 200 212 C 240 212, 240 100, 280 100" },
    { name: "forest RTL", metadata: forest, direction: "rtl" as const,
      want: [["root", 560, 122, 200, 180], ["a", 280, 62, 200, 76], ["a1", 0, 0, 200, 200], ["b", 280, 268, 200, 112], ["r2", 560, 510, 200, 76]],
      bounds: [760, 586], path: "M 560 212 C 520 212, 520 100, 480 100" }
  ])("preserves $name rectangles, bounds and connectors", ({ metadata, direction, want, bounds, path }) => {
    const layout = buildOverviewLayout(metadata, { ...measuredOptions, direction });
    expect(rectangles(layout)).toEqual(want);
    expect([layout.width, layout.height]).toEqual(bounds);
    if (path) expect(buildOverviewLinkPath(layout.nodes[0], layout.nodes[1], direction)).toBe(path);
  });
});

describe("vertical overview layout", () => {
  it.each([
    { orientation: "vertical-top-down" as const, direction: "ltr" as const,
      want: [["root", 112, 0, 200, 180], ["a", 0, 260, 200, 76], ["a1", 0, 452, 200, 200], ["b", 224, 260, 200, 112]],
      path: "M 212 180 C 212 220, 100 220, 100 260" },
    { orientation: "vertical-top-down" as const, direction: "rtl" as const,
      want: [["root", 112, 0, 200, 180], ["a", 224, 260, 200, 76], ["a1", 224, 452, 200, 200], ["b", 0, 260, 200, 112]],
      path: "M 212 180 C 212 220, 324 220, 324 260" },
    { orientation: "vertical-bottom-up" as const, direction: "ltr" as const,
      want: [["root", 112, 472, 200, 180], ["a", 0, 316, 200, 76], ["a1", 0, 0, 200, 200], ["b", 224, 280, 200, 112]],
      path: "M 212 472 C 212 432, 100 432, 100 392" },
    { orientation: "vertical-bottom-up" as const, direction: "rtl" as const,
      want: [["root", 112, 472, 200, 180], ["a", 224, 316, 200, 76], ["a1", 224, 0, 200, 200], ["b", 0, 280, 200, 112]],
      path: "M 212 472 C 212 432, 324 432, 324 392" }
  ])("places measured cards $orientation/$direction", ({ orientation, direction, want, path }) => {
    const collapsed = structuredClone(tree);
    collapsed.blocks.find(block => block.id === "a")!.collapsed = true;
    const layout = buildOverviewLayout(collapsed, { ...measuredOptions, orientation, direction });
    expect(rectangles(layout)).toEqual(want);
    expect([layout.width, layout.height]).toEqual([424, 652]);
    expect(layout.nodes.map(node => node.id)).toEqual(["root", "a", "a1", "b"]);
    expect(layout.links).toEqual([{ parentId: "root", childId: "a" }, { parentId: "a", childId: "a1" }, { parentId: "root", childId: "b" }]);
    expect(buildOverviewLinkPath(layout.nodes[0], layout.nodes[1], direction, orientation)).toBe(path);
  });

  for (const orientation of ["vertical-top-down", "vertical-bottom-up"] as const) {
    for (const direction of ["ltr", "rtl"] as const) {
      it(`bounds and separates tall asymmetric forest cards ${orientation}/${direction}`, () => {
        const layout = buildOverviewLayout(forest, { ...measuredOptions, orientation, direction });
        expect([layout.width, layout.height]).toEqual([648, 652]);
        expect(layout.nodes.map(node => node.id)).toEqual(["root", "a", "a1", "b", "r2"]);
        expect(layout.nodes.find(node => node.id === "r2")).toMatchObject({ x: direction === "ltr" ? 448 : 0, y: orientation === "vertical-top-down" ? 0 : 576 });
        assertNoOverlap(layout);
      });
      it(`handles a 50-level chain ${orientation}/${direction}`, () => {
        const chain: BranchTreeMetadata = { ...tree, blocks: Array.from({ length: 50 }, (_, index) => ({
          id: `n${index}`, parentId: index ? `n${index - 1}` : null, order: 0, content: "Node", after: ""
        })) };
        const layout = buildOverviewLayout(chain, { ...measuredOptions, orientation, direction });
        expect([layout.width, layout.height]).toEqual([200, 7720]);
        expect(layout.nodes[49]).toMatchObject({ depth: 49, x: 0, y: orientation === "vertical-top-down" ? 7644 : 0 });
        assertNoOverlap(layout);
      });
      it(`handles 100 leaves without changing sorted order ${orientation}/${direction}`, () => {
        const wide: BranchTreeMetadata = { ...tree, blocks: [tree.blocks[0], ...Array.from({ length: 100 }, (_, index) => ({
          id: `leaf${index}`, parentId: "root", order: index, content: "Leaf", after: ""
        })).reverse()] };
        const layout = buildOverviewLayout(wide, { ...measuredOptions, orientation, direction });
        expect([layout.width, layout.height]).toEqual([22376, 336]);
        expect(layout.nodes[0]).toMatchObject({ x: 11088, y: orientation === "vertical-top-down" ? 0 : 156 });
        expect(layout.nodes[1].id).toBe("leaf0");
        expect(layout.nodes[100].id).toBe("leaf99");
        assertNoOverlap(layout);
      });
      it(`ignores invalid measured heights ${orientation}/${direction}`, () => {
        const layout = buildOverviewLayout(tree, { ...measuredOptions, orientation, direction,
          cardHeights: new Map([["root", NaN], ["a", Infinity], ["b", -10], ["a1", 20], ["unused", 999]]) });
        expect(layout.nodes.map(node => node.height)).toEqual([76, 76, 76, 76]);
        expect([layout.width, layout.height]).toEqual([424, 388]);
        assertNoOverlap(layout);
      });
      it(`returns positive empty bounds ${orientation}/${direction}`, () => {
        const layout = buildOverviewLayout({ ...tree, blocks: [] }, { ...measuredOptions, orientation, direction });
        expect(layout).toEqual({ nodes: [], links: [], width: 200, height: 76 });
      });
    }
  }
  it("defaults unknown orientation to horizontal", () => {
    const layout = buildOverviewLayout(tree, { ...measuredOptions, orientation: "sideways" as never });
    expect(rectangles(layout)).toEqual([["root", 0, 122, 200, 180], ["a", 280, 62, 200, 76], ["a1", 560, 0, 200, 200], ["b", 280, 268, 200, 112]]);
  });
});

function assertNoOverlap(layout: ReturnType<typeof buildOverviewLayout>): void {
  layout.nodes.forEach((node, index) => {
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.y).toBeGreaterThanOrEqual(0);
    expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
    expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    layout.nodes.slice(index + 1).forEach(other => {
      expect(node.x + node.width <= other.x || other.x + other.width <= node.x ||
        node.y + node.height <= other.y || other.y + other.height <= node.y).toBe(true);
    });
  });
}
