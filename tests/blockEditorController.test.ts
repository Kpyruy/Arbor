import type { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockEditorController, type BlockEditorPort } from "../src/view/editor/BlockEditorController";
import { EditorAttachments } from "../src/view/editor/EditorAttachments";
import { deferred, fixtureOutput, fixtureTree } from "./helpers/arborFixtures";
import { linearizeTree } from "../src/storage/serializer";
import { ensureSelectedBlock } from "../src/model/tree";

afterEach(() => vi.useRealTimers());

function createPort(): BlockEditorPort {
  const metadata = fixtureTree();
  return {
    getState: () => ({
      metadata, frontmatter: "", outputState: fixtureOutput(), outputRaw: "", outputError: null,
      selectedBlockId: "first", staleMetadata: null, origin: "metadata", linearized: linearizeTree(metadata)
    }),
    usesTouchControls: () => false,
    getViewportHeight: () => 600,
    onBegin: () => undefined,
    onCancel: () => undefined,
    onUnchanged: async () => undefined,
    saveEdit: async () => undefined,
    onInput: () => undefined,
    handleSearchShortcut: () => false,
    paste: async () => undefined,
    drop: async () => undefined
  };
}

describe("BlockEditorController", () => {
  it("does not save a cancelled session when its old blur timer fires", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const saves: string[] = [];
    port.saveEdit = async (session) => { saves.push(session.value); };
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("first", "overview");
    const session = editor.getSession()!;
    session.value = "Changed";
    editor.scheduleEditingSessionCommit(session);
    editor.cancelEditingSession();
    await vi.advanceTimersByTimeAsync(80);

    expect(editor.getSession()).toBeNull();
    expect(saves).toEqual([]);
  });

  it("does not save an unchanged session", async () => {
    const port = createPort();
    const saves: string[] = [];
    port.saveEdit = async (session) => { saves.push(session.value); };
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("first");
    await editor.commitEditingSession();

    expect(saves).toEqual([]);
    expect(editor.getSession()).toBeNull();
  });

  it("saves a scheduled changed session only once", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const saves: string[] = [];
    port.saveEdit = async (session) => { saves.push(session.value); };
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("first");
    const session = editor.getSession()!;
    session.value = "Changed";
    editor.scheduleEditingSessionCommit(session);
    await editor.commitEditingSession(session);
    await vi.advanceTimersByTimeAsync(80);

    expect(saves).toEqual(["Changed"]);
  });

  it("does not commit a stale session after beginning another block", async () => {
    const port = createPort();
    const saves: string[] = [];
    port.saveEdit = async (session) => { saves.push(session.blockId); };
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("first");
    const stale = editor.getSession()!;
    stale.value = "Changed";
    editor.beginEditingBlock("leaf");
    await Promise.resolve();
    await editor.commitEditingSession(stale);

    expect(saves).toEqual(["first"]);
    expect(editor.getSession()?.blockId).toBe("leaf");
  });

  it("edits the requested leaf rather than the previously selected block", () => {
    const editor = new BlockEditorController(createPort());

    editor.beginEditingBlock("leaf", "preview");

    expect(editor.getSession()).toMatchObject({ blockId: "leaf", origin: "preview" });
  });

  it("normalizes a stale requested ID to the preferred root target", () => {
    const port = createPort();
    const state = port.getState()!;
    const expected = ensureSelectedBlock(state.metadata, "missing");
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("missing");

    expect(editor.getSession()?.blockId).toBe(expected);
  });

  it("commits a changed session once before starting the normalized root target", async () => {
    const port = createPort();
    const saves: string[] = [];
    port.saveEdit = async (session) => { saves.push(session.blockId); };
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("leaf");
    const session = editor.getSession()!;
    session.value = "Changed";
    editor.beginEditingBlock("missing");
    await Promise.resolve();
    await Promise.resolve();

    expect(saves).toEqual(["leaf"]);
    expect(editor.getSession()?.blockId).toBe(ensureSelectedBlock(port.getState()!.metadata, "missing"));
  });

  it("re-enters editing after the requested block is removed during the pending save", async () => {
    const port = createPort();
    const save = deferred<void>();
    const saves: string[] = [];
    port.saveEdit = async (session) => {
      saves.push(session.blockId);
      await save.promise;
    };
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("leaf");
    const session = editor.getSession()!;
    session.value = "Changed";
    editor.beginEditingBlock("first");
    port.getState()!.metadata.blocks = port.getState()!.metadata.blocks.filter((block) => block.id !== "first");

    save.resolve();
    await save.promise;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(saves).toEqual(["leaf"]);
    expect(editor.getSession()?.blockId).toBe("root");
  });

  it("commits an active session once without beginning after the tree becomes empty", async () => {
    const port = createPort();
    const save = deferred<void>();
    const saves: string[] = [];
    port.saveEdit = async (session) => {
      saves.push(session.blockId);
      await save.promise;
    };
    let begins = 0;
    port.onBegin = () => { begins += 1; };
    const editor = new BlockEditorController(port);

    editor.beginEditingBlock("leaf");
    begins = 0;
    const session = editor.getSession()!;
    session.value = "Changed";
    port.getState()!.metadata.blocks = [];
    editor.beginEditingBlock("first");

    save.resolve();
    await save.promise;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(editor.getSession()).toBeNull();
    expect(saves).toEqual(["leaf"]);
    expect(begins).toBe(0);
  });
});

function textarea(value = ""): HTMLTextAreaElement {
  const editor = {
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    setSelectionRange(start: number, end: number) { editor.selectionStart = start; editor.selectionEnd = end; },
    dispatchEvent: () => true
  };
  return editor as unknown as HTMLTextAreaElement;
}

describe("EditorAttachments", () => {
  it("leaves non-image paste to the editor", async () => {
    let prevented = false;
    const attachments = new EditorAttachments({
      getFilePath: () => "note.md", hasSession: () => true,
      getAvailablePath: async () => "attachments/image.png",
      createBinary: async () => {
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
        return { path: "attachments/image.png" } as TFile;
      },
      generateLink: () => "[[image]]", onInserted: () => undefined,
      notify: () => undefined, reportError: () => undefined
    });

    await attachments.handleEditorPaste({
      clipboardData: { items: [{ kind: "string", type: "text/plain" }] },
      preventDefault: () => { prevented = true; }
    } as unknown as ClipboardEvent, textarea());

    expect(prevented).toBe(false);
  });

  it("stores an image and inserts one embed link", async () => {
    const calls: string[] = [];
    const editor = textarea("Text");
    const image = {
      name: "diagram.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(2)
    } as File;
    const attachments = new EditorAttachments({
      getFilePath: () => "note.md", hasSession: () => true,
      getAvailablePath: async (name, source) => { calls.push(`path:${name}:${source}`); return "attachments/diagram.png"; },
      createBinary: async (path) => {
        calls.push(`write:${path}`);
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
        return { path } as TFile;
      },
      generateLink: () => "![[diagram.png]]", onInserted: () => calls.push("inserted"),
      notify: () => undefined, reportError: () => undefined
    });

    await attachments.handleEditorDrop({
      dataTransfer: { files: [image] }, preventDefault: () => calls.push("prevented")
    } as unknown as DragEvent, editor);

    expect(editor.value).toBe("Text\n\n![[diagram.png]]");
    expect(calls).toEqual(["prevented", "path:diagram.png:note.md", "write:attachments/diagram.png", "inserted"]);
  });
});
