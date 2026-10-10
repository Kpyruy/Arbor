import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";
import { deferred } from "./helpers/arborFixtures";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function imageTransfer(test: Awaited<ReturnType<typeof ingestionHarness>>, name = "photo.png", type = "image/png") {
  const data = test.transfer("lossy filename");
  data.types.push("Files");
  data.files.push(new test.win.File(["image bytes"], name, { type }));
  return data;
}

describe("image content into cards and new blocks", () => {
  it("does not turn a rendered-image drag into an internal whole-card move", async () => {
    const test = await ingestionHarness();
    const content = test.card().querySelector<HTMLElement>(".arbor-card-content")!;
    const embed = content.createSpan({ cls: "internal-embed" });
    const image = embed.createEl("img", { attr: { src: "photo.png" } });
    const data = test.transfer("![[photo.png]]");
    image.dispatchEvent(test.event("dragstart", data));
    expect(data.getData("application/x-arbor-card-move")).toBe("");
    expect(test.card().classList.contains("is-drag-source")).toBe(false);
  });
  it.each(["editor", "overview"] as const)("embeds a native vault image into a new child in %s without duplicating its file", async mode => {
    const test = await ingestionHarness(mode);
    test.app.renderMarkdown = (_markdown, target) => { target.createEl("img", { attr: { src: "image.png" } }); };
    const file = test.addFile("Photos/Existing.png");
    test.app.dragManager.draggable = { type: "file", file, title: "Existing.png" };
    test.card().dispatchEvent(test.event("dragover"));
    test.root.querySelector<HTMLElement>("[data-new-block-kind=child]")!.dispatchEvent(test.event("drop"));
    await test.settle();
    const created = test.view.documentController.getState()!.metadata.blocks.find(block => block.parentId === "first" && block.id !== "leaf");
    expect(created?.content).toBe("![[Photos/Existing.png]]");
    expect(test.content(created!.id)).toBe(created!.content);
    expect(test.attachments).toEqual([]);
    expect(test.content()).toBe("First");
    expect(test.writes).toHaveLength(1);
    await test.render();
    expect(test.card(created!.id).querySelector("img")).not.toBeNull();
    expect(test.card(created!.id).textContent).not.toContain("[embed:");
  });

  it.each((["editor", "overview"] as const).flatMap(mode => (["sibling", "child"] as const).map(kind => ({ mode, kind }))))(
    "saves a dropped image as an attachment and embeds it in a new $kind in $mode", async ({ mode, kind }) => {
      const test = await ingestionHarness(mode);
      const data = imageTransfer(test);
      const over = test.event("dragover", data);
      test.card().dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
      const zone = test.root.querySelector<HTMLElement>(`[data-new-block-kind=${kind}]`);
      expect(zone, "image drag exposes new-block targets").not.toBeNull();
      zone!.dispatchEvent(test.event("drop", data));
      await test.settle();
      const state = test.view.documentController.getState()!;
      const created = state.metadata.blocks.find(block => block.content === "![[photo.png]]");
      expect(created?.parentId).toBe(kind === "child" ? "first" : "root");
      expect(test.content(created!.id)).toBe("![[photo.png]]");
      expect(test.attachments).toEqual(["photo.png"]);
      expect(test.writes).toHaveLength(1);
      expect(test.content()).toBe("First");
      await test.view.documentController.undo();
      expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(4);
      // Undo never deletes an attachment which may have been referenced elsewhere.
      expect(test.attachments).toEqual(["photo.png"]);
      await test.view.documentController.redo();
      expect(test.content(created!.id)).toBe("![[photo.png]]");
    });

  it.each(["editor", "overview"] as const)("appends an image to a rendered %s card", async mode => {
    const test = await ingestionHarness(mode);
    test.card().dispatchEvent(test.event("drop", imageTransfer(test)));
    await test.settle();
    expect(test.content()).toBe("First\n\n![[photo.png]]");
    expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(4);
    expect(test.attachments).toEqual(["photo.png"]);
    expect(test.writes).toHaveLength(1);
  });

  it("offers image targets during protected file hover even before the file objects are exposed", async () => {
    const test = await ingestionHarness();
    const hover = test.transfer("");
    hover.types.push("Files");
    hover.items.push({ kind: "file", type: "", getAsFile: () => null } as DataTransferItem);
    test.card().dispatchEvent(test.event("dragover", hover));
    const zone = test.root.querySelector<HTMLElement>("[data-new-block-kind=sibling]");
    expect(zone).not.toBeNull();
    zone!.dispatchEvent(test.event("drop", imageTransfer(test, "Camera.PNG", "")));
    await test.settle();
    expect(test.attachments).toEqual(["Camera.PNG"]);
    expect(test.view.documentController.getState()!.metadata.blocks.some(b => b.content === "![[Camera.PNG]]")).toBe(true);
  });

  it("ignores a mixed image/non-image file drop rather than importing filenames or partial files", async () => {
    const test = await ingestionHarness();
    const data = imageTransfer(test);
    data.files.push(new test.win.File(["document"], "file.pdf", { type: "application/pdf" }));
    test.card().dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.attachments).toEqual([]);
    expect(test.writes).toEqual([]);
    expect(test.content()).toBe("First");
  });

  it("creates one block for multiple images and retries a note-save failure without saving attachments twice", async () => {
    const test = await ingestionHarness();
    const data = imageTransfer(test, "one.png");
    data.files.push(new test.win.File(["second"], "two.webp", { type: "image/webp" }));
    test.app.vault.process = async () => { throw Error("disk full"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    test.card().dispatchEvent(test.event("dragover", data));
    const zone = test.root.querySelector<HTMLElement>("[data-new-block-kind=child]");
    expect(zone).not.toBeNull();
    zone!.dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.attachments).toEqual(["one.png", "two.webp"]);
    expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(4);
    const retained = test.view.ingestion.getRetained()[0];
    expect(retained?.markdown).toBe("![[one.png]]\n\n![[two.webp]]");
    test.app.vault.process = async (_file, transform) => { const raw = transform(await test.app.vault.read()); test.writes.push(raw); return raw; };
    expect((await test.view.ingestion.retry(retained.id)).kind).toBe("created");
    expect(test.attachments).toEqual(["one.png", "two.webp"]);
    expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(5);
  });

  it("creates no block after an attachment write fails and retains it for retry", async () => {
    const test = await ingestionHarness();
    test.app.vault.createBinary = async () => { throw Error("attachment denied"); };
    const data = imageTransfer(test);
    test.card().dispatchEvent(test.event("dragover", data));
    const zone = test.root.querySelector<HTMLElement>("[data-new-block-kind=sibling]");
    expect(zone).not.toBeNull();
    zone!.dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.view.documentController.getState()!.metadata.blocks).toHaveLength(4);
    expect(test.writes).toEqual([]);
    expect(test.view.ingestion.getRetained()[0]).toMatchObject({ markdown: null });
  });

  it("keeps a partially saved batch cached when retrying the remaining image", async () => {
    const test = await ingestionHarness();
    let failSecond = true;
    test.app.vault.createBinary = async path => {
      if (path === "two.webp" && failSecond) throw Error("temporary failure");
      test.attachments.push(path);
      return test.addFile(path);
    };
    const data = imageTransfer(test, "one.png");
    data.files.push(new test.win.File(["two"], "two.webp", { type: "image/webp" }));
    test.card().dispatchEvent(test.event("dragover", data));
    test.root.querySelector<HTMLElement>("[data-new-block-kind=child]")!.dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.attachments).toEqual(["one.png"]);
    expect(test.writes).toEqual([]);
    failSecond = false;
    expect((await test.view.ingestion.retry(test.view.ingestion.getRetained()[0].id)).kind).toBe("created");
    expect(test.attachments).toEqual(["one.png", "two.webp"]);
    expect(test.view.documentController.getState()!.metadata.blocks.find(b => b.content === "![[one.png]]\n\n![[two.webp]]")).toBeDefined();
  });

  it("keeps image Paste in a textarea on its existing attachment route", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    await test.render();
    const editor = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    editor.setSelectionRange(5, 5);
    const data = imageTransfer(test);
    data.items.push({ kind: "file", type: "image/png", getAsFile: () => data.files[0] } as DataTransferItem);
    editor.dispatchEvent(test.event("paste", data));
    await test.settle();
    expect(test.view.editor.getSession()?.value).toBe("First\n\n![[photo.png]]");
    expect(test.attachments).toEqual(["photo.png"]);
    expect(test.writes).toEqual([]);
  });

  it("does not start an attachment write after the captured file changes during binary reading", async () => {
    const test = await ingestionHarness();
    const pending = deferred<ArrayBuffer>();
    const started = deferred<void>();
    const data = imageTransfer(test);
    vi.spyOn(data.files[0], "arrayBuffer").mockImplementation(() => { started.resolve(); return pending.promise; });
    test.card().dispatchEvent(test.event("dragover", data));
    const zone = test.root.querySelector<HTMLElement>("[data-new-block-kind=child]");
    expect(zone).not.toBeNull();
    zone!.dispatchEvent(test.event("drop", data));
    // If routing is missing, fail immediately rather than waiting on a fake reader.
    await Promise.race([started.promise, test.settle().then(() => { throw Error("image reader not started"); })]);
    test.view.ingestion.cancelPending();
    pending.resolve(new ArrayBuffer(8));
    await test.settle();
    expect(test.attachments).toEqual([]);
    expect(test.writes).toEqual([]);
    expect(test.view.ingestion.getRetained()).toHaveLength(1);
  });
});
