import { describe, expect, it } from "vitest";
import { DraftRecoveryStore } from "../src/view/editor/DraftRecoveryStore";
import { BlockEditorController, type BlockEditorPort } from "../src/view/editor/BlockEditorController";
import { deferred, fixtureLoaded } from "./helpers/arborFixtures";

function recoveryEditor(store: DraftRecoveryStore) {
  const state = fixtureLoaded();
  const port: BlockEditorPort = {
    getState: () => state, getFilePath: () => "Note.md", recoveryStore: store,
    usesTouchControls: () => false, getViewportHeight: () => 600,
    onBegin() {}, onCancel() {}, onUnchanged: async () => {}, saveEdit: async () => { throw Error("disk full"); },
    onInput() {}, handleSearchShortcut: () => false, paste: async () => {}, drop: async () => {}
  };
  return { editor: new BlockEditorController(port), port, state };
}

describe("plugin-lifetime draft recovery", () => {
  it("retains the current reverted value instead of a stale recovery copy", async () => {
    const store = new DraftRecoveryStore();
    const fixture = recoveryEditor(store);
    fixture.editor.beginEditingBlock("first");
    fixture.editor.getSession()!.value = "Failed draft";
    await expect(fixture.editor.commitEditIfNeeded()).rejects.toThrow("disk full");
    fixture.editor.getSession()!.value = "First";
    fixture.editor.reset();
    expect(store.getAll("Note.md", "first")[0].value).toBe("First");
  });
  it("does not discard a restored unchanged draft without validating the disk save", async () => {
    const store = new DraftRecoveryStore();
    store.retain({ draftId: "same", filePath: "Note.md", blockId: "first", originalContent: "Old", value: "First" });
    const fixture = recoveryEditor(store);
    fixture.editor.restoreDraft("same", "first");
    await expect(fixture.editor.commitEditIfNeeded()).rejects.toThrow("disk full");
    expect(store.getAll("Note.md", "first")).toHaveLength(1);
    expect(fixture.editor.getSession()!.value).toBe("First");
  });
  it("copies data on retain and read and preserves separate sessions of the same card", () => {
    const store = new DraftRecoveryStore();
    const first = { draftId: "first", filePath: "Note.md", blockId: "first", originalContent: "First", value: "Draft one" };
    store.retain(first);
    first.value = "Mutated caller";
    store.retain({ ...first, draftId: "second", value: "Draft two" });
    expect(store.getAll("Note.md", "first").map(draft => draft.value)).toEqual(["Draft one", "Draft two"]);
    const copy = store.getAll("Note.md", "first")[0];
    Object.assign(copy, { value: "Mutated reader" });
    expect(store.getAll("Note.md", "first")[0].value).toBe("Draft one");
    store.retain({ ...first, value: "Updated first" });
    store.remove("second");
    expect(store.getAll("Note.md", "first")).toEqual([{ ...first, value: "Updated first" }]);
    expect(store.getAll("Other.md", "first")).toEqual([]);
    expect(store.getForFile("Note.md")).toHaveLength(1);
  });

  it("recovers two failed sessions after reset with explicit selection and current content", async () => {
    const store = new DraftRecoveryStore();
    const first = recoveryEditor(store);
    const second = recoveryEditor(store);
    for (const [fixture, value] of [[first, "Draft one"], [second, "Draft two"]] as const) {
      fixture.editor.beginEditingBlock("first");
      fixture.editor.getSession()!.value = value;
      await expect(fixture.editor.commitEditIfNeeded()).rejects.toThrow("disk full");
      fixture.editor.reset();
    }
    const drafts = store.getAll("Note.md", "first");
    expect(drafts.map(draft => draft.value)).toEqual(["Draft one", "Draft two"]);
    expect(drafts[0].draftId).not.toBe(drafts[1].draftId);
    const reopened = recoveryEditor(store);
    reopened.state.metadata.blocks.find(block => block.id === "first")!.content = "External current";
    expect(reopened.editor.restoreDraft(drafts[1].draftId, "first")).toBe(true);
    expect(reopened.editor.getSession()).toMatchObject({ originalContent: "External current", value: "Draft two", recoveryId: drafts[1].draftId });
    reopened.port.saveEdit = async () => {};
    await reopened.editor.commitEditIfNeeded();
    expect(store.getAll("Note.md", "first").map(draft => draft.value)).toEqual(["Draft one"]);
  });

  it("retains an unavoidable close while saving, including subsequent edits", async () => {
    const store = new DraftRecoveryStore();
    const fixture = recoveryEditor(store);
    const gate = deferred<void>();
    fixture.port.saveEdit = () => gate.promise;
    fixture.editor.beginEditingBlock("first");
    fixture.editor.getSession()!.value = "Saving";
    const save = fixture.editor.commitEditIfNeeded();
    fixture.editor.getSession()!.value = "Newer text";
    fixture.editor.reset();
    gate.resolve();
    await save;
    expect(store.getAll("Note.md", "first")).toMatchObject([{ value: "Newer text", originalContent: "Saving" }]);
  });

  it("does not replace or discard a dirty current editor when Restore is requested", () => {
    const store = new DraftRecoveryStore();
    store.retain({ draftId: "recovered", filePath: "Note.md", blockId: "first", originalContent: "First", value: "Recovered" });
    const fixture = recoveryEditor(store);
    fixture.editor.beginEditingBlock("first");
    fixture.editor.getSession()!.value = "Working draft";
    expect(fixture.editor.restoreDraft("recovered", "first")).toBe(false);
    expect(fixture.editor.getSession()!.value).toBe("Working draft");
    expect(store.getAll("Note.md", "first")).toHaveLength(1);
  });
});
