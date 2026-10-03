import { describe, expect, it, vi } from "vitest";
import type { CachedMetadata, HeadingCache } from "obsidian";
import { HeadingLinkController } from "../src/view/navigation/HeadingLinkController";
import { fixtureLoaded, deferred } from "./helpers/arborFixtures";

const source = '<!-- arbor:block:v1 id="root" parent="" order="0" -->\n# Root\n\n<!-- arbor:block:v1 id="child" parent="root" order="0" -->\n## Target\nBody\n';
const heading: HeadingCache = {
  heading: "Target", level: 2,
  position: { start: { line: 4, col: 0, offset: source.indexOf("## Target") }, end: { line: 4, col: 9, offset: source.indexOf("## Target") + 9 } }
};
const cache: CachedMetadata = { headings: [heading], sections: [
  { type: "html", position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 53, offset: 53 } } },
  { type: "html", position: { start: { line: 3, col: 0, offset: source.indexOf('<!-- arbor:block:v1 id="child"') }, end: { line: 3, col: 58, offset: source.indexOf('<!-- arbor:block:v1 id="child"') + 58 } } }
] };

function harness() {
  let state: ReturnType<typeof fixtureLoaded> | null = fixtureLoaded();
  state.metadata.blocks = [
    { id: "root", parentId: null, order: 0, content: "# Root", after: "\n\n" },
    { id: "child", parentId: "root", order: 0, content: "## Target\nBody", after: "\n" }
  ];
  state.selectedBlockId = "root";
  const initialState = state;
  let path = "Folder/Source.md";
  let text = source;
  const openInternal = vi.fn(async () => undefined);
  const readSource = vi.fn(async () => text);
  const selectLocalBlock = (id: string) => { if (!state) return false; state.selectedBlockId = id; return true; };
  const controller = new HeadingLinkController({
    getState: () => state, getSourcePath: () => path,
    resolveLocalHeading: (linktext) => linktext === "#Target" ? { cache, heading } : null,
    readSource, selectLocalBlock, openInternal
  });
  return { controller, initialState, openInternal, readSource,
    setPath: (next: string) => { path = next; }, setState: (next: typeof state) => { state = next; },
    setText: (next: string) => { text = next; } };
}

describe("HeadingLinkController", () => {
  it("selects the containing card for a same-note heading without reopening the note", async () => {
    const h = harness();
    await h.controller.open("#Target", "Folder/Source.md", false);
    expect(h.initialState.selectedBlockId).toBe("child");
    expect(h.openInternal).not.toHaveBeenCalled();
  });

  it.each(["tab", "split", "window", true] as const)("preserves native pane choice %s without reading the source", async (pane) => {
    const h = harness();
    await h.controller.open("#Target", "Folder/Source.md", pane);
    expect(h.openInternal).toHaveBeenCalledExactlyOnceWith("#Target", "Folder/Source.md", pane);
    expect(h.readSource).not.toHaveBeenCalled();
    expect(h.initialState.selectedBlockId).toBe("root");
  });

  it("falls back to native navigation when there is no local heading", async () => {
    const h = harness();
    await h.controller.open("Other#Target", "Folder/Source.md", false);
    expect(h.openInternal).toHaveBeenCalledExactlyOnceWith("Other#Target", "Folder/Source.md", false);
    expect(h.readSource).not.toHaveBeenCalled();
  });

  it("falls back safely when cached source cannot map to the current card", async () => {
    const h = harness();
    h.setText("# unrelated source");
    await h.controller.open("#Target", "Folder/Source.md", false);
    expect(h.openInternal).toHaveBeenCalledOnce();
    expect(h.initialState.selectedBlockId).toBe("root");
  });

  it.each(["file", "state", "selection", "cancel"] as const)("does not steal selection after %s changes during a source read", async (change) => {
    const h = harness();
    const read = deferred<string>();
    h.readSource.mockReturnValueOnce(read.promise);
    const opening = h.controller.open("#Target", "Folder/Source.md", false);
    if (change === "file") h.setPath("Other.md");
    if (change === "state") h.setState(null);
    if (change === "selection") h.initialState.selectedBlockId = "manual-selection";
    if (change === "cancel") h.controller.cancelPending();
    read.resolve(source);
    await opening;
    expect(h.initialState.selectedBlockId).toBe(change === "selection" ? "manual-selection" : "root");
    expect(h.openInternal).not.toHaveBeenCalled();
  });

  it("keeps the latest navigation when an older heading read finishes late", async () => {
    const h = harness();
    const read = deferred<string>();
    h.readSource.mockReturnValueOnce(read.promise);
    const old = h.controller.open("#Target", "Folder/Source.md", false);
    await h.controller.open("Other#Newer", "Folder/Source.md", false);
    read.resolve(source);
    await old;
    expect(h.initialState.selectedBlockId).toBe("root");
    expect(h.openInternal).toHaveBeenCalledExactlyOnceWith("Other#Newer", "Folder/Source.md", false);
  });
});
