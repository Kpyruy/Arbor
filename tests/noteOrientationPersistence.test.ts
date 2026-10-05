import { describe, expect, it } from "vitest";
import { buildBranchDocument, parseBranchDocument, updateStoredOverviewOrientation } from "../src/storage/document";
import { fixtureLoaded, deferred } from "./helpers/arborFixtures";
import { DocumentController, type DocumentPort } from "../src/view/state/DocumentController";
import { addChild } from "../src/model/tree";

function controllerFixture() {
  const loaded = fixtureLoaded("draft");
  let file = { path: "A.md" };
  let text = buildBranchDocument("---\ntitle: Note\n---\n", loaded.linearized.body, loaded.metadata, loaded.outputState);
  const port: DocumentPort = {
    getFile: () => file as never, cachedRead: async () => text,
    process: async (_file, transform) => { text = transform(text); return text; },
    markOwnWrite() {}, rememberManagedNote() {}, commitEditIfNeeded: async () => {},
    clearEditingSession() {}, beforeOverviewEditSave() {}, onMutationPrepared() {}, onSelectionRestored() {},
    onEditedBlockSaved() {}, onProfileActivated() {}, requestRender() {}, notify() {}, reportError() {}
  };
  const controller = new DocumentController(port);
  controller.replaceLoadedState(loaded);
  return { controller, port, loaded, get text() { return text; }, switchFile() { file = { path: "B.md" }; controller.replaceLoadedState(fixtureLoaded()); } };
}

describe("note orientation persistence", () => {
  it("updates only the hidden footer, keeping CRLF text, frontmatter and profiles byte-identical", () => {
    const fixture = controllerFixture();
    const text = fixture.text.replace(/\n/g, "\r\n");
    const before = text.slice(0, text.indexOf("%% arbor:structure"));
    const next = updateStoredOverviewOrientation(text, "vertical-bottom-up", fixture.loaded.metadata);
    expect(next.slice(0, next.indexOf("%% arbor:structure"))).toBe(before);
    expect(parseBranchDocument(next).metadata?.overviewOrientation).toBe("vertical-bottom-up");
    expect(parseBranchDocument(next).outputRaw).toBe(parseBranchDocument(text).outputRaw);
    expect(parseBranchDocument(next).outputState).toEqual(parseBranchDocument(text).outputState);
  });

  it("does not add an orientation history step, and text undo/redo retains the current preference", async () => {
    const { controller } = controllerFixture();
    await controller.applyMutation("Add child", metadata => addChild(metadata, "root"));
    await controller.saveOverviewOrientation("vertical-top-down");
    await controller.undo();
    expect(controller.getState()!.metadata.blocks).toHaveLength(4);
    expect(controller.getState()!.metadata.overviewOrientation).toBe("vertical-top-down");
    await controller.redo();
    expect(controller.getState()!.metadata.blocks).toHaveLength(5);
    expect(controller.getState()!.metadata.overviewOrientation).toBe("vertical-top-down");
  });

  it("serializes rapid choices so the final choice survives reopening", async () => {
    const fixture = controllerFixture();
    await Promise.all([fixture.controller.saveOverviewOrientation("vertical-top-down"), fixture.controller.saveOverviewOrientation("horizontal")]);
    expect(parseBranchDocument(fixture.text).metadata?.overviewOrientation).toBe("horizontal");
  });

  it("does not apply a completed old-file save to a newly loaded note", async () => {
    const fixture = controllerFixture();
    const gate = deferred<void>();
    const process = fixture.port.process.bind(fixture.port);
    fixture.port.process = async (file, transform) => { await gate.promise; return process(file, transform); };
    const save = fixture.controller.saveOverviewOrientation("vertical-top-down");
    await Promise.resolve();
    fixture.switchFile();
    gate.resolve();
    await save;
    expect(fixture.controller.getState()!.metadata.overviewOrientation).toBeUndefined();
  });

  it("leaves the current preference unchanged when its save fails", async () => {
    const fixture = controllerFixture();
    fixture.port.process = async () => { throw Error("Disk unavailable"); };
    await expect(fixture.controller.saveOverviewOrientation("horizontal")).rejects.toThrow("Disk unavailable");
    expect(fixture.controller.getState()!.metadata.overviewOrientation).toBeUndefined();
  });

  it("keeps a newer on-disk preference while persisting an older content snapshot", async () => {
    const fixture = controllerFixture();
    await fixture.controller.saveOverviewOrientation("vertical-top-down");
    fixture.controller.acceptOverviewOrientation(null);
    await fixture.controller.persistState("Edit from another view");
    expect(parseBranchDocument(fixture.text).metadata?.overviewOrientation).toBe("vertical-top-down");
  });

  it("synchronizes a layout-only change without resetting a peer view's history or draft", async () => {
    const fixture = controllerFixture();
    await fixture.controller.applyMutation("Add child", metadata => addChild(metadata, "root"));
    const updated = updateStoredOverviewOrientation(fixture.text, "vertical-bottom-up", fixture.loaded.metadata);
    await fixture.port.process(fixture.port.getFile()!, () => updated);
    expect(fixture.controller.syncOrientationOnlyChange(updated)).toBe(true);
    await fixture.controller.undo();
    expect(fixture.controller.getState()!.metadata.blocks).toHaveLength(4);
    expect(fixture.controller.getState()!.metadata.overviewOrientation).toBe("vertical-bottom-up");
    expect(fixture.controller.syncOrientationOnlyChange(updated.replace("First", "Changed externally"))).toBe(false);
  });
});
