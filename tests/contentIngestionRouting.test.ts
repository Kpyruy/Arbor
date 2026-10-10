import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";
import { deferred } from "./helpers/arborFixtures";
import type { App } from "obsidian";
import type { ArborView } from "../src/view/ArborView";
import { checkContentDropHost, checkTextareaPasteHost, checkTextareaPasteUndoHost } from "./host/contentIngestionChecks";

function hostFixture(test: Awaited<ReturnType<typeof ingestionHarness>>) {
  return {
    app: test.app as unknown as App,
    view: test.view as unknown as ArborView,
    file: test.view.file!,
    referenceFile: test.addFile("Book.pdf"),
    cleanup: async () => {}
  };
}

function delayDraftImport(
  test: Awaited<ReturnType<typeof ingestionHarness>>,
  textarea: HTMLTextAreaElement,
  reader: "clipboard" | "native"
) {
  const pending = deferred<string>();
  const started = deferred<void>();
  const read = () => { started.resolve(); return pending.promise; };
  if (reader === "clipboard") test.clipboard.readText = read;
  else test.app.dragManager.draggable = { getText: read };
  let completion = Promise.resolve();
  if (reader === "clipboard") completion = test.view.pasteContentIntoCard("first");
  else textarea.dispatchEvent(test.event("drop"));
  return { pending, started, completion };
}

const draftReaders = (["editor", "overview"] as const).flatMap(mode =>
  (["clipboard", "native"] as const).map(reader => ({ mode, reader })));

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("content ingestion through production view/controller DOM routes", () => {
  it("returns persisted Markdown evidence from the callable host drop check", async () => {
    const test = await ingestionHarness();
    const receipt = await checkContentDropHost(hostFixture(test), "first", "host quote");
    expect(receipt.blockMarkdown).toBe("First\n\nhost quote");
    expect(receipt.persistedMarkdown).toBe(await test.app.vault.read());
    expect(receipt.filePath).toBe("Receiver.md");
    expect(receipt.route).toBe("synthetic-text");
    expect(test.writes).toHaveLength(1);
  });

  it("drops on the active Overview card when a hidden editor card remains in the DOM", async () => {
    const test = await ingestionHarness("editor");
    const shell = (test.view as unknown as { shell: { showMode(mode: "editor" | "overview"): void } }).shell;
    test.view.presentationMode = "overview";
    shell.showMode("overview");
    await test.view.overview.syncTreeOverview();

    const editorCard = test.root.querySelector<HTMLElement>(".arbor-card[data-block-id='first']");
    const overviewCard = test.root.querySelector<HTMLElement>(".arbor-overview-card[data-block-id='first']");
    expect(editorCard).not.toBeNull();
    expect(overviewCard).not.toBeNull();
    expect(test.root.querySelector(".arbor-columns-stage")?.getAttribute("style")).toContain("display: none");

    const receipt = await checkContentDropHost(hostFixture(test), "first", "overview quote");

    expect(receipt.blockMarkdown).toBe("First\n\noverview quote");
    expect(test.content()).toBe("First\n\noverview quote");
    expect(test.content("second")).toBe("Second");
    expect(test.writes).toHaveLength(1);
  });

  it.each(["editor", "overview"] as const)("checks desktop textarea draft insertion and ordinary Enter save in %s through the host helper", async mode => {
    const test = await ingestionHarness(mode);
    const shell = (test.view as unknown as { shell: { usesTouchControls(): boolean; applyViewClasses(root: HTMLElement): void } }).shell;
    vi.spyOn(shell, "usesTouchControls").mockReturnValue(false);
    shell.applyViewClasses(test.root);
    let rendered = Promise.resolve();
    test.view.render = () => { rendered = test.render(); };
    const keys: KeyboardEvent[] = [];
    test.root.addEventListener("keydown", event => { keys.push(event); }, true);
    const receipt = await checkTextareaPasteHost(hostFixture(test));
    await rendered;
    expect(receipt.blockMarkdown).toBe("AquoteC");
    expect(receipt.persistedMarkdown).toBe(await test.app.vault.read());
    expect(receipt.route).toBe("textarea-paste");
    expect(test.writes).toHaveLength(1);
    expect(test.view.editor.getSession()).toBeNull();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ key: "Enter", code: "Enter", ctrlKey: false });
  });

  it("explicitly cannot verify native Undo without an owner-document history API", async () => {
    const test = await ingestionHarness();
    Object.defineProperty(test.root.ownerDocument, "execCommand", { configurable: true, value: undefined });
    await expect(checkTextareaPasteUndoHost(hostFixture(test))).rejects.toThrow("Cannot verify native Undo");
    expect(test.writes).toEqual([]);
  });

  it.each(["editor", "overview"] as const)("uses the owner-document native insertion route once in %s", async mode => {
    const test = await ingestionHarness(mode);
    test.view.editor.beginEditingBlock("first", mode === "overview" ? "overview" : "card");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    const focus = vi.spyOn(textarea, "focus");
    const input = vi.fn();
    textarea.addEventListener("input", input);
    const insert = vi.fn((command: string, showUi: boolean, text: string) => {
      expect([command, showUi, text]).toEqual(["insertText", false, "quote"]);
      expect(textarea.ownerDocument.activeElement).toBe(textarea);
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 2]);
      textarea.setRangeText(text, 1, 2, "end");
      textarea.dispatchEvent(new test.win.Event("input", { bubbles: true }));
      return true;
    });
    Object.defineProperty(textarea.ownerDocument, "execCommand", { configurable: true, value: insert });
    textarea.dispatchEvent(test.event("paste"));
    await test.settle();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(input).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(textarea.value).toBe("AquoteC");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 6]);
    expect(test.view.editor.getSession()?.value).toBe("AquoteC");
    expect(test.writes).toEqual([]);
  });

  it.each(["absent", "declined", "throws", "silent-insert", "changed-then-throws"] as const)("keeps one input-updated draft with a %s native insertion API", async behavior => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    const input = vi.fn();
    textarea.addEventListener("input", input);
    const insert = behavior === "absent" ? undefined : vi.fn(() => {
      if (behavior === "silent-insert" || behavior === "changed-then-throws") textarea.setRangeText("quote", 1, 2, "end");
      if (behavior === "throws" || behavior === "changed-then-throws") throw Error("Native API failed");
      return false;
    });
    Object.defineProperty(textarea.ownerDocument, "execCommand", { configurable: true, value: insert });
    textarea.dispatchEvent(test.event("paste"));
    await test.settle();
    expect(textarea.value).toBe("AquoteC");
    expect(test.view.editor.getSession()?.value).toBe("AquoteC");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 6]);
    expect(input).toHaveBeenCalledTimes(1);
    if (insert) expect(insert).toHaveBeenCalledTimes(1);
    expect(test.writes).toEqual([]);
  });

  it("positions the caret from the normalized text inserted at the production receiver", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    Object.defineProperty(textarea.ownerDocument, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, text: string) => {
        textarea.setRangeText(text.replace(/\r\n/g, "\n"), 1, 2, "end");
        textarea.dispatchEvent(new test.win.Event("input", { bubbles: true }));
        return true;
      }
    });

    textarea.dispatchEvent(test.event("paste", test.transfer("x\r\ny")));
    await test.settle();

    expect(textarea.value).toBe("Ax\nyC");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 4]);
    expect(test.view.editor.getSession()?.value).toBe("Ax\nyC");
    expect(test.writes).toEqual([]);
  });

  it.each(["returns", "throws-after-input"] as const)("keeps one native input notification for same-value insertion when the API %s", async behavior => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    const input = vi.fn();
    textarea.addEventListener("input", input);
    Object.defineProperty(textarea.ownerDocument, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, text: string) => {
        textarea.setRangeText(text, 1, 2, "end");
        textarea.dispatchEvent(new test.win.Event("input", { bubbles: true }));
        if (behavior === "throws-after-input") throw Error("Native API failed after insertion");
        return true;
      }
    });

    textarea.dispatchEvent(test.event("paste", test.transfer("B")));
    await test.settle();

    expect(textarea.value).toBe("ABC");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 2]);
    expect(test.view.editor.getSession()?.value).toBe("ABC");
    expect(input).toHaveBeenCalledTimes(1);
    expect(test.writes).toEqual([]);
  });

  it.each(["editor", "overview"] as const)("claims one nested-link bubbling drop in %s", async mode => {
    const test = await ingestionHarness(mode);
    const drop = test.event("drop");
    test.card().querySelector("a")!.dispatchEvent(drop);
    await test.settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(test.content()).toBe("First\n\nquote");
    expect(test.writes).toHaveLength(1);
    expect(test.content("second")).toBe("Second");
  });

  it.each(["horizontal", "vertical-top-down", "vertical-bottom-up"] as const)("highlights without rerender or appearance changes in %s", async orientation => {
    const test = await ingestionHarness("overview", orientation);
    const card = test.card();
    const classes = card.className;
    const style = card.getAttribute("style");
    const renderCount = test.renderRequests();
    test.app.dragManager.draggable = { getText: () => { throw Error("must not read on hover"); } };
    const hover = test.event("dragover");
    card.querySelector("a")!.dispatchEvent(hover);
    expect(hover.defaultPrevented).toBe(true);
    expect(card.classList.contains("is-content-drop-target")).toBe(true);
    expect(card.getAttribute("style")).toBe(style);
    expect(test.renderRequests()).toBe(renderCount);
    card.dispatchEvent(test.event("dragleave"));
    expect(card.className).toBe(classes);
    expect(test.writes).toEqual([]);
  });

  it("inserts a textarea selection through input without saving", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    textarea.dispatchEvent(test.event("drop"));
    await test.settle();
    expect(textarea.value).toBe("AquoteC");
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(6);
    expect(test.view.editor.getSession()!.value).toBe("AquoteC");
    expect(test.writes).toEqual([]);
  });

  it("retains the captured paste caret when the pending Overview in-place focus frame runs", async () => {
    const test = await ingestionHarness("overview");
    const frames: Array<() => void> = [];
    const work = (test.view.overview as unknown as { work: { frame: (owner: Window, callback: () => void) => void } }).work;
    work.frame = (_owner, callback) => { frames.push(callback); };
    test.view.editor.beginEditingBlock("first", "overview");
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.value = "ABC";
    textarea.dispatchEvent(new test.win.Event("input", { bubbles: true }));
    textarea.setSelectionRange(1, 2);
    textarea.dispatchEvent(test.event("paste", test.transfer("quote")));
    await test.settle();
    expect(textarea.value).toBe("AquoteC");
    expect(textarea.selectionStart).toBe(6);
    expect(test.view.editor.getSession()?.value).toBe("AquoteC");
    expect(test.view.editor.getSession()?.autofocus).toBe(false);
    expect(test.writes).toEqual([]);
    expect(frames).toHaveLength(1);
    frames.forEach(callback => callback());
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(6);
  });

  it("imports ID-looking plain text with movement disabled", async () => {
    const test = await ingestionHarness();
    test.settings.dragAndDrop = false;
    test.card().dispatchEvent(test.event("drop", test.transfer("first")));
    await test.settle();
    expect(test.content()).toBe("First\n\nfirst");
    expect(test.writes).toHaveLength(1);
  });

  it("uses native generated Markdown once instead of its lossy title", async () => {
    const test = await ingestionHarness();
    const calls: string[] = [];
    const native = { getText(destination: string) { calls.push(destination); return "> Exact quote\n\n[[Book.pdf#page=7|source]]"; } };
    test.app.dragManager.draggable = native;
    test.card().querySelector("a")!.dispatchEvent(test.event("drop", test.transfer("lossy title")));
    test.app.dragManager.draggable = null;
    await test.settle();
    expect(calls).toEqual(["Receiver.md"]);
    expect(test.content()).toBe("First\n\n> Exact quote\n\n[[Book.pdf#page=7|source]]");
    expect(test.writes).toHaveLength(1);
  });

  it.each(["error", "empty", "managed"])("does not insert a native %s result's browser title", async result => {
    const test = await ingestionHarness();
    test.app.dragManager.draggable = { getText() { if (result === "error") throw Error("provider failed"); return result === "empty" ? "" : "%% arbor:structure"; } };
    test.card().dispatchEvent(test.event("drop", test.transfer("lossy title")));
    await test.settle();
    expect(test.content()).toBe("First");
    expect(test.writes).toEqual([]);
    if (result === "error") expect(test.view.ingestion.getRetained()[0].target.blockId).toBe("first");
  });

  it("generates a validated core file reference with alias and subpath", async () => {
    const test = await ingestionHarness("overview");
    test.app.dragManager.draggable = { type: "link", file: test.addFile("Book.pdf"), linktext: "Book.pdf#page=7|source", sourcePath: "Other.md" };
    test.card().dispatchEvent(test.event("drop", test.transfer("title")));
    await test.settle();
    expect(test.content()).toBe("First\n\n[[Book.pdf#page=7|source]]");
  });

  it.each(["background", "toolbar", "output", "html", "files"])("never writes unsupported %s content", async target => {
    const test = await ingestionHarness();
    const data = test.transfer("unsupported", target === "html" ? "text/html" : "text/plain");
    if (target === "files") data.files.push(new test.win.File(["binary"], "unknown.bin"));
    if (target === "output") test.view.openOutputPreview();
    const element = target === "background" ? test.root : target === "toolbar" ? test.root.querySelector("button")! : test.card();
    element.dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.writes).toEqual([]);
    expect(test.content()).toBe("First");
  });

  it("leaves actual editor selection drags to the browser but accepts rendered links from the same file", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(0, 2);
    const data = test.transfer("Fi");
    const start = test.event("dragstart", data);
    textarea.dispatchEvent(start);
    const drop = test.event("drop", data);
    textarea.dispatchEvent(drop);
    await test.settle();
    expect(start.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(textarea.value).toBe("First");
    expect(test.writes).toEqual([]);
    textarea.dispatchEvent(test.event("dragend", data));
    test.view.editor.cancelEditingSession();
    await test.render();
    test.app.dragManager.draggable = { type: "text", sourcePath: "Receiver.md", getText: () => "[[Receiver#Heading]]" };
    test.card("second").querySelector("a")!.dispatchEvent(test.event("drop", test.transfer("Heading")));
    await test.settle();
    expect(test.content("second")).toBe("Second\n\n[[Receiver#Heading]]");
  });

  it("keeps image drop on the attachment handler and updates only the draft", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    const data = test.transfer("lossy title");
    const image = new test.win.File(["png"], "picture.png", { type: "image/png" });
    data.files.push(image);
    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.attachments).toEqual(["picture.png"]);
    expect(test.view.editor.getSession()?.value).toBe("First\n\n![[picture.png]]");
    expect(test.writes).toEqual([]);
  });

  it("keeps normal text paste in the shared caret receiver", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(0, 5);
    textarea.dispatchEvent(test.event("paste", test.transfer("paste")));
    await test.settle();
    expect(textarea.value).toBe("paste");
    expect(test.view.editor.getSession()?.value).toBe("paste");
    expect(test.writes).toEqual([]);
  });

  it("suspends clipboard-menu blur save, freezes the explicit target, and preserves selection changes", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    const pending = deferred<string>();
    test.clipboard.readText = () => pending.promise;
    const menu = test.view.buildBlockMenu("first");
    const item = menu.items.find(item => item.title === "Paste content into card");
    expect(item).toBeDefined();
    item!.action();
    textarea.dispatchEvent(new test.win.Event("blur"));
    test.view.documentController.setSelection("second");
    await test.settle();
    expect(test.writes).toEqual([]);
    pending.resolve("quote");
    await test.settle();
    expect(test.view.editor.getSession()?.value).toBe("AquoteC");
    expect(test.view.documentController.getState()?.selectedBlockId).toBe("second");
    expect(test.writes).toEqual([]);
  });

  it.each(draftReaders.flatMap(entry => (["before", "inside"] as const).map(mutation => ({ ...entry, mutation }))))(
    "retains delayed $reader content in $mode when text changes $mutation the frozen selection, including Retry",
    async ({ mode, reader, mutation }) => {
      const test = await ingestionHarness(mode);
      test.view.editor.beginEditingBlock("first", mode === "overview" ? "overview" : "card");
      test.view.editor.getSession()!.value = "ABC";
      await test.render();
      const disk = await test.app.vault.read();
      const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
      textarea.setSelectionRange(1, 2);
      const receiving = delayDraftImport(test, textarea, reader);
      await receiving.started.promise;
      textarea.setRangeText("X", mutation === "before" ? 0 : 1, mutation === "before" ? 0 : 2, "end");
      textarea.dispatchEvent(new test.win.Event("input", { bubbles: true }));
      textarea.setSelectionRange(2, 3, "backward");
      const focus = vi.spyOn(textarea, "focus");
      const value = textarea.value;

      receiving.pending.resolve("quote");
      await receiving.completion;
      await test.settle();

      expect(textarea.value).toBe(value);
      expect(test.view.editor.getSession()?.value).toBe(value);
      expect([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection]).toEqual([2, 3, "backward"]);
      expect(focus).not.toHaveBeenCalled();
      const [retained] = test.view.ingestion.getRetained();
      expect(retained).toMatchObject({ markdown: "quote", target: { blockId: "first", selectionStart: 1, selectionEnd: 2 } });
      expect(retained.reason).toMatch(/draft changed.*range is stale/i);
      expect(retained.reason).toMatch(/copy.*paste.*explicitly/i);
      expect(await test.view.ingestion.retry(retained.id)).toEqual({ kind: "retained", id: retained.id });
      expect(test.view.ingestion.getRetained()).toHaveLength(1);
      expect(textarea.value).toBe(value);
      expect([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection]).toEqual([2, 3, "backward"]);
      expect(focus).not.toHaveBeenCalled();
      expect(await test.app.vault.read()).toBe(disk);
      expect(test.writes).toEqual([]);
    }
  );

  it.each(draftReaders)("checks the frozen draft again after focus reentrancy for delayed $reader in $mode", async ({ mode, reader }) => {
    const test = await ingestionHarness(mode);
    test.view.editor.beginEditingBlock("first", mode === "overview" ? "overview" : "card");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    const receiving = delayDraftImport(test, textarea, reader);
    await receiving.started.promise;
    textarea.blur();
    textarea.addEventListener("focus", () => {
      textarea.setRangeText("X", 0, 0, "end");
      textarea.dispatchEvent(new test.win.Event("input", { bubbles: true }));
      textarea.setSelectionRange(2, 3, "backward");
    }, { once: true });

    receiving.pending.resolve("quote");
    await receiving.completion;
    await test.settle();

    expect(textarea.value).toBe("XABC");
    expect(test.view.editor.getSession()?.value).toBe("XABC");
    expect([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection]).toEqual([2, 3, "backward"]);
    expect(test.view.ingestion.getRetained()).toHaveLength(1);
    expect(test.view.ingestion.getRetained()[0].reason).toMatch(/draft changed.*range is stale/i);
    expect(test.view.ingestion.getRetained()[0].markdown).toBe("quote");
    expect(test.writes).toEqual([]);
  });

  it.each(draftReaders)("keeps the original selection after caret-only movement during delayed $reader in $mode", async ({ mode, reader }) => {
    const test = await ingestionHarness(mode);
    test.view.editor.beginEditingBlock("first", mode === "overview" ? "overview" : "card");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    const receiving = delayDraftImport(test, textarea, reader);
    await receiving.started.promise;
    textarea.setSelectionRange(3, 3);

    receiving.pending.resolve("quote");
    await receiving.completion;
    await test.settle();

    expect(textarea.value).toBe("AquoteC");
    expect(test.view.editor.getSession()?.value).toBe("AquoteC");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 6]);
    expect(test.view.ingestion.getRetained()).toEqual([]);
    expect(test.writes).toEqual([]);
  });

  it.each(draftReaders.flatMap(entry => (["first", "second"] as const).map(winner => ({ ...entry, winner }))))(
    "retains the other overlapping $reader import in $mode when $winner resolves first",
    async ({ mode, reader, winner }) => {
      const test = await ingestionHarness(mode);
      test.view.editor.beginEditingBlock("first", mode === "overview" ? "overview" : "card");
      test.view.editor.getSession()!.value = "ABC";
      await test.render();
      const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
      textarea.setSelectionRange(1, 2);
      const first = delayDraftImport(test, textarea, reader);
      await first.started.promise;
      textarea.setSelectionRange(0, 1);
      const second = delayDraftImport(test, textarea, reader);
      await second.started.promise;
      const accepted = winner === "first" ? first : second;
      const stale = winner === "first" ? second : first;
      accepted.pending.resolve("quote");
      await accepted.completion;
      await test.settle();
      const value = textarea.value;
      const caret = [textarea.selectionStart, textarea.selectionEnd];

      stale.pending.resolve("other");
      await stale.completion;
      await test.settle();

      expect(value).toBe(winner === "first" ? "AquoteC" : "quoteBC");
      expect(textarea.value).toBe(value);
      expect(test.view.editor.getSession()?.value).toBe(value);
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual(caret);
      const [retained] = test.view.ingestion.getRetained();
      expect(retained.markdown).toBe("other");
      expect(retained.reason).toMatch(/draft changed.*range is stale/i);
      expect(await test.view.ingestion.retry(retained.id)).toEqual({ kind: "retained", id: retained.id });
      expect(textarea.value).toBe(value);
      expect(test.writes).toEqual([]);
    }
  );

  it.each(["editor", "overview"] as const)("explains the stale range and keeps exact content available for Copy in %s", async mode => {
    const test = await ingestionHarness(mode);
    test.view.editor.beginEditingBlock("first", mode === "overview" ? "overview" : "card");
    test.view.editor.getSession()!.value = "ABC";
    await test.render();
    const textarea = test.card().querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.setSelectionRange(1, 2);
    const receiving = delayDraftImport(test, textarea, "clipboard");
    await receiving.started.promise;
    textarea.setRangeText("X", 0, 0, "end");
    textarea.dispatchEvent(new test.win.Event("input", { bubbles: true }));
    receiving.pending.resolve("**exact quote**\n\n[[Book#Heading|source]]");
    await receiving.completion;
    await test.settle();
    test.view.buildBlockMenu("first").items.find(item => item.title === "Recover incoming content")!.action();
    expect(test.root.textContent).toMatch(/draft changed.*range is stale/i);
    const buttons = Array.from(test.root.querySelectorAll("button"));
    buttons.find(button => button.textContent === "Copy")!.click();
    await test.settle();
    expect(test.links).toContain("**exact quote**\n\n[[Book#Heading|source]]");
    buttons.find(button => button.textContent === "Retry")!.click();
    await test.settle();
    expect(textarea.value).toBe("XABC");
    expect(test.view.ingestion.getRetained()).toHaveLength(1);
    expect(test.writes).toEqual([]);
  });

  it("offers Paste only through the active Arbor command without converting Markdown", async () => {
    const test = await ingestionHarness();
    const command = test.commandPlugin.commands.find(command => command.id === "paste-content-into-card");
    expect(command?.checkCallback?.(true)).toBe(true);
    command!.checkCallback!(false);
    await test.settle();
    expect(test.content()).toBe("First\n\nclipboard");
    test.view.openOutputPreview();
    expect(command!.checkCallback!(true)).toBe(false);
    test.commandPlugin.app = { workspace: { getActiveViewOfType: () => null } };
    expect(command!.checkCallback!(false)).toBe(false);
    expect(test.writes).toHaveLength(1);
  });

  it("opens the original actual editor on denied Paste without replacing its dirty draft", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("first");
    test.view.editor.getSession()!.value = "dirty draft";
    await test.render();
    test.clipboard.readText = async () => { throw Error("denied"); };
    await test.view.pasteContentIntoCard("first");
    expect(test.view.editor.getSession()?.value).toBe("dirty draft");
    expect(test.win.document.activeElement).toBe(test.card().querySelector("textarea"));
    expect(test.writes).toEqual([]);
    expect(test.notices.some(message => message.includes("Use system Paste"))).toBe(true);
  });

  it("allows explicit Retry/Copy of retained incoming content only to its original target", async () => {
    const test = await ingestionHarness();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const processFile = test.app.vault.process;
    test.app.vault.process = async () => { throw Error("disk full"); };
    test.card().dispatchEvent(test.event("drop", test.transfer("exact recovery")));
    await test.settle();
    test.view.documentController.setSelection("second");
    const menu = test.view.buildBlockMenu("second");
    const recover = menu.items.find(item => item.title === "Recover incoming content");
    expect(recover).toBeDefined();
    recover!.action();
    const buttons = Array.from(test.root.querySelectorAll("button"));
    const copy = buttons.find(button => button.textContent === "Copy");
    const retry = buttons.find(button => button.textContent === "Retry");
    expect(copy).toBeDefined();
    copy!.click();
    await test.settle();
    expect(test.links).toContain("exact recovery");
    test.app.vault.process = processFile;
    expect(retry).toBeDefined();
    retry!.click();
    await test.settle();
    expect(test.content()).toBe("First\n\nexact recovery");
    expect(test.content("second")).toBe("Second");
    expect(test.view.ingestion.getRetained()).toEqual([]);
  });

  it("deduplicates one own-card movement before the column handler while unrelated drops preserve its session", async () => {
    const test = await ingestionHarness();
    const data = test.transfer("first");
    test.card().dispatchEvent(test.event("dragstart", data));
    test.root.querySelector(".arbor-card-list")!.dispatchEvent(test.event("drop", test.transfer("unknown", "text/html")));
    expect(test.writes).toEqual([]);
    test.card("second").dispatchEvent(test.event("dragover", data));
    test.card("second").dispatchEvent(test.event("drop", data));
    await test.settle();
    expect(test.writes).toHaveLength(1);
    expect(test.content()).toBe("First");
    expect(test.view.ingestion.getRetained()).toEqual([]);
  });

  it.each(["editor", "overview"] as const)("ignores an unverified Arbor move token instead of importing its block ID in %s", async mode => {
    const test = await ingestionHarness(mode);
    const data = test.transfer("first");
    data.types.push("application/x-arbor-card-move");
    data.setData("application/x-arbor-card-move", "another-view-session");
    const hover = test.event("dragover", data);
    test.card().dispatchEvent(hover);
    const drop = test.event("drop", data);
    test.card().dispatchEvent(drop);
    await test.settle();
    expect(hover.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(test.card().classList.contains("is-content-drop-target")).toBe(false);
    expect(test.content()).toBe("First");
    expect(test.writes).toEqual([]);
  });

  it("does not consume a same-view movement on a mismatched-token card drop", async () => {
    const test = await ingestionHarness();
    const own = test.transfer("first");
    test.card().dispatchEvent(test.event("dragstart", own));
    const foreign = test.transfer("first");
    foreign.types.push("application/x-arbor-card-move");
    foreign.setData("application/x-arbor-card-move", "another-view-session");
    test.card("second").dispatchEvent(test.event("drop", foreign));
    await test.settle();
    expect(test.writes).toEqual([]);
    test.card("second").dispatchEvent(test.event("dragover", own));
    test.card("second").dispatchEvent(test.event("drop", own));
    await test.settle();
    expect(test.writes).toHaveLength(1);
    expect(test.content("second")).toBe("Second");
  });

  it("leaves link activation native to the existing navigation controller", async () => {
    const test = await ingestionHarness();
    test.card().querySelector<HTMLAnchorElement>("a")!.click();
    await test.settle();
    expect(test.links).toEqual(["Book.pdf#page=7"]);
    expect(test.writes).toEqual([]);
  });

  it.each(["selection", "profile", "render"])("keeps a native read bound to its original load across %s changes", async change => {
    const test = await ingestionHarness();
    const pending = deferred<string>();
    const started = deferred<void>();
    test.app.dragManager.draggable = { getText() { started.resolve(); return pending.promise; } };
    test.card().dispatchEvent(test.event("drop"));
    await started.promise;
    if (change === "selection") test.view.documentController.setSelection("second");
    if (change === "profile") await test.view.documentController.applyActiveOutputProfile({ ...test.view.documentController.getState()!.outputState, activeProfileId: "draft" });
    if (change === "render") await test.render();
    pending.resolve("delayed quote");
    await test.settle();
    expect(test.content()).toBe("First\n\ndelayed quote");
    expect(test.content("second")).toBe("Second");
    expect(test.view.documentController.getState()!.metadata.blocks.find(block => block.id === "first")!.appearance).toEqual({ cardColor: "#123456", branchColor: "#abcdef" });
    expect(test.view.documentController.getState()!.outputState.profiles[0].rules).toEqual([{ blockId: "root", state: "exclude" }]);
  });

  it.each(["file", "reload", "mode", "close"])("retains pending native text without writing after %s cancellation", async change => {
    const test = await ingestionHarness();
    const pending = deferred<string>();
    const started = deferred<void>();
    test.app.dragManager.draggable = { getText() { started.resolve(); return pending.promise; } };
    test.card().dispatchEvent(test.event("drop"));
    await started.promise;
    if (change === "file") test.view.file = test.addFile("Other.md");
    if (change === "reload") test.view.documentController.replaceLoadedState(test.view.documentController.getState()!);
    if (change === "mode") { test.view.openTreeOverview(); await test.settle(); }
    if (change === "close") await test.view.onClose();
    pending.resolve("original payload");
    await test.settle();
    expect(test.writes).toEqual([]);
    expect(test.content()).toBe("First");
    expect(test.view.ingestion.getRetained()[0].markdown).toBe("original payload");
    expect(test.view.ingestion.getRetained()[0].target.filePath).toBe("Receiver.md");
  });

  it("waits for another dirty card to save before denied-Paste opens the target editor", async () => {
    const test = await ingestionHarness();
    test.view.editor.beginEditingBlock("second");
    test.view.editor.getSession()!.value = "dirty second";
    await test.render();
    const processFile = test.app.vault.process;
    const pendingSave = deferred<void>();
    const started = deferred<void>();
    test.app.vault.process = async (file, transform) => { started.resolve(); await pendingSave.promise; return processFile(file, transform); };
    test.clipboard.readText = async () => { throw Error("denied"); };
    const paste = test.view.pasteContentIntoCard("first");
    await started.promise;
    test.view.documentController.setSelection("second");
    expect(test.view.editor.getSession()?.blockId).toBe("second");
    expect(test.notices.some(message => message.includes("Use system Paste"))).toBe(false);
    pendingSave.resolve();
    await paste;
    const textarea = test.card().querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(test.win.document.activeElement).toBe(textarea);
    expect(test.view.editor.getSession()?.blockId).toBe("first");
    expect(test.content("second")).toBe("dirty second");
    expect(test.content()).toBe("First");
    expect(test.notices.some(message => message.includes("Use system Paste"))).toBe(true);
  });

  it("retains denied-Paste recovery when a different dirty card cannot save", async () => {
    const test = await ingestionHarness();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    test.view.editor.beginEditingBlock("second");
    test.view.editor.getSession()!.value = "dirty second";
    await test.render();
    test.app.vault.process = async () => { throw Error("disk full"); };
    test.clipboard.readText = async () => { throw Error("denied"); };
    await test.view.pasteContentIntoCard("first");
    expect(test.view.editor.getSession()?.value).toBe("dirty second");
    expect(test.notices.some(message => message.includes("Use system Paste"))).toBe(false);
    expect(test.view.ingestion.getRetained()[0].target.blockId).toBe("first");
    expect(test.writes).toEqual([]);
  });

  it("removes capture listeners and feedback with shell teardown, then binds only once", async () => {
    const test = await ingestionHarness("overview");
    const oldCard = test.card();
    oldCard.dispatchEvent(test.event("dragover"));
    expect(oldCard.classList.contains("is-content-drop-target")).toBe(true);
    test.view.teardownShell();
    expect(oldCard.classList.contains("is-content-drop-target")).toBe(false);
    test.root.append(oldCard);
    const drop = test.event("drop");
    oldCard.dispatchEvent(drop);
    await test.settle();
    expect(drop.defaultPrevented).toBe(false);
    expect(test.writes).toEqual([]);
    test.view.ensureShell();
    test.view.ensureShell();
    await test.render();
    test.card().dispatchEvent(test.event("drop"));
    await test.settle();
    expect(test.writes).toHaveLength(1);
  });
});
