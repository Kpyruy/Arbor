import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NativeDragReadError, ObsidianDragAdapter, getNativeDraggable } from "../src/view/ingestion/ObsidianDragAdapter";
import { validateIncoming } from "../src/view/ingestion/IncomingContent";
import { deferred } from "./helpers/arborFixtures";

// Synthetic host ports: the production caller must verify an actual vault TFile.
const pdf = { path: "Books/Medicine.pdf" };
function adapter(generateMarkdownLink: (file: typeof pdf, destination: string, subpath?: string, alias?: string) => string = vi.fn(() => "[[Books/Medicine.pdf]]")) {
  return new ObsidianDragAdapter({
    resolveFile: (value: unknown) => value === pdf ? pdf : null,
    generateMarkdownLink
  });
}

describe("optional Obsidian drag adapter", () => {
  it("replays a captured PDF++ annotation generator without substituting its plain title", async () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/ingestion/payloads.json", import.meta.url), "utf8")) as {
      nativeCaptures: Array<{ id: string; destinationPath: string; native: Record<string, unknown>; generatedMarkdown?: string }>;
    };
    const captured = fixture.nativeCaptures.find(entry => entry.id === "pdf-plus-annotation-native")!;
    const native = { ...captured.native, getText: () => captured.generatedMarkdown };
    const incoming = await adapter().read(native, captured.destinationPath);
    expect(incoming).toBe('> [!PDF|] [[Arbor annotated ingestion QA.pdf#page=1&annotation=7R|Arbor annotated ingestion QA, p.1]]\n> > A copied excerpt keeps its source reference\n> \n> ');
    expect(validateIncoming(incoming!, "native").kind).toBe("content");
  });
  it("feature-detects an absent or malformed manager without accepting arbitrary objects", () => {
    for (const manager of [undefined, null, {}, { draggable: null }]) expect(getNativeDraggable(manager)).toBeNull();
    const native = { getText: () => "Markdown" };
    expect(getNativeDraggable({ draggable: native })).toBe(native);
    for (const value of [null, "text", {}, { type: "folder", file: { path: "Books" } }, { type: "files", files: [pdf] }]) {
      expect(adapter().canRead(value)).toBe(false);
    }
  });

  it("does not invoke getText while probing hover and calls it once with its receiver and destination on read", async () => {
    const getText = vi.fn(function(this: { excerpt: string }, destination: string) {
      return `${this.excerpt}\n\n[[Books/Medicine.pdf#page=17&annotation=abc|${destination}]]`;
    });
    const native = { excerpt: "> Excerpt", getText };
    const reader = adapter();
    expect(reader.canRead(native)).toBe(true);
    expect(reader.canRead(native)).toBe(true);
    expect(getText).not.toHaveBeenCalled();
    expect(await reader.read(native, "Projects/Study.md")).toBe('> Excerpt\n\n[[Books/Medicine.pdf#page=17&annotation=abc|Projects/Study.md]]');
    expect(getText).toHaveBeenCalledExactlyOnceWith("Projects/Study.md");
    expect(getText.mock.contexts[0]).toBe(native);
  });

  it("awaits a late generator without using the core-file preview instead", async () => {
    const pending = deferred<string>();
    const generateMarkdownLink = vi.fn(() => "lossy preview");
    const result = adapter(generateMarkdownLink).read({ type: "file", file: pdf, getText: () => pending.promise }, "Projects/Study.md");
    pending.resolve('> Full excerpt\n\n[[Books/Medicine.pdf#page=17&selection=1,2,3,4&annotation=abc|Source]]');
    expect(await result).toBe('> Full excerpt\n\n[[Books/Medicine.pdf#page=17&selection=1,2,3,4&annotation=abc|Source]]');
    expect(generateMarkdownLink).not.toHaveBeenCalled();
  });

  it.each([() => { throw new Error("provider failed"); }, () => Promise.reject(new Error("provider failed")), () => 17, () => Promise.resolve(null)])("surfaces generator failure rather than returning unsupported or a lossy fallback", async (getText) => {
    const generateMarkdownLink = vi.fn(() => "lossy preview");
    await expect(adapter(generateMarkdownLink).read({ type: "file", file: pdf, getText }, "Projects/Study.md")).rejects.toBeInstanceOf(NativeDragReadError);
    expect(generateMarkdownLink).not.toHaveBeenCalled();
  });

  it("leaves empty native output for validation instead of falling back to plain text", async () => {
    expect(await adapter().read({ getText: () => "" }, "Projects/Study.md")).toBe("");
  });

  it("returns null only for unsupported native shapes, including fake files", async () => {
    expect(await adapter().read({ type: "folder", file: pdf }, "Projects/Study.md")).toBeNull();
    expect(await adapter().read({ type: "file", file: { path: pdf.path } }, "Projects/Study.md")).toBeNull();
  });

  it("generates a core-file reference using the destination and validated file", async () => {
    const generateMarkdownLink = vi.fn(() => "[[Books/Medicine.pdf]]");
    expect(await adapter(generateMarkdownLink).read({ type: "file", file: pdf }, "Projects/Study.md")).toBe("[[Books/Medicine.pdf]]");
    expect(generateMarkdownLink).toHaveBeenCalledExactlyOnceWith(pdf, "Projects/Study.md", undefined, undefined);
  });

  it.each([
    ["Books/Medicine.pdf#page=17&selection=1,2,3,4&annotation=abc|Source", "#page=17&selection=1,2,3,4&annotation=abc", "Source"],
    ["Books/Medicine.pdf#Heading", "#Heading", undefined],
    ["Books/Medicine.pdf#^block", "#^block", undefined]
  ])("keeps core-link subpaths and aliases from %s", async (linktext, subpath, alias) => {
    const generateMarkdownLink = vi.fn(() => "destination link");
    expect(await adapter(generateMarkdownLink).read({ type: "link", file: pdf, sourcePath: "Books/Source.md", linktext }, "Projects/Study.md")).toBe("destination link");
    expect(generateMarkdownLink).toHaveBeenCalledExactlyOnceWith(pdf, "Projects/Study.md", subpath, alias);
  });

  it("resolves a core link using its origin rather than its destination", async () => {
    const resolveLink = vi.fn(() => pdf);
    const generateMarkdownLink = vi.fn(() => "[[Books/Medicine.pdf#page=17|Source]]");
    const reader = new ObsidianDragAdapter({ resolveFile: () => null, resolveLink, generateMarkdownLink });
    expect(await reader.read({ type: "link", sourcePath: "Books/Source.md", linktext: "Medicine.pdf#page=17|Source" }, "Projects/Study.md")).toBe("[[Books/Medicine.pdf#page=17|Source]]");
    expect(resolveLink).toHaveBeenCalledExactlyOnceWith("Medicine.pdf", "Books/Source.md");
    expect(generateMarkdownLink).toHaveBeenCalledExactlyOnceWith(pdf, "Projects/Study.md", "#page=17", "Source");
  });

  it("does not silently discard unresolved native references or accept a malformed link as a bare file", async () => {
    expect(await adapter().read({ type: "link", file: pdf, linktext: 4 }, "Projects/Study.md")).toBeNull();
    const reader = new ObsidianDragAdapter({ resolveFile: () => null, resolveLink: () => null, generateMarkdownLink: () => "unexpected" });
    await expect(reader.read({ type: "link", sourcePath: "Books/Source.md", linktext: "Missing.pdf#page=1" }, "Projects/Study.md")).rejects.toBeInstanceOf(NativeDragReadError);
  });

  it("keeps the rendered alias supplied as a native core-link title", async () => {
    const reader = adapter((_file, _destination, subpath, alias) => `[[Books/Medicine.pdf${subpath}|${alias}]]`);
    expect(await reader.read({ type: "link", file: pdf, title: "Source alias", linktext: "Books/Medicine.pdf#page=1&annotation=7R", sourcePath: "Arbor ingestion QA/Link source.md" }, "Arbor ingestion QA/Receiver.md"))
      .toBe("[[Books/Medicine.pdf#page=1&annotation=7R|Source alias]]");
    expect(await reader.read({ type: "link", file: pdf, title: "Ignored title", linktext: "Books/Medicine.pdf#page=1|Explicit alias" }, "Arbor ingestion QA/Receiver.md"))
      .toBe("[[Books/Medicine.pdf#page=1|Explicit alias]]");
  });

  it("wraps public link-generator failures without returning unsupported", async () => {
    const reader = adapter(() => { throw new Error("link failed"); });
    await expect(reader.read({ type: "file", file: pdf }, "Projects/Study.md")).rejects.toBeInstanceOf(NativeDragReadError);
  });
});
