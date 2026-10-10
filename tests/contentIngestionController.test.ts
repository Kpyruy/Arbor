import { describe, expect, it, vi } from "vitest";
import { ContentIngestionController, type ContentIngestionPort } from "../src/view/ingestion/ContentIngestionController";
import type { TransferSnapshot } from "../src/view/ingestion/ingestionTypes";
import { deferred } from "./helpers/arborFixtures";

function snapshot(plain = "incoming"): TransferSnapshot {
  return { types: ["text/plain"], markdown: "", plain, uriList: "", hasFiles: false, ownArborDrag: false };
}

function fixture() {
  let filePath = "Receiver.md";
  let epoch = 1;
  let editing: { blockId: string; id: string } | null = null;
  const blocks = new Set(["first", "second"]);
  const port: { [Key in keyof ContentIngestionPort]: (...args: Parameters<ContentIngestionPort[Key]>) => ReturnType<ContentIngestionPort[Key]> } = {
    captureTarget: blockId => blocks.has(blockId) ? { filePath, blockId, loadEpoch: epoch, ...(editing?.blockId === blockId ? { editingSessionId: editing.id } : {}) } : null,
    isCurrent: target => target.filePath === filePath && target.loadEpoch === epoch && blocks.has(target.blockId)
      && (!target.editingSessionId || editing?.id === target.editingSessionId && editing.blockId === target.blockId),
    getEditingBlockId: () => editing?.blockId ?? null,
    insertDraft: vi.fn(() => true),
    append: vi.fn(async () => undefined),
    readNative: vi.fn(async () => null),
    readClipboardText: vi.fn(async () => "clipboard"),
    openEditorForPaste: vi.fn(),
    notify: vi.fn()
  };
  const controller = new ContentIngestionController(port);
  return { controller, port, blocks, switchFile: () => { filePath = "Other.md"; }, reload: () => { epoch++; }, edit: (value: typeof editing) => { editing = value; } };
}

describe("ContentIngestionController", () => {
  it("awaits the original editor before announcing system Paste", async () => {
    const test = fixture();
    const opened = deferred<void>();
    const started = deferred<void>();
    test.port.readClipboardText = async () => { throw Error("denied"); };
    test.port.openEditorForPaste = () => { started.resolve(); return opened.promise; };
    const paste = test.controller.paste("first");
    await started.promise;
    expect(test.port.notify).not.toHaveBeenCalled();
    opened.resolve();
    expect((await paste).kind).toBe("paste-fallback");
    expect(test.port.notify).toHaveBeenCalledOnce();
  });

  it.each(["reject", "reload", "mode"])("does not advertise system Paste when asynchronous editor opening %s", async change => {
    const test = fixture();
    const opened = deferred<void>();
    const started = deferred<void>();
    test.port.readClipboardText = async () => { throw Error("denied"); };
    test.port.openEditorForPaste = () => { started.resolve(); return opened.promise; };
    const paste = test.controller.paste("first");
    await started.promise;
    if (change === "reload") test.reload();
    if (change === "mode") test.controller.cancelPending();
    if (change === "reject") opened.reject(Error("prior save failed"));
    else opened.resolve();
    expect((await paste).kind).toBe("retained");
    expect(test.controller.getRetained()[0].target.blockId).toBe("first");
    expect(test.port.notify).not.toHaveBeenCalledWith(expect.stringContaining("Use system Paste"));
  });

  it("freezes target and transfer before awaiting native text, independent of later selection", async () => {
    const { controller, port } = fixture();
    const pending = deferred<string | null>();
    port.readNative = vi.fn(() => pending.promise);
    const transfer = { ...snapshot("preview"), types: ["text/plain"] };
    const native = {};
    const drop = controller.drop({}, "first", transfer, native);
    transfer.plain = "changed";
    transfer.types.push("Files");
    pending.resolve(null);
    expect((await drop).kind).toBe("appended");
    expect(port.readNative).toHaveBeenCalledWith(native, "Receiver.md");
    expect(port.append).toHaveBeenCalledWith({ filePath: "Receiver.md", blockId: "first", loadEpoch: 1 }, "preview");
  });

  it.each(["file", "reload", "remove", "mode", "close"])("retains original content without writing after %s changes", async change => {
    const test = fixture();
    const pending = deferred<string | null>();
    test.port.readNative = () => pending.promise;
    const drop = test.controller.drop({}, "first", snapshot(), {});
    if (change === "file") test.switchFile();
    if (change === "reload") test.reload();
    if (change === "remove") test.blocks.delete("first");
    if (change === "mode") test.controller.cancelPending();
    if (change === "close") test.controller.close();
    pending.resolve("native exact");
    expect((await drop).kind).toBe("retained");
    expect(test.port.append).not.toHaveBeenCalled();
    expect(test.port.insertDraft).not.toHaveBeenCalled();
    expect(test.controller.getRetained()[0]).toMatchObject({ target: { filePath: "Receiver.md", blockId: "first", loadEpoch: 1 }, markdown: "native exact" });
  });

  it("deduplicates only event identity, never genuine identical gestures or block-ID text", async () => {
    const { controller, port } = fixture();
    const event = {};
    const first = controller.drop(event, "first", snapshot("first"));
    expect(controller.drop(event, "second", snapshot("first"))).toBe(first);
    await first;
    await controller.drop({}, "first", snapshot("first"));
    expect(port.append).toHaveBeenCalledTimes(2);
    expect(port.append).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: "first" }), "first");
  });

  it("prefers exact native content and never uses preview text after a native failure or rejection", async () => {
    const { controller, port } = fixture();
    port.readNative = vi.fn(async () => { throw new Error("provider failed"); });
    expect((await controller.drop({}, "first", snapshot("plain preview"), {})).kind).toBe("retained");
    expect(port.append).not.toHaveBeenCalled();
    expect(controller.getRetained()[0].markdown).toBeNull();
    port.readNative = vi.fn(async () => '<!-- arbor:block:v1 id="bad" -->');
    expect((await controller.drop({}, "first", snapshot("plain preview"), {})).kind).toBe("rejected");
    expect(port.append).not.toHaveBeenCalled();
    port.readNative = vi.fn(async () => "  quote\n[[A.pdf#page=7|source]]  ");
    await controller.drop({}, "first", snapshot("preview"), {});
    expect(port.append).toHaveBeenLastCalledWith(expect.anything(), "  quote\n[[A.pdf#page=7|source]]  ");
  });

  it("keeps an originally failing native route on retry even if the provider becomes unavailable", async () => {
    const { controller, port } = fixture();
    port.readNative = async () => { throw new Error("provider failed"); };
    await controller.drop({}, "first", snapshot("source-less preview"), {});
    const retained = controller.getRetained()[0];
    port.readNative = async () => null;
    expect((await controller.retry(retained.id)).kind).toBe("retained");
    expect(port.append).not.toHaveBeenCalled();
    expect(controller.getRetained()[0].markdown).toBeNull();
    port.readNative = async () => "quote\n[[original.pdf#page=7|source]]";
    expect((await controller.retry(retained.id)).kind).toBe("appended");
    expect(port.append).toHaveBeenCalledWith(retained.target, "quote\n[[original.pdf#page=7|source]]");
  });

  it("deduplicates overlapping explicit retries without deduplicating future gestures", async () => {
    const { controller, port } = fixture();
    port.append = async () => { throw new Error("conflict"); };
    await controller.paste("first");
    const retained = controller.getRetained()[0];
    const pending = deferred<void>();
    port.append = vi.fn(() => pending.promise);
    const retry = controller.retry(retained.id);
    expect(controller.retry(retained.id)).toBe(retry);
    pending.resolve();
    expect((await retry).kind).toBe("appended");
    expect(port.append).toHaveBeenCalledTimes(1);
    expect(controller.getRetained()).toEqual([]);
  });

  it("fails closed for a caret route without a captured session identity", async () => {
    const test = fixture();
    test.edit({ blockId: "first", id: "original" });
    test.port.captureTarget = blockId => ({ filePath: "Receiver.md", blockId, loadEpoch: 1 });
    expect((await test.controller.drop({}, "first", snapshot())).kind).toBe("retained");
    expect(test.port.append).not.toHaveBeenCalled();
    expect(test.port.insertDraft).not.toHaveBeenCalled();
  });

  it.each(["closed", "replaced", "other-block"])("never turns an initial caret route into a disk append when editor is %s", async change => {
    const test = fixture();
    test.edit({ blockId: "first", id: "original" });
    const pending = deferred<string | null>();
    test.port.readNative = () => pending.promise;
    const drop = test.controller.drop({}, "first", snapshot(), {});
    test.edit(change === "closed" ? null : { blockId: change === "other-block" ? "second" : "first", id: "new" });
    pending.resolve("quote");
    expect((await drop).kind).toBe("retained");
    expect(test.port.append).not.toHaveBeenCalled();
    expect(test.port.insertDraft).not.toHaveBeenCalled();
    expect(test.controller.getRetained()[0].target.editingSessionId).toBe("original");
  });

  it("inserts into the same captured editor session without writing", async () => {
    const test = fixture();
    test.edit({ blockId: "first", id: "original" });
    expect((await test.controller.drop({}, "first", snapshot())).kind).toBe("draft");
    expect(test.port.insertDraft).toHaveBeenCalledWith(expect.objectContaining({ editingSessionId: "original" }), "incoming");
    expect(test.port.append).not.toHaveBeenCalled();
  });

  it("retains failed draft insertion rather than falling through to append", async () => {
    const test = fixture();
    test.edit({ blockId: "first", id: "original" });
    test.port.insertDraft = () => false;
    expect((await test.controller.drop({}, "first", snapshot())).kind).toBe("retained");
    expect(test.port.append).not.toHaveBeenCalled();
  });

  it("retains failed append for explicit retry with its original target and exact content", async () => {
    const { controller, port } = fixture();
    port.append = vi.fn(async () => { throw new Error("prior draft save failed"); });
    const result = await controller.drop({}, "first", snapshot(" exact "));
    expect(result.kind).toBe("retained");
    const retained = controller.getRetained()[0];
    port.append = vi.fn(async () => undefined);
    expect((await controller.retry(retained.id)).kind).toBe("appended");
    expect(port.append).toHaveBeenCalledWith(retained.target, " exact ");
    expect(controller.getRetained()).toEqual([]);
  });

  it("does not retarget an explicit retry after reload, and returns defensive retention copies", async () => {
    const test = fixture();
    test.port.append = async () => { throw new Error("conflict"); };
    await test.controller.drop({}, "first", snapshot());
    const retained = test.controller.getRetained()[0];
    (retained.target as { blockId: string }).blockId = "second";
    test.reload();
    test.port.append = vi.fn(async () => undefined);
    expect((await test.controller.retry(retained.id)).kind).toBe("retained");
    expect(test.port.append).not.toHaveBeenCalled();
    expect(test.controller.getRetained()[0].target.blockId).toBe("first");
  });

  it.each(["internal", "files", "missing", "unsupported"])("ignores %s without a native generator or write", async kind => {
    const { controller, port } = fixture();
    const transfer = snapshot();
    const supplied = { ...transfer, ownArborDrag: kind === "internal", hasFiles: kind === "files", ...(kind === "unsupported" ? { plain: "", types: ["text/html"] } : {}) };
    await controller.drop({}, kind === "missing" ? "missing" : "first", supplied);
    expect(port.readNative).not.toHaveBeenCalled();
    expect(port.append).not.toHaveBeenCalled();
  });

  it("captures Paste before clipboard await and uses the same receiver", async () => {
    const { controller, port } = fixture();
    const pending = deferred<string>();
    port.readClipboardText = () => pending.promise;
    const paste = controller.paste("first");
    pending.resolve("[[Book.pdf#page=7|source]]");
    expect((await paste).kind).toBe("appended");
    expect(port.append).toHaveBeenCalledWith(expect.objectContaining({ blockId: "first" }), "[[Book.pdf#page=7|source]]");
  });

  it.each([false, true])("clipboard denial opens only a still-current original editor (stale=%s)", async stale => {
    const test = fixture();
    const pending = deferred<string>();
    test.port.readClipboardText = () => pending.promise;
    const paste = test.controller.paste("first");
    if (stale) test.reload();
    pending.reject(new Error("denied"));
    await paste;
    expect(test.port.openEditorForPaste).toHaveBeenCalledTimes(stale ? 0 : 1);
    expect(test.port.append).not.toHaveBeenCalled();
  });
});
