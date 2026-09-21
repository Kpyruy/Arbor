import { describe, expect, it } from "vitest";
import { addChild, deleteBlockAndLiftChildren, deleteSubtree, duplicateSubtree, getDescendantIds } from "../src/model/tree";
import { buildBranchDocument } from "../src/storage/document";
import { resolveOutputStates } from "../src/outputProfiles";
import { linearizeTree } from "../src/storage/serializer";
import { DocumentController, type DocumentPort } from "../src/view/state/DocumentController";
import { BlockEditorController } from "../src/view/editor/BlockEditorController";
import type { TFile } from "obsidian";
import { fixtureLoaded, fixtureOutput, fixtureTree, deferred } from "./helpers/arborFixtures";

function createFixturePort(document = "") {
  const notices: string[] = [];
  const errors: Array<{ message: string; error: unknown }> = [];
  const order: string[] = [];
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- lightweight test fixture
  const file = { path: "Document.md" } as unknown as TFile;
  let source = document;
  let process = async (_file: TFile, transform: (text: string) => string): Promise<string> => {
    order.push("persist");
    source = transform(source);
    return source;
  };
  const port: DocumentPort = {
    getFile: () => file,
    cachedRead: async () => source,
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
    get source() { return source; },
    setProcess(next: typeof process) { process = next; }
  };
}

describe("DocumentController", () => {
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
      "commit", "preserve-overview", "edited", "mark", "persist", "remember", "render",
      "prepared:true", "mark", "persist", "remember", "render"
    ]);
    expect(editor.getSession()).toBeNull();
    const afterMutation = structuredClone(controller.getState()!);
    const serialized = fixture.source;
    fixture.order.length = 0;
    await controller.undo();
    expect(fixture.order).toEqual(["commit", "clear-edit", "selection-restored", "mark", "persist", "remember", "render"]);
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
    loaded.metadata = { ...loaded.metadata, blocks: loaded.metadata.blocks.filter((block) => block.id !== "leaf") };
    loaded.origin = "reconciled";
    controller.replaceLoadedState(loaded);
    const expectedRules = structuredClone(loaded.outputState);

    await controller.rebuildTreeFromMetadata();

    expect(controller.getState()!.metadata).toEqual(fixtureTree());
    expect(controller.getState()!.outputState).toEqual(expectedRules);
    expect(fixture.order).toEqual(["commit", "clear-edit", "selection-restored", "mark", "persist", "remember", "render"]);
  });

  it("makes an activated profile visible before deferred persistence", async () => {
    const fixture = createFixturePort();
    const pending = deferred<string>();
    fixture.setProcess(async (_file, transform) => {
      fixture.order.push("persist");
      transform("");
      return pending.promise;
    });
    const controller = new DocumentController(fixture.port);
    controller.replaceLoadedState(fixtureLoaded("full"));
    fixture.port.onProfileActivated = () => fixture.order.push(
      `visible:${controller.getState()?.outputState.activeProfileId}`
    );

    const switching = controller.applyActiveOutputProfile(fixtureOutput("draft"));
    await Promise.resolve();

    expect(fixture.order).toEqual(["commit", "visible:draft", "render", "mark", "persist"]);
    pending.resolve("");
    await switching;
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

    expect(fixture.order.slice(0, 3)).toEqual(["commit", "clear-edit", "selection-restored"]);
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

    await controller.persistState("Save fixture");

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
