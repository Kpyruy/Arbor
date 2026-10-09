import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { addChild } from "../src/model/tree";
import { buildBranchDocument, parseBranchDocument, updateStoredOverviewOrientation } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import { DocumentConflictError, DocumentController, type DocumentPort } from "../src/view/state/DocumentController";
import { BlockEditorController } from "../src/view/editor/BlockEditorController";
import { deferred, fixtureOutput, fixtureTree } from "./helpers/arborFixtures";

function diskFixture() {
  const tree = fixtureTree();
  let disk = buildBranchDocument("---\ntitle: Original\n---\n", linearizeTree(tree).body, tree, fixtureOutput());
  const effects: string[] = [];
  const file: TFile = { path: "Safety.md" } as never;
  const port: DocumentPort = {
    getFile: () => file, cachedRead: async () => disk,
    process: async (_file, transform) => { disk = transform(disk); return disk; },
    markOwnWrite: () => effects.push("mark"), rememberManagedNote: () => effects.push("remember"),
    commitEditIfNeeded: async () => {}, clearEditingSession: () => effects.push("clear"),
    beforeOverviewEditSave: () => {}, onMutationPrepared: () => effects.push("prepared"),
    onSelectionRestored: () => effects.push("selection"), onEditedBlockSaved: () => effects.push("edited"),
    onProfileActivated: () => effects.push("profile"), requestRender: () => effects.push("render"),
    notify: () => {}, reportError: () => {}
  };
  const controller = new DocumentController(port);
  const load = async (target = controller) => target.replaceLoadedState((await target.readLoadedFileState(file, "first")).state);
  return { port, controller, effects, load, get disk() { return disk; }, set disk(value: string) { disk = value; } };
}

const editFirst = (value: string) => (tree: ReturnType<typeof fixtureTree>) => ({
  metadata: { ...tree, blocks: tree.blocks.map(block => block.id === "first" ? { ...block, content: value } : block) },
  selectedBlockId: "first"
});

describe("durable document writes", () => {
  it("rejects an editor draft whose block was deleted without silently saving nothing", async () => {
    const fixture = diskFixture();
    await fixture.load();
    await fixture.controller.applyMutation("Delete", tree => ({ metadata: { ...tree, blocks: tree.blocks.filter(block => block.id !== "leaf") }, selectedBlockId: "first" }));
    const before = fixture.disk;
    await expect(fixture.controller.commitEditedBlock({ blockId: "leaf", originalContent: "Leaf", value: "Retained leaf draft", origin: "card", autofocus: false })).rejects.toMatchObject({ name: "DocumentConflictError" });
    expect(fixture.disk).toBe(before);
  });

  it("rejects a queued orientation write after reset before processing disk", async () => {
    const fixture = diskFixture();
    await fixture.load();
    const before = fixture.disk;
    const save = fixture.controller.saveOverviewOrientation("horizontal");
    const rejected = expect(save).rejects.toMatchObject({ name: "DocumentLoadChangedError" });
    fixture.controller.reset();
    await rejected;
    expect(fixture.disk).toBe(before);
    expect(fixture.effects).toEqual([]);
  });

  it("rejects an orientation write when disk content changed, preserving exact external bytes", async () => {
    const fixture = diskFixture();
    await fixture.load();
    fixture.disk = fixture.disk.replace("Second", "External second");
    const before = fixture.disk;
    await expect(fixture.controller.saveOverviewOrientation("horizontal")).rejects.toMatchObject({ name: "DocumentConflictError" });
    expect(fixture.disk).toBe(before);
    expect(fixture.controller.getState()!.metadata.overviewOrientation).toBeUndefined();
  });
  it.each([
    ["frontmatter", (text: string) => text.replace("title: Original", "title: External")],
    ["other card", (text: string) => text.replace("Second", "External second")],
    ["topology", (text: string) => text.replace('"parent": "first"', '"parent": "second"')],
    ["profile", (text: string) => text.replace('"name": "Draft"', '"name": "External"')],
    ["whitespace", (text: string) => `${text}\n`],
    ["newlines", (text: string) => text.replace(/\n/g, "\r\n")]
  ])("rejects external %s changes without altering disk, state or history", async (_name, change) => {
    const fixture = diskFixture();
    await fixture.load();
    const before = structuredClone(fixture.controller.getState());
    fixture.disk = change(fixture.disk);
    expect(fixture.disk).not.toBe(before!.diskText);
    const external = fixture.disk;
    await expect(fixture.controller.applyMutation("Import", editFirst("Imported"))).rejects.toBeInstanceOf(DocumentConflictError);
    expect(fixture.disk).toBe(external);
    expect(fixture.controller.getState()).toEqual(before);
    expect(fixture.effects).not.toContain("remember");
    expect(fixture.effects).not.toContain("prepared");
    await fixture.load();
    fixture.effects.length = 0;
    await fixture.controller.undo();
    expect(fixture.effects).toEqual([]);
  });

  it("prevents a second view from overwriting the first view's successful edit", async () => {
    const fixture = diskFixture();
    const peer = new DocumentController(fixture.port);
    await fixture.load();
    await fixture.load(peer);
    await fixture.controller.applyMutation("First view", editFirst("First view saved"));
    const saved = fixture.disk;
    await expect(peer.applyMutation("Second view", editFirst("Stale"))).rejects.toMatchObject({ name: "DocumentConflictError" });
    expect(fixture.disk).toBe(saved);
  });

  it("retains disk and history on failure and retries exactly once", async () => {
    const fixture = diskFixture();
    await fixture.load();
    const before = fixture.disk;
    const process = fixture.port.process.bind(fixture.port);
    fixture.port.process = async () => { throw Error("disk full"); };
    await expect(fixture.controller.applyMutation("Import", editFirst("Saved"))).rejects.toThrow("disk full");
    expect(fixture.disk).toBe(before);
    expect(fixture.controller.getState()!.metadata.blocks.find(block => block.id === "first")!.content).toBe("First");
    fixture.port.process = process;
    await fixture.controller.undo();
    expect(fixture.disk).toBe(before);
    await fixture.controller.applyMutation("Import", editFirst("Saved"));
    await fixture.controller.undo();
    expect(parseBranchDocument(fixture.disk).body).toContain("First");
    expect(fixture.effects.filter(effect => effect === "remember")).toHaveLength(2);
  });

  it("constructs queued candidates after the previous deferred write publishes", async () => {
    const fixture = diskFixture();
    await fixture.load();
    const gate = deferred<void>();
    const entered = deferred<void>();
    const process = fixture.port.process.bind(fixture.port);
    let calls = 0;
    fixture.port.process = async (file, transform) => {
      if (++calls === 1) { entered.resolve(); await gate.promise; }
      return process(file, transform);
    };
    const first = fixture.controller.applyMutation("First import", editFirst("Imported first"));
    await entered.promise;
    const second = fixture.controller.applyMutation("Second import", tree => ({
      metadata: { ...tree, blocks: tree.blocks.map(block => block.id === "second" ? { ...block, content: "Imported second" } : block) },
      selectedBlockId: "second"
    }));
    expect(fixture.controller.getState()!.metadata.blocks.find(block => block.id === "first")!.content).toBe("First");
    gate.resolve();
    await Promise.all([first, second]);
    expect(parseBranchDocument(fixture.disk).body).toContain("Imported first");
    expect(parseBranchDocument(fixture.disk).body).toContain("Imported second");
    await fixture.controller.undo();
    expect(parseBranchDocument(fixture.disk).body).toContain("Imported first");
    expect(parseBranchDocument(fixture.disk).body).not.toContain("Imported second");
  });

  it("shares the body queue with orientation writes and preserves peer orientation only", async () => {
    const fixture = diskFixture();
    await fixture.load();
    fixture.disk = updateStoredOverviewOrientation(fixture.disk, "vertical-bottom-up", fixtureTree());
    await fixture.controller.applyMutation("Import", editFirst("Saved"));
    expect(fixture.controller.getState()!.metadata.overviewOrientation).toBe("vertical-bottom-up");
    expect(parseBranchDocument(fixture.disk).body).toContain("Saved");
    await Promise.all([
      fixture.controller.applyMutation("Add child", tree => addChild(tree, "first")),
      fixture.controller.saveOverviewOrientation("horizontal")
    ]);
    expect(fixture.controller.getState()!.metadata.blocks).toHaveLength(5);
    expect(parseBranchDocument(fixture.disk).metadata!.overviewOrientation).toBe("horizontal");
  });

  it("rejects orientation plus otherwise normalized whitespace or content changes", async () => {
    const fixture = diskFixture();
    await fixture.load();
    fixture.disk = updateStoredOverviewOrientation(fixture.disk, "horizontal", fixtureTree()) + "\n";
    expect(fixture.controller.syncOrientationOnlyChange(fixture.disk)).toBe(false);
    const external = fixture.disk;
    await expect(fixture.controller.applyMutation("Import", editFirst("Saved"))).rejects.toMatchObject({ name: "DocumentConflictError" });
    expect(fixture.disk).toBe(external);
  });

  it.each(["undo", "redo"] as const)("does not consume %s on a failed write", async action => {
    const fixture = diskFixture();
    await fixture.load();
    await fixture.controller.applyMutation("Import", editFirst("Saved"));
    if (action === "redo") await fixture.controller.undo();
    const before = fixture.disk;
    const process = fixture.port.process.bind(fixture.port);
    fixture.port.process = async () => { throw Error("disk full"); };
    await expect(fixture.controller[action]()).rejects.toThrow("disk full");
    expect(fixture.disk).toBe(before);
    fixture.port.process = process;
    await fixture.controller[action]();
    expect(parseBranchDocument(fixture.disk).body).toContain(action === "undo" ? "First" : "Saved");
  });

  it.each(["activate", "replace", "mutate", "reset"])("publishes output %s only after successful persistence", async action => {
    const fixture = diskFixture();
    await fixture.load();
    if (action === "reset") {
      fixture.disk = fixture.disk.replace(/%% arbor:output[\s\S]*?\n%%/, "%% arbor:output\n```json\n{broken}\n```\n%%");
      await fixture.load();
    }
    const before = structuredClone(fixture.controller.getState());
    const disk = fixture.disk;
    fixture.port.process = async () => { throw Error("disk full"); };
    const pending = action === "activate" ? fixture.controller.applyActiveOutputProfile(fixtureOutput("full"))
      : action === "replace" ? fixture.controller.applyOutputProfileMutation("Profiles", fixtureOutput("full"))
      : action === "mutate" ? fixture.controller.applyOutputMutation("Rename", profile => ({ ...profile, name: "Renamed" }))
      : fixture.controller.resetInvalidOutputProfiles();
    await expect(pending).rejects.toThrow("disk full");
    expect(fixture.controller.getState()).toEqual(before);
    expect(fixture.disk).toBe(disk);
    expect(fixture.effects).toEqual([]);
  });

  it("aborts an import when the preceding real editor save fails", async () => {
    const fixture = diskFixture();
    await fixture.load();
    const editor = new BlockEditorController({
      getState: () => fixture.controller.getState(), usesTouchControls: () => false, getViewportHeight: () => 600,
      onBegin() {}, onCancel() {}, onUnchanged: async () => {}, saveEdit: session => fixture.controller.commitEditedBlock(session),
      onInput() {}, handleSearchShortcut: () => false, paste: async () => {}, drop: async () => {}
    });
    fixture.port.commitEditIfNeeded = () => editor.commitEditIfNeeded();
    editor.beginEditingBlock("first");
    editor.getSession()!.value = "Unsaved";
    const before = fixture.disk;
    fixture.port.process = async () => { throw Error("disk full"); };
    let mutated = false;
    await expect(fixture.controller.applyMutation("Import elsewhere", tree => {
      mutated = true;
      return addChild(tree, "second");
    })).rejects.toThrow("disk full");
    expect(mutated).toBe(false);
    expect(fixture.disk).toBe(before);
    expect(editor.getSession()!.value).toBe("Unsaved");
  });

  it("flushes edits typed during a pending editor save before constructing an import", async () => {
    const fixture = diskFixture();
    await fixture.load();
    const editor = new BlockEditorController({
      getState: () => fixture.controller.getState(), usesTouchControls: () => false, getViewportHeight: () => 600,
      onBegin() {}, onCancel() {}, onUnchanged: async () => {}, saveEdit: session => fixture.controller.commitEditedBlock(session),
      onInput() {}, handleSearchShortcut: () => false, paste: async () => {}, drop: async () => {}
    });
    fixture.port.commitEditIfNeeded = () => editor.commitEditIfNeeded();
    const process = fixture.port.process.bind(fixture.port);
    const entered = deferred<void>();
    const gate = deferred<void>();
    let writes = 0;
    fixture.port.process = async (file, transform) => {
      if (++writes === 1) { entered.resolve(); await gate.promise; }
      return process(file, transform);
    };
    editor.beginEditingBlock("first");
    editor.getSession()!.value = "Initial draft";
    const saving = editor.commitEditingSession();
    await entered.promise;
    editor.getSession()!.value = "Newer typed text";
    const importing = fixture.controller.applyMutation("Import elsewhere", tree => {
      expect(tree.blocks.find(block => block.id === "first")!.content).toBe("Newer typed text");
      return addChild(tree, "second");
    });
    gate.resolve();
    await Promise.all([saving, importing]);
    expect(parseBranchDocument(fixture.disk).body).toContain("Newer typed text");
    expect(fixture.controller.getState()!.metadata.blocks).toHaveLength(5);
    expect(editor.getSession()).toBeNull();
    expect(writes).toBe(3);
  });
});
