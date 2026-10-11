import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";
import { deferred } from "./helpers/arborFixtures";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function showOptions(test: Awaited<ReturnType<typeof ingestionHarness>>, id = "first") {
  const over = test.event("dragover");
  test.card(id).dispatchEvent(over);
  expect(over.defaultPrevented).toBe(true);
  const options = test.root.querySelector<HTMLElement>(".arbor-content-drop-options");
  expect(options, "supported external drag exposes explicit new-block targets").not.toBeNull();
  return options!;
}

const cases = (["editor", "overview"] as const).flatMap(mode =>
  (["sibling", "child"] as const).map(kind => ({ mode, kind })));

describe("external content dropped into a new block", () => {
  it.each(cases)("creates one populated $kind in $mode without changing existing content", async ({ mode, kind }) => {
    const test = await ingestionHarness(mode);
    const before = structuredClone(test.view.documentController.getState()!);
    const options = await showOptions(test);
    const zone = options.querySelector<HTMLElement>(`[data-new-block-kind='${kind}']`)!;
    expect(zone).not.toBeNull();
    zone.dispatchEvent(test.event("dragover"));
    expect(zone.classList.contains("is-content-drop-target")).toBe(true);
    zone.dispatchEvent(test.event("drop", test.transfer("> Quote\n\n[[Book.pdf#page=7|Source]]")));
    await test.settle();
    const state = test.view.documentController.getState()!;
    const created = state.metadata.blocks.find(block => !before.metadata.blocks.some(old => old.id === block.id))!;
    expect(state.metadata.blocks).toHaveLength(5);
    expect(created).toMatchObject({ parentId: kind === "child" ? "first" : "root", order: 1,
      content: "> Quote\n\n[[Book.pdf#page=7|Source]]" });
    expect(state.selectedBlockId).toBe(created.id);
    expect(test.content(created.id)).toBe(created.content);
    for (const old of before.metadata.blocks) expect(test.content(old.id)).toBe(old.content);
    expect(state.metadata.blocks.find(block => block.id === "first")).toEqual(before.metadata.blocks.find(block => block.id === "first"));
    expect(state.outputState).toEqual(before.outputState);
    expect(test.writes).toHaveLength(1);
    expect(test.root.querySelector(".arbor-content-drop-options")).toBeNull();
    await test.view.documentController.undo();
    expect(test.view.documentController.getState()!.metadata.blocks).toEqual(before.metadata.blocks);
    await test.view.documentController.redo();
    expect(test.content(created.id)).toBe(created.content);
  });

  it.each(["vertical-top-down", "vertical-bottom-up"] as const)("keeps child/sibling targets distinct in %s", async orientation => {
    const test = await ingestionHarness("overview", orientation);
    const options = await showOptions(test);
    expect(options.dataset.orientation).toBe(orientation);
    options.querySelector<HTMLElement>("[data-new-block-kind='child']")!.dispatchEvent(test.event("drop"));
    await test.settle();
    const created = test.view.documentController.getState()!.metadata.blocks.find(block => block.content === "quote");
    expect(created?.parentId).toBe("first");
    expect(test.writes).toHaveLength(1);
  });

  it("places the dock on the free side rather than over a vertical anchor near the viewport edge", async () => {
    const test = await ingestionHarness("overview", "vertical-bottom-up");
    const rect = (x: number, y: number, width: number, height: number) => new test.win.DOMRect(x, y, width, height);
    vi.spyOn(test.root, "getBoundingClientRect").mockReturnValue(rect(0, 0, 800, 600));
    vi.spyOn(test.root.querySelector<HTMLElement>(".arbor-overview-viewport")!, "getBoundingClientRect").mockReturnValue(rect(0, 80, 800, 520));
    vi.spyOn(test.card(), "getBoundingClientRect").mockReturnValue(rect(200, 100, 300, 200));
    const options = await showOptions(test);
    const top = Number.parseFloat(options.style.getPropertyValue("--arbor-drop-options-y"));
    expect(top).toBeGreaterThanOrEqual(300);
    expect(top + 112).toBeLessThanOrEqual(600);
  });

  it("keeps the dock reachable across the gap and cleans up when leaving the view", async () => {
    const test = await ingestionHarness();
    const options = await showOptions(test);
    const leave = new test.win.MouseEvent("dragleave", { bubbles: true, relatedTarget: options });
    test.card().dispatchEvent(leave);
    expect(options.isConnected).toBe(true);
    options.dispatchEvent(test.event("dragover"));
    expect(options.isConnected, "dock padding/gap remains a reachable gesture corridor").toBe(true);
    test.root.querySelector(".arbor-columns-viewport")!.dispatchEvent(test.event("dragover"));
    expect(options.isConnected).toBe(true);
    test.root.dispatchEvent(new test.win.MouseEvent("dragleave", { bubbles: true, relatedTarget: test.win.document.body }));
    expect(options.isConnected).toBe(false);
  });

  it.each(["editor", "overview"] as const)("keeps targets during a null-relatedTarget transition inside %s", async mode => {
    const test = await ingestionHarness(mode);
    vi.spyOn(test.root, "getBoundingClientRect").mockReturnValue(new test.win.DOMRect(0, 0, 800, 600));
    const options = await showOptions(test);
    test.card().dispatchEvent(new test.win.MouseEvent("dragleave", {
      bubbles: true, relatedTarget: null, clientX: 350, clientY: 250
    }));
    expect(options.isConnected, "an internal native drag transition must not remove new-block targets").toBe(true);
    test.root.dispatchEvent(new test.win.MouseEvent("dragleave", {
      bubbles: true, relatedTarget: null, clientX: 850, clientY: 250
    }));
    expect(options.isConnected, "a real exit must still clear feedback").toBe(false);
    expect(test.writes).toEqual([]);
  });

  it.each(["editor", "overview"] as const)("keeps the external drag accepted across the viewport gap in %s", async mode => {
    const test = await ingestionHarness(mode);
    const options = await showOptions(test);
    const viewport = test.root.querySelector(mode === "overview" ? ".arbor-overview-viewport" : ".arbor-columns-viewport")!;
    const over = test.event("dragover");
    viewport.dispatchEvent(over);
    expect(over.defaultPrevented, "the corridor must keep the platform's drag session eligible").toBe(true);
    expect(options.isConnected).toBe(true);
    const backgroundDrop = test.event("drop");
    viewport.dispatchEvent(backgroundDrop);
    await test.settle();
    expect(test.writes, "a background drop must not guess an insertion destination").toEqual([]);
    expect(backgroundDrop.defaultPrevented, "an accepted drag corridor must not navigate/open the dropped URL by default").toBe(true);
  });

  it.each(["editor", "overview"] as const)("does not mistake an external preview overlay for leaving %s at an inside coordinate", async mode => {
    const test = await ingestionHarness(mode);
    vi.spyOn(test.root, "getBoundingClientRect").mockReturnValue(new test.win.DOMRect(0, 0, 800, 600));
    const options = await showOptions(test);
    test.card().dispatchEvent(new test.win.MouseEvent("dragleave", {
      bubbles: true, relatedTarget: test.win.document.body, clientX: 350, clientY: 250
    }));
    expect(options.isConnected, "native preview outside the root DOM is not a physical viewport exit").toBe(true);
    test.root.dispatchEvent(new test.win.MouseEvent("dragleave", {
      bubbles: true, relatedTarget: test.win.document.body, clientX: 850, clientY: 250
    }));
    expect(options.isConnected).toBe(false);
  });

  it.each(["editor", "overview"] as const)("routes a coordinate-hit child drop when native %s events retain the viewport target", async mode => {
    const test = await ingestionHarness(mode);
    const options = await showOptions(test);
    const child = options.querySelector<HTMLElement>("[data-new-block-kind='child']")!;
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue(new test.win.DOMRect(508, 154, 232, 46));
    const viewport = test.root.querySelector(mode === "overview" ? ".arbor-overview-viewport" : ".arbor-columns-viewport")!;
    const atChild = (type: string) => {
      const event = test.event(type);
      Object.defineProperties(event, { clientX: { value: 620 }, clientY: { value: 178 } });
      return event;
    };
    viewport.dispatchEvent(atChild("dragover"));
    expect(child.classList.contains("is-content-drop-target")).toBe(true);
    viewport.dispatchEvent(atChild("drop"));
    await test.settle();
    const blocks = test.view.documentController.getState()!.metadata.blocks;
    expect(blocks).toHaveLength(5);
    expect(blocks.find(block => block.content === "quote")?.parentId).toBe("first");
    expect(test.content()).toBe("First");
    expect(test.writes).toHaveLength(1);
    expect(options.isConnected).toBe(false);
  });

  it("leaves textarea selection movement native after dragging out of the view and back", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    await test.render();
    const editor = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    editor.setSelectionRange(0, 2);
    editor.dispatchEvent(test.event("dragstart", test.transfer("Fi")));
    test.root.dispatchEvent(new test.win.MouseEvent("dragleave", { bubbles: true, relatedTarget: test.win.document.body }));
    const over = test.event("dragover", test.transfer("Fi"));
    editor.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(test.root.querySelector(".arbor-content-drop-options")).toBeNull();
    const drop = test.event("drop", test.transfer("Fi"));
    editor.dispatchEvent(drop);
    await test.settle();
    expect(drop.defaultPrevented).toBe(false);
    expect(editor.value).toBe("First");
    expect(test.writes).toEqual([]);
  });

  it("still appends when dropped on the existing card after the dock appears", async () => {
    const test = await ingestionHarness();
    await showOptions(test);
    test.card().dispatchEvent(test.event("drop"));
    await test.settle();
    expect(test.content()).toBe("First\n\nquote");
    expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(4);
  });

  it("expands a collapsed anchor when adding a child so the new block is visible", async () => {
    const test = await ingestionHarness("overview");
    test.view.documentController.getState()!.metadata.blocks.find(block => block.id === "first")!.collapsed = true;
    await test.render();
    const options = await showOptions(test);
    options.querySelector<HTMLElement>("[data-new-block-kind='child']")!.dispatchEvent(test.event("drop"));
    await test.settle();
    const state = test.view.documentController.getState()!;
    expect(state.metadata.blocks.find(block => block.id === "first")?.collapsed).toBe(false);
    expect(state.metadata.blocks.find(block => block.id === state.selectedBlockId)?.content).toBe("quote");
    await test.render();
    expect(test.card(state.selectedBlockId!)).not.toBeNull();
  });

  it.each(["empty", "managed", "files", "provider-failure"] as const)("creates no empty block for %s input", async failure => {
    const test = await ingestionHarness();
    const options = await showOptions(test);
    const data = test.transfer(failure === "empty" ? "" : failure === "managed" ? "%% arbor:structure" : "quote");
    if (failure === "files") data.files.push(new test.win.File(["binary"], "file.bin"));
    if (failure === "provider-failure") test.app.dragManager.draggable = { getText: () => { throw Error("Provider failed"); } };
    options.querySelector<HTMLElement>("[data-new-block-kind='child']")!.dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.writes).toEqual([]);
    expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(4);
    if (failure === "provider-failure") expect(test.view.ingestion.getRetained()).toHaveLength(1);
  });

  it.each(["save-failure", "file-change", "removed-anchor"] as const)("retains content and creates no block after %s", async change => {
    const test = await ingestionHarness();
    const pending = deferred<string>();
    test.app.dragManager.draggable = { getText: () => pending.promise };
    const options = await showOptions(test);
    options.querySelector<HTMLElement>("[data-new-block-kind='sibling']")!.dispatchEvent(test.event("drop"));
    if (change === "save-failure") test.app.vault.process = async () => { throw Error("disk full"); };
    if (change === "save-failure") vi.spyOn(console, "error").mockImplementation(() => {});
    if (change === "file-change") test.view.ingestion.cancelPending();
    if (change === "removed-anchor") {
      const state = test.view.documentController.getState()!;
      state.metadata.blocks = state.metadata.blocks.filter(block => block.id !== "first");
    }
    pending.resolve("exact quote");
    await test.settle();
    expect(test.writes).toEqual([]);
    expect(test.view.documentController.getState()!.metadata.blocks.some(block => block.content === "exact quote")).toBe(false);
    expect(test.view.ingestion.getRetained()[0]).toMatchObject({ markdown: "exact quote", target: { blockId: "first", newBlock: "sibling" } });
    if (change === "save-failure") {
      test.app.vault.process = async (_file, transform) => { const text = transform(await test.app.vault.read()); test.writes.push(text); return text; };
      const result = await test.view.ingestion.retry(test.view.ingestion.getRetained()[0].id);
      expect(result.kind).toBe("created");
      expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(5);
      expect(test.writes).toHaveLength(1);
    }
  });

  it("saves an edited anchor separately and imports into the new block, not its selection", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    await test.render();
    const editor = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Edited parent";
    editor.dispatchEvent(new test.win.Event("input", { bubbles: true }));
    editor.setSelectionRange(0, 6);
    const options = await showOptions(test);
    options.querySelector<HTMLElement>("[data-new-block-kind='child']")!.dispatchEvent(test.event("drop"));
    await test.settle();
    expect(test.content()).toBe("Edited parent");
    expect(test.view.documentController.getState()!.metadata.blocks.find(block => block.content === "quote")?.parentId).toBe("first");
    expect(test.writes).toHaveLength(2);
  });
});
