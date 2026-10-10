import { describe, expect, it } from "vitest";
import { setBlockColor } from "../src/model/blockAppearance";
import { addChild, deleteBlockAndLiftChildren, deleteSubtree, duplicateSubtree, getDescendantIds } from "../src/model/tree";
import { buildBranchDocument } from "../src/storage/document";
import { resolveOutputStates } from "../src/outputProfiles";
import { linearizeTree } from "../src/storage/serializer";
import { DocumentController, type DocumentPort } from "../src/view/state/DocumentController";
import { BlockEditorController } from "../src/view/editor/BlockEditorController";
import type { TFile } from "obsidian";
import { fixtureLoaded, fixtureOutput, fixtureTree, deferred } from "./helpers/arborFixtures";
import { appendIncomingContent, createIncomingBlock } from "../src/model/ingestContent";
import { ContentIngestionController, type ContentIngestionPort } from "../src/view/ingestion/ContentIngestionController";
import { loadImportedBranchDocument } from "../src/storage/reconcile";
import { StorageAmbiguityError } from "../src/storage/sourceMap";
import type { ArborOverviewOrientation } from "../src/types";

function ingestionFixture() {
  const disk = createFixturePort();
  const document = new DocumentController(disk.port);
  document.replaceLoadedState(fixtureLoaded());
  const port: ContentIngestionPort = {
    captureTarget: blockId => {
      const loaded = document.getLoadedFileIdentity();
      return loaded && document.getState()!.metadata.blocks.some(block => block.id === blockId)
        ? { filePath: loaded.path, blockId, loadEpoch: loaded.epoch } : null;
    },
    isCurrent: target => {
      const loaded = document.getLoadedFileIdentity();
      return Boolean(loaded && loaded.path === target.filePath && loaded.epoch === target.loadEpoch
        && document.getState()!.metadata.blocks.some(block => block.id === target.blockId));
    },
    getEditingBlockId: () => null,
    saveImage: async () => "![[image.png]]",
    insertDraft: () => false,
    append: async (target, markdown) => document.applyMutation("Append incoming content", metadata => {
      if (!ingestion.isCurrent(target)) throw new Error("Original ingestion gesture changed");
      return appendIncomingContent(metadata, target.blockId, markdown);
    }),
    create: async (target, markdown) => document.applyMutation("Import into new block", metadata => {
      if (!ingestion.isCurrent(target) || !target.newBlock) throw new Error("Original ingestion gesture changed");
      return createIncomingBlock(metadata, target.blockId, target.newBlock, markdown);
    }),
    readNative: async () => null,
    readClipboardText: async () => "quote\n[[Book.pdf#page=7|source]]",
    openEditorForPaste: () => undefined,
    notify: () => undefined
  };
  const ingestion = new ContentIngestionController(port);
  return { disk, document, ingestion, port };
}

describe("content ingestion with the real document safe-save gate", () => {
  it("keeps the original card across selection and ordinary own commits during a native read", async () => {
    const test = ingestionFixture();
    const originalIdentity = test.document.getLoadedFileIdentity();
    const pending = deferred<string | null>();
    test.port.readNative = () => pending.promise;
    const drop = test.ingestion.drop({}, "first", { types: ["text/plain"], plain: "preview", markdown: "", uriList: "", hasFiles: false, ownArborDrag: false }, {});
    test.document.setSelection("second");
    await test.document.applyMutation("Other card edit", metadata => appendIncomingContent(metadata, "second", "other"));
    expect(test.document.getLoadedFileIdentity()).toBe(originalIdentity);
    pending.resolve("quote\n[[Original.pdf#page=7|source]]");
    expect((await drop).kind).toBe("appended");
    expect(test.document.getState()!.metadata.blocks.find(block => block.id === "first")?.content).toBe("First\n\nquote\n[[Original.pdf#page=7|source]]");
    expect(test.document.getState()!.metadata.blocks.find(block => block.id === "second")?.content).toBe("Second\n\nother");
  });

  it.each<ArborOverviewOrientation>(["horizontal", "vertical-top-down", "vertical-bottom-up"])("appends as one history unit, preserves output and reopens byte-exactly in %s", orientation => {
    return (async () => {
      const tree = fixtureTree();
      tree.overviewOrientation = orientation;
      tree.blocks[1].appearance = { cardColor: "#123456", branchColor: "#abcdef" };
      tree.blocks.find(block => block.id === "leaf")!.after = "\n\n";
      tree.blocks.find(block => block.id === "second")!.after = "";
      const beforeSource = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
      const disk = createFixturePort(beforeSource);
      const document = new DocumentController(disk.port);
      document.replaceLoadedState((await document.readLoadedFileState(disk.port.getFile()!, "second")).state);
      const before = structuredClone(document.getState()!);
      const identity = document.getLoadedFileIdentity();
      const incoming = '> Quote\n\n[[Books/A.pdf#page=7|Source]]\n\nExample: `code\n<!-- arbor:block:v1 id="example" parent="" order="0" -->\ncode`.';
      await document.applyMutation("Append incoming content", metadata => appendIncomingContent(metadata, "first", incoming));
      const after = structuredClone(document.getState()!);
      const afterSource = disk.source;
      expect(document.getLoadedFileIdentity()).toBe(identity);
      expect(after.metadata.blocks).toHaveLength(before.metadata.blocks.length);
      expect(after.metadata.blocks.find(block => block.id === "first")?.content).toBe(`First\n\n${incoming}`);
      expect(after.selectedBlockId).toBe("first");
      expect(after.outputState).toEqual(before.outputState);
      expect(after.metadata.blocks[1].appearance).toEqual(before.metadata.blocks[1].appearance);
      await document.undo();
      expect(disk.source).toBe(beforeSource);
      expect(document.getState()!.metadata).toEqual(before.metadata);
      expect(document.getState()!.selectedBlockId).toBe("second");
      const writes = disk.order.filter(item => item === "persist").length;
      await document.undo();
      expect(disk.order.filter(item => item === "persist")).toHaveLength(writes);
      await document.redo();
      expect(document.getState()).toEqual(after);
      expect(disk.source).toBe(afterSource);
      const reopened = loadImportedBranchDocument(disk.source);
      expect(reopened.metadata.blocks.map(block => block.content)).toEqual(after.metadata.blocks.map(block => block.content));
      expect(reopened.metadata.blocks.map(({ id, parentId, order, after: separator, appearance }) => ({ id, parentId, order, after: separator, appearance })))
        .toEqual(after.metadata.blocks.map(({ id, parentId, order, after: separator, appearance }) => ({ id, parentId, order, after: separator, appearance })));
      expect(reopened.metadata.overviewOrientation).toBe(orientation);
      expect(reopened.outputState).toEqual(after.outputState);
      expect(buildBranchDocument("", linearizeTree(reopened.metadata).body, reopened.metadata, reopened.outputState)).toBe(afterSource);
    })();
  });

  it.each(["mode", "removed", "file", "close"])("revalidates after a pending draft commit when %s changes", async change => {
    const test = ingestionFixture();
    const gate = deferred<void>();
    const entered = deferred<void>();
    test.disk.port.commitEditIfNeeded = () => { entered.resolve(); return gate.promise; };
    const before = structuredClone(test.document.getState());
    const paste = test.ingestion.paste("first");
    await entered.promise;
    if (change === "mode") test.ingestion.cancelPending();
    if (change === "close") test.ingestion.close();
    if (change === "file") test.document.replaceLoadedState(fixtureLoaded());
    if (change === "removed") test.document.getState()!.metadata.blocks.splice(1, 1);
    gate.resolve();
    expect((await paste).kind).toBe("retained");
    expect(test.disk.source).toBe("");
    expect(test.disk.order).not.toContain("persist");
    expect(test.ingestion.getRetained()[0].target.blockId).toBe("first");
    if (change === "mode" || change === "close") expect(test.document.getState()).toEqual(before);
  });

  it("a failed real editor save stops ingestion and keeps both the draft and incoming content", async () => {
    const test = ingestionFixture();
    const editor = new BlockEditorController({
      getFilePath: () => "Document.md", getLoadedFileIdentity: () => test.document.getLoadedFileIdentity(),
      getState: () => test.document.getState(), usesTouchControls: () => false, getViewportHeight: () => 900,
      onBegin: () => undefined, onCancel: () => undefined, onUnchanged: async () => undefined,
      saveEdit: session => test.document.commitEditedBlock(session), onInput: () => undefined,
      handleSearchShortcut: () => false, paste: async () => undefined, drop: async () => undefined
    });
    editor.beginEditingBlock("second");
    const session = editor.getSession()!;
    session.value = "unsaved draft";
    test.disk.port.commitEditIfNeeded = () => editor.commitEditIfNeeded();
    test.disk.setProcess(async () => { throw new Error("disk failed"); });
    const before = structuredClone(test.document.getState());
    expect((await test.ingestion.paste("first")).kind).toBe("retained");
    expect(editor.getSession()).toBe(session);
    expect(session.value).toBe("unsaved draft");
    expect(test.document.getState()).toEqual(before);
    expect(test.disk.source).toBe("");
    expect(test.ingestion.getRetained()[0].markdown).toBe("quote\n[[Book.pdf#page=7|source]]");
  });

  it.each(["write", "conflict", "pre-write-load"])("retains content without publishing on distinct %s failures", async failure => {
    const test = ingestionFixture();
    const before = structuredClone(test.document.getState());
    test.disk.setProcess(async (_file, transform) => {
      if (failure === "write") throw new Error("disk failed");
      if (failure === "pre-write-load") test.document.invalidateLoad();
      return transform(failure === "conflict" ? "external bytes" : "");
    });
    expect((await test.ingestion.paste("first")).kind).toBe("retained");
    expect(test.disk.errors[0].error).toMatchObject({ name: failure === "write" ? "DocumentWriteError" : failure === "conflict" ? "DocumentConflictError" : "DocumentLoadChangedError" });
    expect(test.document.getState()).toEqual(before);
    expect(test.ingestion.getRetained()).toHaveLength(1);
  });

  it("acknowledges a durable old-file receipt without publishing into a newer load or offering a duplicate retry", async () => {
    const test = ingestionFixture();
    const receipt = deferred<string>();
    const saved = deferred<void>();
    let durableText = "";
    test.disk.setProcess(async (_file, transform) => {
      durableText = transform("");
      saved.resolve();
      return receipt.promise;
    });
    const paste = test.ingestion.paste("first");
    await saved.promise;
    const replacement = fixtureLoaded("draft");
    test.document.replaceLoadedState(replacement);
    receipt.resolve(durableText);
    expect((await paste).kind).toBe("appended");
    expect(loadImportedBranchDocument(durableText).metadata.blocks.find(block => block.id === "first")?.content).toBe("First\n\nquote\n[[Book.pdf#page=7|source]]");
    expect(test.document.getState()).toBe(replacement);
    expect(test.ingestion.getRetained()).toEqual([]);
  });
});

function createFixturePort(document = "") {
  const notices: string[] = [];
  const errors: Array<{ message: string; error: unknown }> = [];
  const order: string[] = [];
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- lightweight test fixture
  const file = { path: "Document.md" } as unknown as TFile;
  let currentFile = file;
  const sources = new Map([[file, document]]);
  const readSource = (target: TFile): string => {
    const source = sources.get(target);
    if (source === undefined) throw new Error(`Unknown test file: ${target.path}`);
    return source;
  };
  let process = async (target: TFile, transform: (text: string) => string): Promise<string> => {
    order.push("persist");
    const source = transform(readSource(target));
    sources.set(target, source);
    return source;
  };
  const port: DocumentPort = {
    getFile: () => currentFile,
    cachedRead: async target => readSource(target),
    process: (target, transform) => process(target, transform),
    markOwnWrite: () => { order.push("mark"); },
    rememberManagedNote: () => { order.push("remember"); },
    commitEditIfNeeded: async () => { order.push("commit"); },
    clearEditingSession: () => { order.push("clear-edit"); },
    beforeOverviewEditSave: () => { order.push("preserve-overview"); },
    onMutationPrepared: (autofocus) => { order.push(`prepared:${autofocus}`); },
    onSelectionRestored: () => { order.push("selection-restored"); },
    onEditedBlockSaved: () => { order.push("edited"); },
    onProfileActivated: () => { order.push("visible"); },
    requestRender: () => { order.push("render"); },
    notify: (message) => notices.push(message),
    reportError: (message, error) => errors.push({ message, error })
  };
  return {
    port,
    notices,
    errors,
    order,
    get source() { return readSource(file); },
    readSource,
    setSource(next: string) { sources.set(currentFile, next); },
    setFile(next: TFile, source: string) { currentFile = next; sources.set(next, source); },
    setProcess(next: typeof process) { process = next; }
  };
}

function ambiguousStorageSource(change = "edit") {
  const tree = fixtureTree();
  tree.blocks[1].content = 'First\n\n````md\n<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\nliteral\n````\n\n```ts\nconst unfinished = true;';
  tree.blocks[3].content = "```ts\nconst child = true;\n```";
  tree.blocks[3].after = "\n\n";
  tree.blocks[2].after = "";
  const source = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
  return changeStorageSource(source, change);
}

function changeStorageSource(source: string, change: string) {
  if (change === "delete") return source.replace('<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\n```ts\nconst child = true;\n```\n\n', "");
  if (change === "hidden") return `\`\`\`md\n${source}`;
  if (change === "edit") return source.replace("const unfinished", "let unfinished");
  return source;
}

describe("document storage ambiguity gate", () => {
  it.each(["delete", "hidden"])("refuses a real %s load without changing disk, selection, draft callbacks or existing history", async change => {
    const tree = fixtureTree();
    const initialSource = change === "hidden"
      ? buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput()) : ambiguousStorageSource("none");
    const fixture = createFixturePort(initialSource);
    const controller = new DocumentController(fixture.port);
    const file = fixture.port.getFile()!;
    controller.replaceLoadedState((await controller.readLoadedFileState(file, "second")).state);
    await controller.applyMutation("Existing history", tree => appendIncomingContent(tree, "second", "prior"));
    const beforeSource = fixture.source;
    const before = structuredClone(controller.getState());
    const external = changeStorageSource(beforeSource, change);
    fixture.setSource(external);
    fixture.order.length = 0;

    await expect(controller.readLoadedFileState(file, "first")).rejects.toBeInstanceOf(StorageAmbiguityError);
    expect(controller.getLoadedFileIdentity()).toBeNull();
    expect(controller.getState()).toEqual(before);
    expect(fixture.source).toBe(external);
    expect(fixture.order).toEqual([]);
    expect(fixture.notices).toHaveLength(1);
    await expect(controller.applyMutation("Refused append", tree => appendIncomingContent(tree, "second", "incoming")))
      .rejects.toMatchObject({ name: "DocumentLoadChangedError" });
    expect(fixture.source).toBe(external);

    fixture.setSource(beforeSource);
    const recovered = (await controller.readLoadedFileState(file, "second")).state;
    controller.replaceLoadedState(recovered);
    await controller.undo();
    expect(fixture.source).toBe(initialSource);
    expect(controller.getState()!.selectedBlockId).toBe("second");
    await controller.redo();
    expect(fixture.source).toBe(beforeSource);
    expect(controller.getState()).toEqual(recovered);
  });

  it.each(["delete", "hidden"].flatMap(change => ["mutation", "orientation", "persist"].map(operation => ({ change, operation }))))(
    "refuses a real $operation after external $change without disk/history writes", async ({ change, operation }) => {
      const tree = fixtureTree();
      const initialSource = change === "hidden"
        ? buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput()) : ambiguousStorageSource("none");
      const fixture = createFixturePort(initialSource);
      const controller = new DocumentController(fixture.port);
      const file = fixture.port.getFile()!;
      controller.replaceLoadedState((await controller.readLoadedFileState(file, "second")).state);
      await controller.applyMutation("Existing history", tree => appendIncomingContent(tree, "second", "prior"));
      const beforeSource = fixture.source;
      const before = structuredClone(controller.getState());
      const identity = controller.getLoadedFileIdentity();
      const external = changeStorageSource(beforeSource, change);
      fixture.setSource(external);
      fixture.order.length = 0;

      const write = operation === "mutation"
        ? controller.applyMutation("Refused append", tree => appendIncomingContent(tree, "second", "incoming"))
        : operation === "orientation" ? controller.saveOverviewOrientation("vertical-top-down") : controller.persistState("Refused persist");
      await expect(write).rejects.toBeInstanceOf(StorageAmbiguityError);
      expect(fixture.source).toBe(external);
      expect(controller.getState()).toEqual(before);
      expect(controller.getLoadedFileIdentity()).toBe(identity);
      expect(fixture.notices).toHaveLength(1);
      expect(fixture.errors[0].error).toBeInstanceOf(StorageAmbiguityError);
      expect(fixture.order).not.toContain("mark");
      expect(fixture.order).not.toContain("remember");
      expect(fixture.order).not.toContain("clear-edit");
      expect(fixture.order).not.toContain("edited");
      expect(fixture.order).not.toContain("render");

      fixture.setSource(beforeSource);
      await controller.undo();
      expect(fixture.source).toBe(initialSource);
      expect(controller.getState()!.selectedBlockId).toBe("second");
      await controller.redo();
      expect(fixture.source).toBe(beforeSource);
      expect(controller.getState()).toEqual(before);
    });

  it.each(["B", "newer A"])("keeps %s writable when a deferred A read eventually refuses ambiguous storage", async replacement => {
    const tree = fixtureTree();
    const initialSource = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    const fixture = createFixturePort(initialSource);
    const controller = new DocumentController(fixture.port);
    const firstFile = fixture.port.getFile()!;
    controller.replaceLoadedState((await controller.readLoadedFileState(firstFile, "first")).state);
    const pending = deferred<string>();
    const cachedRead = fixture.port.cachedRead.bind(fixture.port);
    fixture.port.cachedRead = target => target === firstFile ? pending.promise : cachedRead(target);
    const oldRead = controller.readLoadedFileState(firstFile, "first");
    const rejection = expect(oldRead).rejects.toBeInstanceOf(StorageAmbiguityError);
    fixture.port.cachedRead = cachedRead;
    const currentFile = replacement === "B" ? createFixturePort().port.getFile()! : firstFile;
    if (replacement === "B") currentFile.path = "B.md";
    tree.blocks[1].content = replacement;
    const currentSource = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    fixture.setFile(currentFile, currentSource);
    controller.replaceLoadedState((await controller.readLoadedFileState(currentFile, "second")).state);
    await controller.applyMutation("Current history", metadata => appendIncomingContent(metadata, "second", "prior"));
    const beforeSource = fixture.readSource(currentFile);
    const before = structuredClone(controller.getState());
    const identity = controller.getLoadedFileIdentity();
    fixture.order.length = 0;

    pending.resolve(ambiguousStorageSource());
    await rejection;
    expect(controller.getLoadedFileIdentity()).toBe(identity);
    expect(controller.getState()).toEqual(before);
    expect(fixture.readSource(currentFile)).toBe(beforeSource);
    expect(fixture.order).toEqual([]);
    expect(fixture.notices).toEqual([]);
    expect(fixture.errors).toEqual([]);
    await controller.undo();
    expect(fixture.readSource(currentFile)).toBe(currentSource);
    expect(controller.getState()!.selectedBlockId).toBe("second");
    await controller.redo();
    expect(fixture.readSource(currentFile)).toBe(beforeSource);
    expect(controller.getState()).toEqual(before);
    await controller.applyMutation("Still writable", metadata => appendIncomingContent(metadata, "second", "after refusal"));
    expect(loadImportedBranchDocument(fixture.readSource(currentFile)).metadata.blocks.find(block => block.id === "second")?.content)
      .toBe("Second\n\nprior\n\nafter refusal");
    if (replacement === "B") expect(fixture.readSource(firstFile)).toBe(initialSource);
  });

  it("notifies on refused load and makes the previous state non-writable without clearing its draft/history", async () => {
    const source = ambiguousStorageSource();
    const fixture = createFixturePort(source);
    const controller = new DocumentController(fixture.port);
    controller.replaceLoadedState(fixtureLoaded());
    const before = structuredClone(controller.getState());
    await expect(controller.readLoadedFileState(fixture.port.getFile()!, "first")).rejects.toMatchObject({ name: "StorageAmbiguityError" });
    expect(fixture.notices.join(" ")).toMatch(/ambiguous/i);
    expect(controller.getLoadedFileIdentity()).toBeNull();
    expect(controller.getState()).toEqual(before);
    expect(fixture.source).toBe(source);
    expect(fixture.order).toEqual([]);
  });

  it.each(["mutation", "orientation", "persist"])("refuses %s even if a partial imported state is supplied with an ambiguous disk baseline", async operation => {
    const source = ambiguousStorageSource();
    const fixture = createFixturePort(source);
    const controller = new DocumentController(fixture.port);
    const partial = fixtureLoaded();
    partial.diskText = source;
    partial.metadata.blocks = partial.metadata.blocks.filter(block => block.id !== "leaf");
    controller.replaceLoadedState(partial);
    const before = structuredClone(controller.getState());
    const write = operation === "mutation"
      ? controller.applyMutation("Unsafe append", tree => appendIncomingContent(tree, "first", "incoming"))
      : operation === "orientation" ? controller.saveOverviewOrientation("vertical-top-down") : controller.persistState("Unsafe partial state");
    await expect(write).rejects.toMatchObject({ name: "StorageAmbiguityError" });
    expect(fixture.notices.join(" ")).toMatch(/ambiguous/i);
    expect(fixture.source).toBe(source);
    expect(controller.getState()).toEqual(before);
    expect(fixture.order).not.toContain("clear-edit");
    expect(fixture.order).not.toContain("mark");
    const writes = fixture.order.filter(item => item === "persist").length;
    await controller.undo();
    expect(fixture.order.filter(item => item === "persist")).toHaveLength(writes);
  });

  it("round-trips the combined code case through real append, undo, redo and reopen", async () => {
    const tree = fixtureTree();
    tree.blocks[1].content = 'First\n\n````md\n<!-- arbor:block:v1 id="leaf" parent="first" order="0" -->\nliteral\n````';
    tree.blocks[3].content = "```ts\nchild\n```";
    tree.blocks[3].after = "\n\n";
    tree.blocks[2].after = "";
    tree.overviewOrientation = "vertical-bottom-up";
    tree.blocks[1].appearance = { cardColor: "#123456" };
    const initialSource = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
    const fixture = createFixturePort(initialSource);
    const controller = new DocumentController(fixture.port);
    controller.replaceLoadedState((await controller.readLoadedFileState(fixture.port.getFile()!, "second")).state);
    await controller.applyMutation("Append", metadata => appendIncomingContent(metadata, "first", "```ts\nunfinished"));
    const appendedSource = fixture.source;
    expect(appendedSource).not.toBe(initialSource);
    const appended = loadImportedBranchDocument(appendedSource);
    expect(appended.metadata.blocks).toHaveLength(4);
    expect(appended.metadata.blocks[1].content).toBe(`${tree.blocks[1].content}\n\n\`\`\`ts\nunfinished`);
    expect(appended.metadata.blocks[3].content).toBe(tree.blocks[3].content);
    await controller.undo();
    expect(fixture.source).toBe(initialSource);
    await controller.redo();
    expect(fixture.source).toBe(appendedSource);
    const reopened = await controller.readLoadedFileState(fixture.port.getFile()!, "first");
    expect(reopened.state.metadata).toEqual(appended.metadata);
    expect(reopened.state.outputState).toEqual(fixtureOutput());
  });
});

describe("DocumentController", () => {
  it.each(["state", "file"])("ignores a colour mutation when its %s changes while committing an editor", async (change) => {
    const fixture = createFixturePort();
    const controller = new DocumentController(fixture.port);
    const original = fixtureLoaded();
    controller.replaceLoadedState(original);
    const pending = deferred<void>();
    fixture.port.commitEditIfNeeded = () => pending.promise;
    const mutation = controller.applyMutation("Set card color", metadata => ({
      metadata: setBlockColor(metadata, "root", "card", "#44aa88"),
      selectedBlockId: "root"
    }));
    if (change === "state") controller.replaceLoadedState(fixtureLoaded("draft"));
    else {
      const replacementFile = createFixturePort().port.getFile();
      fixture.port.getFile = () => replacementFile;
    }
    pending.resolve();
    await expect(mutation).rejects.toMatchObject({ name: "DocumentLoadChangedError" });
    expect(controller.getState()!.metadata.blocks[0].appearance).toBeUndefined();
    expect(fixture.source).toBe("");
    expect(fixture.order).not.toContain("persist");
    await controller.undo();
    expect(fixture.order).not.toContain("persist");
  });
  it("commits a real pending editor before mutation and restores the two history steps in order", async () => {
    const fixture = createFixturePort();
    const controller = new DocumentController(fixture.port);
    const loaded = fixtureLoaded("draft");
    controller.replaceLoadedState(loaded);
    const editor = new BlockEditorController({
      getState: () => controller.getState(),
      usesTouchControls: () => false,
      getViewportHeight: () => 900,
      onBegin: () => undefined,
      onCancel: () => undefined,
      onUnchanged: async () => undefined,
      saveEdit: (session) => controller.commitEditedBlock(session),
      onInput: () => undefined,
      handleSearchShortcut: () => false,
      paste: async () => undefined,
      drop: async () => undefined
    });
    fixture.port.commitEditIfNeeded = async () => {
      fixture.order.push("commit");
      await editor.commitEditIfNeeded();
    };
    const first = loaded.metadata.blocks.find((block) => block.id === "first")!;
    editor.prepareCreatedBlock(first, "overview");
    editor.getSession()!.value = "Edited first";
    let createdId = "";

    await controller.applyMutation("Create child", (metadata) => {
      expect(metadata.blocks.find((block) => block.id === "first")?.content).toBe("Edited first");
      const mutation = addChild(metadata, "root");
      createdId = mutation.selectedBlockId;
      return mutation;
    }, true);

    expect(fixture.order).toEqual([
      "commit", "preserve-overview", "persist", "mark", "remember", "edited", "render",
      "persist", "mark", "remember", "prepared:true", "render"
    ]);
    expect(editor.getSession()).toBeNull();
    const afterMutation = structuredClone(controller.getState()!);
    const serialized = fixture.source;
    fixture.order.length = 0;
    await controller.undo();
    expect(fixture.order).toEqual(["commit", "persist", "mark", "remember", "clear-edit", "selection-restored", "render"]);
    expect(controller.getState()!.metadata.blocks.some((block) => block.id === createdId)).toBe(false);
    expect(controller.getState()!.metadata.blocks.find((block) => block.id === "first")?.content).toBe("Edited first");
    expect(controller.getState()!.selectedBlockId).toBe("first");
    await controller.undo();
    expect(controller.getState()!.metadata.blocks.find((block) => block.id === "first")?.content).toBe("First");
    await controller.redo();
    await controller.redo();
    expect(controller.getState()).toEqual(afterMutation);
    expect(fixture.source).toBe(serialized);
  });

  it("restores stale metadata using the selection-only callback and keeps output rules", async () => {
    const fixture = createFixturePort("Plain Markdown without stored tree metadata");
    const controller = new DocumentController(fixture.port);
    const loaded = fixtureLoaded("draft");
    loaded.staleMetadata = fixtureTree();
    loaded.diskText = fixture.source;
    loaded.metadata = { ...loaded.metadata, blocks: loaded.metadata.blocks.filter((block) => block.id !== "leaf") };
    loaded.origin = "reconciled";
    controller.replaceLoadedState(loaded);
    const expectedRules = structuredClone(loaded.outputState);

    await controller.rebuildTreeFromMetadata();

    expect(controller.getState()!.metadata).toEqual(fixtureTree());
    expect(controller.getState()!.outputState).toEqual(expectedRules);
    expect(fixture.order).toEqual(["commit", "clear-edit", "selection-restored", "persist", "mark", "remember", "render"]);
  });

  it("makes an activated profile visible only after deferred persistence", async () => {
    const fixture = createFixturePort();
    const pending = deferred<string>();
    const entered = deferred<void>();
    fixture.setProcess(async (_file, transform) => {
      fixture.order.push("persist");
      transform("");
      entered.resolve();
      return pending.promise;
    });
    const controller = new DocumentController(fixture.port);
    controller.replaceLoadedState(fixtureLoaded("full"));
    fixture.port.onProfileActivated = () => fixture.order.push(
      `visible:${controller.getState()?.outputState.activeProfileId}`
    );

    const switching = controller.applyActiveOutputProfile(fixtureOutput("draft"));
    await entered.promise;

    expect(controller.getState()!.outputState.activeProfileId).toBe("full");
    expect(fixture.order).toEqual(["commit", "persist"]);
    pending.resolve("");
    await switching;
    expect(controller.getState()!.outputState.activeProfileId).toBe("draft");
    expect(fixture.order).toEqual(["commit", "persist", "mark", "remember", "visible:draft", "render"]);
  });

  it("preserves malformed output metadata byte-for-byte while persisting a tree mutation", async () => {
    const loaded = fixtureLoaded();
    loaded.outputError = "Invalid output metadata";
    loaded.outputRaw = "%% arbor:output\n```json\n{broken}\n```\n%%";
    const fixture = createFixturePort();
    const controller = new DocumentController(fixture.port);
    controller.replaceLoadedState(loaded);

    await controller.applyMutation("Create child", (metadata) => addChild(metadata, "first"));

    expect(fixture.source).toContain(loaded.outputRaw);
    expect(fixture.source.split(loaded.outputRaw)).toHaveLength(2);
  });

  it("restores selection focus after clearing the editing session", async () => {
    const fixture = createFixturePort();
    const controller = new DocumentController(fixture.port);
    controller.replaceLoadedState(fixtureLoaded());

    await controller.applyMutation("Create child", (metadata) => addChild(metadata, "first"));
    fixture.order.length = 0;

    await controller.undo();

    expect(fixture.order.indexOf("clear-edit")).toBeGreaterThan(fixture.order.indexOf("remember"));
    expect(fixture.order.indexOf("selection-restored")).toBeGreaterThan(fixture.order.indexOf("clear-edit"));
    expect(fixture.order).not.toContain("prepared:false");
  });

  it("keeps navigation selection assignments direct, including null", () => {
    const controller = new DocumentController(createFixturePort().port);
    controller.replaceLoadedState(fixtureLoaded());

    controller.setSelection(null);

    expect(controller.getState()!.selectedBlockId).toBeNull();
  });

  it("reconciles inherited output, duplicated subtree rules, deletion and history with real mutations", async () => {
    const fixture = createFixturePort();
    const controller = new DocumentController(fixture.port);
    const loaded = fixtureLoaded("draft");
    loaded.outputState = fixtureOutput("draft");
    loaded.outputState.profiles[0].rules = [{ blockId: "root", state: "exclude" }];
    controller.replaceLoadedState(loaded);

    let createdChildId = "";
    await controller.applyMutation("Create child", (metadata) => {
      const result = addChild(metadata, "root");
      createdChildId = result.selectedBlockId;
      return result;
    });
    const created = controller.getState()!;
    expect(created.metadata.blocks.some((block) => block.id === createdChildId)).toBe(true);
    expect(created.outputState.profiles[0].rules).toEqual([{ blockId: "root", state: "exclude" }]);
    const resolved = resolveOutputStates(created.metadata, created.outputState.profiles[0]);
    expect(resolved.get(createdChildId)).toMatchObject({ included: false, source: "inherited", ruleBlockId: "root" });

    await controller.applyMutation("Duplicate subtree", (metadata) => duplicateSubtree(metadata, "root"));
    const duplicated = controller.getState()!;
    const duplicateRoot = duplicated.metadata.blocks.find((block) => block.id !== "root" && block.parentId === null)!;
    expect(duplicated.outputState.profiles[0].rules).toContainEqual({ blockId: duplicateRoot.id, state: "exclude" });
    const beforeLift = structuredClone({
      metadata: duplicated.metadata,
      outputState: duplicated.outputState,
      selection: duplicated.selectedBlockId
    });
    const duplicateDescendants = getDescendantIds(duplicated.metadata, duplicateRoot.id);
    expect(duplicateDescendants.length).toBeGreaterThan(0);

    await controller.applyMutation("Delete block", (metadata) => deleteBlockAndLiftChildren(metadata, "root"));
    const lifted = controller.getState()!.metadata;
    expect(lifted.blocks.find((block) => block.id === "first")?.parentId).toBeNull();
    expect(lifted.blocks.find((block) => block.id === "second")?.parentId).toBeNull();
    expect(lifted.blocks.find((block) => block.id === "leaf")?.parentId).toBe("first");
    expect(lifted.blocks.some((block) => block.id === createdChildId)).toBe(true);
    const afterLift = {
      metadata: structuredClone(lifted),
      outputState: structuredClone(controller.getState()!.outputState),
      selection: controller.getState()!.selectedBlockId
    };
    await controller.undo();
    expect({
      metadata: controller.getState()!.metadata,
      outputState: controller.getState()!.outputState,
      selection: controller.getState()!.selectedBlockId
    }).toEqual(beforeLift);
    await controller.redo();
    expect({
      metadata: controller.getState()!.metadata,
      outputState: controller.getState()!.outputState,
      selection: controller.getState()!.selectedBlockId
    }).toEqual(afterLift);

    await controller.applyMutation("Delete subtree", (metadata) => deleteSubtree(metadata, duplicateRoot.id));
    const remainingIds = new Set(controller.getState()!.metadata.blocks.map((block) => block.id));
    expect(remainingIds.has(duplicateRoot.id)).toBe(false);
    for (const descendant of duplicateDescendants) {
      expect(remainingIds.has(descendant)).toBe(false);
    }
  });

  it("notifies and releases writing state when process rejects", async () => {
    const fixture = createFixturePort();
    fixture.setProcess(async () => Promise.reject(new Error("disk full")));
    const controller = new DocumentController(fixture.port);
    controller.replaceLoadedState(fixtureLoaded());

    await expect(controller.persistState("Save fixture")).rejects.toThrow("disk full");

    expect(fixture.notices).toEqual(['Arbor could not save the note after "Save fixture".']);
    expect(fixture.errors).toHaveLength(1);
    expect(controller.isWriting()).toBe(false);
  });

  it("reads a real serialized document without mutating loaded state", async () => {
    const metadata = fixtureTree();
    const source = buildBranchDocument("", linearizeTree(metadata).body, metadata, fixtureOutput("draft"));
    const fixture = createFixturePort(source);
    const controller = new DocumentController(fixture.port);

    const read = await controller.readLoadedFileState(fixture.port.getFile()!, "second");

    expect(read.state.selectedBlockId).toBe("second");
    expect(controller.getState()).toBeNull();
  });
});
