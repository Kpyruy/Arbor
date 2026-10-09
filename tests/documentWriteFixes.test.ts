import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { buildBranchDocument, parseBranchDocument } from "../src/storage/document";
import { linearizeTree } from "../src/storage/serializer";
import * as document from "../src/view/state/DocumentController";
import { BlockEditorController } from "../src/view/editor/BlockEditorController";
import { DraftRecoveryStore } from "../src/view/editor/DraftRecoveryStore";
import { deferred, fixtureOutput, fixtureTree } from "./helpers/arborFixtures";

async function fixture() {
  const tree = fixtureTree();
  const initial = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
  const files: { a: TFile; b: TFile } = { a: { path: "A.md" } as never, b: { path: "B.md" } as never };
  let currentFile = files.a;
  const disk = new Map([[files.a.path, initial], [files.b.path, initial]]);
  const writes: string[] = [];
  const effects: string[] = [];
  const errors: unknown[] = [];
  const notices: string[] = [];
  const recovery = new DraftRecoveryStore();
  const port: document.DocumentPort = {
    getFile: () => currentFile, cachedRead: async file => disk.get(file.path)!,
    process: async (file, transform) => {
      const contents = transform(disk.get(file.path)!);
      disk.set(file.path, contents);
      writes.push(file.path);
      return contents;
    },
    markOwnWrite: path => effects.push(`mark:${path}`), rememberManagedNote: path => effects.push(`managed:${path}`),
    commitEditIfNeeded: async () => {}, clearEditingSession: () => effects.push("clear"),
    beforeOverviewEditSave: () => {}, onMutationPrepared: () => effects.push("prepared"),
    onSelectionRestored: () => effects.push("selection"), onEditedBlockSaved: () => effects.push("edited"),
    onProfileActivated: () => effects.push("profile"), requestRender: () => effects.push("render"),
    notify: message => notices.push(message), reportError: (_message, error) => errors.push(error)
  };
  const controller = new document.DocumentController(port);
  const load = async () => controller.replaceLoadedState((await controller.readLoadedFileState(currentFile, "first")).state);
  await load();
  const editor = new BlockEditorController({
    getState: () => controller.getState(), getFilePath: () => currentFile.path,
    getLoadedFileIdentity: () => controller.getLoadedFileIdentity(), recoveryStore: recovery,
    usesTouchControls: () => false, getViewportHeight: () => 600,
    onBegin() {}, onCancel() {}, onUnchanged: async () => { effects.push("unchanged"); },
    saveEdit: session => controller.commitEditedBlock(session), onCommitted: () => effects.push("committed"),
    onInput() {}, handleSearchShortcut: () => false, paste: async () => {}, drop: async () => {}
  });
  return { files, disk, initial, writes, effects, errors, notices, port, controller, editor, recovery, load,
    switchFile: () => { currentFile = files.b; } };
}

const editFirst = (tree: ReturnType<typeof fixtureTree>) => ({
  metadata: { ...tree, blocks: tree.blocks.map(block => block.id === "first" ? { ...block, content: "Saved A payload" } : block) },
  selectedBlockId: "first"
});

describe("Task 3 write-boundary fixes", () => {
  it.each(["editor", "mutation", "orientation"])("cancels a new %s save while identical-byte B is still loading", async action => {
    const test = await fixture();
    test.editor.beginEditingBlock("first");
    const session = test.editor.getSession()!;
    session.value = "A draft, not B content";
    test.switchFile();
    test.controller.invalidateLoad();
    const read = deferred<string>();
    test.port.cachedRead = () => read.promise;
    const loading = test.controller.readLoadedFileState(test.files.b, "first");
    const saving = action === "editor" ? test.editor.commitEditingSession()
      : action === "orientation" ? test.controller.saveOverviewOrientation("horizontal")
      : test.controller.applyMutation("Mutation during B load", editFirst);
    await expect(saving).rejects.toBeInstanceOf(document.DocumentLoadChangedError);
    expect(test.disk.get("A.md")).toBe(test.initial);
    expect(test.disk.get("B.md")).toBe(test.initial);
    expect(test.writes).toEqual([]);
    expect(test.effects).toEqual([]);
    expect(test.editor.getSession()).toBe(session);
    expect(session.value).toBe("A draft, not B content");
    if (action === "editor") expect(test.recovery.getForFile("A.md")).toMatchObject([{ value: session.value }]);
    read.resolve(test.initial);
    test.controller.replaceLoadedState((await loading).state);
    await expect(test.editor.commitEditingSession()).rejects.toBeInstanceOf(document.DocumentLoadChangedError);
    expect(test.writes).toEqual([]);
  });

  it("cancels an unchanged old editor rather than invoking B's success UI", async () => {
    const test = await fixture();
    test.editor.beginEditingBlock("first");
    test.switchFile();
    test.controller.invalidateLoad();
    await test.load();
    await expect(test.editor.commitEditingSession()).rejects.toBeInstanceOf(document.DocumentLoadChangedError);
    expect(test.editor.getSession()).not.toBeNull();
    expect(test.effects).toEqual([]);
    expect(test.writes).toEqual([]);
  });

  it("rejects a previous editor after a same-file reload without rejecting an ordinary own commit", async () => {
    const test = await fixture();
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Old load draft";
    const session = { ...test.editor.getSession()! };
    test.controller.invalidateLoad();
    await test.load();
    await expect(test.controller.commitEditedBlock(session)).rejects.toBeInstanceOf(document.DocumentLoadChangedError);
    expect(test.writes).toEqual([]);
    test.editor.reset();
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Current load draft";
    await test.editor.commitEditingSession();
    expect(parseBranchDocument(test.disk.get("A.md")!).body).toContain("Current load draft");
  });

  it("does not continue an old file's card switch after its successful save receipt", async () => {
    const test = await fixture();
    const receipt = deferred<void>();
    const durable = deferred<void>();
    const process = test.port.process.bind(test.port);
    test.port.process = async (file, transform) => {
      const persisted = await process(file, transform);
      durable.resolve();
      await receipt.promise;
      return persisted;
    };
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Saved A before switching cards";
    test.editor.beginEditingBlock("second");
    await durable.promise;
    test.editor.reset();
    test.controller.reset();
    test.switchFile();
    await test.load();
    receipt.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(test.disk.get("A.md")).not.toBe(test.initial);
    expect(test.editor.getSession()).toBeNull();
  });

  it("still opens the requested card after a successful same-load save", async () => {
    const test = await fixture();
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Saved before same-load card switch";
    test.editor.beginEditingBlock("second");
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(test.editor.getSession()?.blockId).toBe("second");
    expect(parseBranchDocument(test.disk.get("A.md")!).body).toContain("Saved before same-load card switch");
  });

  it.each(["before transform", "after transform"])("returns a typed IO refusal %s and retains the exact draft without bookkeeping", async stage => {
    const test = await fixture();
    const failure = Error("disk full");
    test.port.process = async (file, transform) => {
      if (stage === "after transform") transform(test.disk.get(file.path)!);
      throw failure;
    };
    test.editor.beginEditingBlock("first");
    test.editor.getSession()!.value = "Retained draft";
    const before = structuredClone(test.controller.getState());
    const error: unknown = await test.editor.commitEditingSession().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: "DocumentWriteError", filePath: "A.md", cause: failure });
    expect(error).toBeInstanceOf(document.DocumentWriteError);
    expect(error instanceof document.DocumentWriteError && error.cause).toBe(failure);
    expect(test.disk.get("A.md")).toBe(test.initial);
    expect(test.controller.getState()).toEqual(before);
    expect(test.effects).toEqual([]);
    expect(test.editor.getSession()!.value).toBe("Retained draft");
    expect(test.recovery.getForFile("A.md")).toMatchObject([{ value: "Retained draft" }]);
    await test.controller.undo();
    expect(test.writes).toEqual([]);
  });

  it.each(["before transform", "after transform"])("returns a typed orientation IO refusal %s with no own-write reservation", async stage => {
    const test = await fixture();
    const failure = Error("read only");
    test.port.process = async (file, transform) => {
      if (stage === "after transform") transform(test.disk.get(file.path)!);
      throw failure;
    };
    const before = structuredClone(test.controller.getState());
    const error: unknown = await test.controller.saveOverviewOrientation("horizontal").catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: "DocumentWriteError", cause: failure });
    expect(error).toBeInstanceOf(document.DocumentWriteError);
    expect(error instanceof document.DocumentWriteError && error.cause).toBe(failure);
    expect(test.disk.get("A.md")).toBe(test.initial);
    expect(test.controller.getState()).toEqual(before);
    expect(test.effects).toEqual([]);
  });

  it.each(["editor", "mutation", "orientation", "profile", "profile mutation", "output mutation", "output reset", "undo", "redo"])("acknowledges durable old-file %s completion without publishing into B", async action => {
    const test = await fixture();
    if (action === "undo" || action === "redo") {
      await test.controller.applyMutation("Prior edit", editFirst);
      if (action === "redo") await test.controller.undo();
    }
    if (action === "output reset") {
      test.disk.set("A.md", test.initial.replace(/%% arbor:output[\s\S]*?\n%%/, "%% arbor:output\n```json\n{broken}\n```\n%%"));
      await test.load();
    }
    test.effects.length = 0;
    test.writes.length = 0;
    const durable = deferred<void>();
    const receipt = deferred<void>();
    const process = test.port.process.bind(test.port);
    test.port.process = async (file, transform) => {
      const persisted = await process(file, transform);
      durable.resolve();
      await receipt.promise;
      return persisted;
    };
    test.editor.beginEditingBlock("first");
    const session = test.editor.getSession()!;
    session.value = "Saved A payload";
    test.editor.retainCurrentDraft();
    const saving = action === "editor" ? test.editor.commitEditingSession()
      : action === "orientation" ? test.controller.saveOverviewOrientation("horizontal")
      : action === "profile" ? test.controller.applyActiveOutputProfile(fixtureOutput("full"))
      : action === "profile mutation" ? test.controller.applyOutputProfileMutation("Profiles", fixtureOutput("full"))
      : action === "output mutation" ? test.controller.applyOutputMutation("Rename", profile => ({ ...profile, name: "Saved profile" }))
      : action === "output reset" ? test.controller.resetInvalidOutputProfiles()
      : action === "undo" || action === "redo" ? test.controller[action]()
      : test.controller.applyMutation("Old file edit", editFirst);
    await durable.promise;
    expect(test.effects).toEqual([]);
    const persisted = test.disk.get("A.md");
    test.switchFile();
    test.controller.invalidateLoad();
    await test.load();
    test.controller.clearHistory();
    const currentState = structuredClone(test.controller.getState());
    receipt.resolve();
    const result = await saving;
    if (["profile", "profile mutation", "output reset"].includes(action)) expect(result).toHaveProperty("profiles");
    else expect(result).toBeUndefined();
    expect(test.writes).toEqual(["A.md"]);
    expect(test.disk.get("A.md")).toBe(persisted);
    expect(test.disk.get("B.md")).toBe(test.initial);
    expect(test.controller.getState()).toEqual(currentState);
    expect(test.effects).toEqual(action === "orientation" ? ["mark:A.md"] : ["mark:A.md", "managed:A.md"]);
    expect(test.errors).toEqual([]);
    expect(test.notices).toEqual([]);
    if (action === "editor") {
      expect(parseBranchDocument(persisted!).body).toContain("Saved A payload");
      expect(test.editor.getSession()).toBeNull();
      expect(test.recovery.getForFile("A.md")).toEqual([]);
    }
    await test.controller.undo();
    expect(test.writes).toEqual(["A.md"]);
  });

  it("keeps mutator and post-save render errors distinct from IO refusal", async () => {
    const test = await fixture();
    const failure = Error("mutator refusal");
    await expect(test.controller.applyMutation("Bad mutator", () => { throw failure; })).rejects.toBe(failure);
    expect(test.writes).toEqual([]);
    test.port.requestRender = () => { throw failure; };
    await expect(test.controller.applyMutation("Render refusal", editFirst)).rejects.toBe(failure);
    expect(parseBranchDocument(test.disk.get("A.md")!).body).toContain("Saved A payload");
    expect(test.effects).toEqual(["mark:A.md", "managed:A.md", "prepared"]);
  });

  it.each(["before transform", "after durable write"])("settles a reset editor correctly %s without disturbing B's new draft", async stage => {
    const test = await fixture();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const process = test.port.process.bind(test.port);
    test.port.process = async (file, transform) => {
      if (stage === "before transform") {
        entered.resolve();
        await finish.promise;
        return process(file, transform);
      }
      const persisted = await process(file, transform);
      entered.resolve();
      await finish.promise;
      return persisted;
    };
    test.editor.beginEditingBlock("first");
    const oldSession = test.editor.getSession()!;
    oldSession.value = "A saved snapshot";
    const saving = test.editor.commitEditingSession();
    const settled = saving.then(() => null, (error: unknown) => error);
    await entered.promise;
    test.editor.reset();
    test.controller.reset();
    test.switchFile();
    await test.load();
    test.editor.beginEditingBlock("first");
    const newSession = test.editor.getSession()!;
    newSession.value = "B new draft";
    finish.resolve();
    const error = await settled;
    if (stage === "before transform") {
      expect(error).toBeInstanceOf(document.DocumentLoadChangedError);
      expect(test.disk.get("A.md")).toBe(test.initial);
      expect(test.writes).toEqual([]);
      expect(test.effects).toEqual([]);
      expect(test.recovery.getForFile("A.md")).toMatchObject([{ value: "A saved snapshot" }]);
    } else {
      expect(error).toBeNull();
      expect(parseBranchDocument(test.disk.get("A.md")!).body).toContain("A saved snapshot");
      expect(test.writes).toEqual(["A.md"]);
      expect(test.effects).toEqual(["mark:A.md", "managed:A.md"]);
      expect(test.recovery.getForFile("A.md")).toEqual([]);
      expect(test.errors).toEqual([]);
      expect(test.notices).toEqual([]);
    }
    expect(test.disk.get("B.md")).toBe(test.initial);
    expect(test.editor.getSession()).toBe(newSession);
    expect(newSession.value).toBe("B new draft");
    expect(test.controller.getState()!.metadata.blocks.find(block => block.id === "first")!.content).toBe("First");
  });

  it("acknowledges only the durable snapshot and retains newer A typing while B's load is pending", async () => {
    const test = await fixture();
    const durable = deferred<void>();
    const finish = deferred<void>();
    const process = test.port.process.bind(test.port);
    test.port.process = async (file, transform) => {
      const persisted = await process(file, transform);
      durable.resolve();
      await finish.promise;
      return persisted;
    };
    test.editor.beginEditingBlock("first");
    const session = test.editor.getSession()!;
    session.value = "A saved snapshot";
    const saving = test.editor.commitEditingSession();
    await durable.promise;
    session.value = "A newer typing";
    test.switchFile();
    test.controller.invalidateLoad();
    finish.resolve();
    await saving;
    expect(parseBranchDocument(test.disk.get("A.md")!).body).toContain("A saved snapshot");
    expect(test.disk.get("A.md")).not.toContain("A newer typing");
    expect(test.disk.get("B.md")).toBe(test.initial);
    expect(test.editor.getSession()).toBe(session);
    expect(session.originalContent).toBe("A saved snapshot");
    expect(test.recovery.getForFile("A.md")).toMatchObject([{ originalContent: "A saved snapshot", value: "A newer typing" }]);
    expect(test.effects).toEqual(["mark:A.md", "managed:A.md"]);
    expect(test.errors).toEqual([]);
    await expect(test.editor.commitEditingSession()).rejects.toBeInstanceOf(document.DocumentLoadChangedError);
    expect(test.writes).toEqual(["A.md"]);
  });
});
