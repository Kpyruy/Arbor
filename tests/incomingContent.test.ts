import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeTransfer, validateIncoming } from "../src/view/ingestion/IncomingContent";
import type { TransferSnapshot } from "../src/view/ingestion/ingestionTypes";

const sample = (patch: Partial<TransferSnapshot> = {}): TransferSnapshot => ({
  types: [], markdown: "", plain: "", uriList: "", hasFiles: false,
  ownArborDrag: false, ...patch
});

describe("incoming content", () => {
  it("keeps PDF Markdown instead of its plain preview", () => {
    const markdown = '> Excerpt\n\n[[Books/Medicine.pdf#page=17&annotation=abc|Source]]';
    expect(decodeTransfer(sample({ markdown, plain: "Excerpt" }))).toEqual({
      kind: "content", content: { markdown, via: "markdown" }
    });
  });

  it("does not interpret own card movement as content", () => {
    expect(decodeTransfer(sample({ plain: "first", ownArborDrag: true }))).toEqual({ kind: "ignore", reason: "internal" });
  });

  it("leaves binary drops to the attachment handler", () => {
    expect(decodeTransfer(sample({ markdown: "Image", hasFiles: true }))).toEqual({ kind: "ignore", reason: "files" });
  });

  it("does not mistake an arbitrary block-looking ID or foreign MIME for an own move", () => {
    expect(decodeTransfer(sample({ plain: "first", types: ["application/x-arbor-block"] }))).toEqual({
      kind: "content", content: { markdown: "first", via: "plain" }
    });
  });

  it("preserves provider deep links as Markdown", () => {
    const markdown = '[Source](obsidian://book-note?file=Books%2FA.epub&id=mark-1)';
    expect(decodeTransfer(sample({ plain: markdown }))).toEqual({ kind: "content", content: { markdown, via: "plain" } });
  });

  it("uses plain before URI and never treats HTML as content", () => {
    expect(decodeTransfer(sample({ types: ["text/html"], plain: "<b>literal</b>", uriList: "https://example.org" }))).toEqual({
      kind: "content", content: { markdown: "<b>literal</b>", via: "plain" }
    });
    expect(decodeTransfer(sample({ types: ["text/html"] }))).toEqual({ kind: "ignore", reason: "unsupported" });
  });

  it("removes URI-list comments but preserves each supplied deep link", () => {
    expect(decodeTransfer(sample({ uriList: "# copied links\r\nhttps://example.org/a#part\r\n\r\nobsidian://book-note?file=A.epub&id=x\r\n" }))).toEqual({
      kind: "content", content: { markdown: "https://example.org/a#part\nobsidian://book-note?file=A.epub&id=x", via: "uri-list" }
    });
    expect(decodeTransfer(sample({ uriList: "# comment only" }))).toEqual({ kind: "ignore", reason: "empty" });
  });

  it.each(["", " \t\r\n"])("ignores empty or whitespace content %j", (plain) => {
    expect(decodeTransfer(sample({ plain }))).toEqual({ kind: "ignore", reason: "empty" });
  });

  it("preserves whitespace, line endings, relative links and ordinary comments without inventing references", () => {
    const markdown = "  > Quote\r\n\r\n[[../Topic#^block|alias]]\r\n<!-- normal comment -->\n";
    expect(validateIncoming(markdown, "native")).toEqual({ kind: "content", content: { markdown, via: "native" } });
  });

  it.each(["markdown", "plain", "uriList"] as const)("rejects NUL in %s instead of falling back", (field) => {
    expect(decodeTransfer(sample({ [field]: "source\0text", ...(field === "markdown" ? { plain: "preview" } : {}) }))).toEqual({ kind: "reject", reason: "nul" });
  });

  it("accepts exactly one million UTF-16 units and rejects the next unit", () => {
    expect(validateIncoming("😀".repeat(500_000), "plain").kind).toBe("content");
    expect(validateIncoming("😀".repeat(500_000) + "x", "plain")).toEqual({ kind: "reject", reason: "too-large" });
  });

  it.each([
    '%% arbor:structure\n```json\n{}\n```\n%%',
    '%% arbor:output\n```json\n{}\n```\n%%',
    '<!-- arbor:metadata:v1\nencoded\n-->',
    '<!-- arbor:metadata:v1:encoded -->',
    '<!--\n  arbor:metadata:v1:encoded -->',
    '%%\n arbor:structure\n```json\n{}\n```\n%%',
    '<!-- arbor:block:v1 id="a" parent="" order="0" -->',
    '^arbor-a'
  ])("rejects live managed control syntax %j", (plain) => {
    expect(decodeTransfer(sample({ plain }))).toEqual({ kind: "reject", reason: "managed-document" });
  });

  it.each([
    '```md\n<!-- arbor:block:v1 id="a" parent="" order="0" -->\n%% arbor:structure\n```',
    '~~~~md\n%% arbor:output\n~~~\n<!-- arbor:metadata:v1 -->\n~~~~',
    '````md\n```json\n%% arbor:structure\n```\n````',
    'Example: `<!-- arbor:block:v1 id="a" -->` and `%% arbor:output`.',
    '    <!-- arbor:block:v1 id="a" parent="" order="0" -->',
    '> ```md\n> %% arbor:output\n> ```',
    'Example: `code\n%% arbor:output\ncode`.',
    '- Example:\n  ```md\n  %% arbor:output\n  ```',
    '<!-- explanation about arbor:structure -->\nOrdinary arbor:block:v1 prose.'
  ])("preserves comments and code examples %j", (markdown) => {
    expect(validateIncoming(markdown, "markdown")).toEqual({ kind: "content", content: { markdown, via: "markdown" } });
  });

  it("preserves multiline inline code across an indented paragraph continuation", () => {
    const markdown = 'Example: `code\n    continuation\n%% arbor:output\ncode`.';
    expect(validateIncoming(markdown, "markdown")).toEqual({ kind: "content", content: { markdown, via: "markdown" } });
  });

  it("rejects an unprotected control in an indented continuation of ordinary prose", () => {
    expect(validateIncoming('Ordinary prose\n    %% arbor:output', "markdown")).toEqual({ kind: "reject", reason: "managed-document" });
  });

  it("preserves an indented code block after a blank paragraph boundary", () => {
    const markdown = 'Ordinary prose\n\n    %% arbor:output';
    expect(validateIncoming(markdown, "markdown")).toEqual({ kind: "content", content: { markdown, via: "markdown" } });
  });

  it("preserves an indented code example immediately after an ATX heading", () => {
    const markdown = '# Heading\n    %% arbor:output';
    expect(validateIncoming(markdown, "markdown")).toEqual({ kind: "content", content: { markdown, via: "markdown" } });
  });

  it("still rejects an unprotected control in an ATX heading", () => {
    expect(validateIncoming('# %% arbor:output', "markdown")).toEqual({ kind: "reject", reason: "managed-document" });
  });

  it("does not let backticks in an indented code block hide a following live control", () => {
    expect(validateIncoming('    `Example\n    protected block\n%% arbor:output\nend`', "markdown")).toEqual({ kind: "reject", reason: "managed-document" });
  });

  it("rejects a real marker after a fenced example", () => {
    expect(validateIncoming('```md\n%% arbor:structure\n```\n%% arbor:output', "plain")).toEqual({ kind: "reject", reason: "managed-document" });
  });

  it.each([
    '`Example\n\n%% arbor:output\n\nend`',
    '`Example\n \t\n<!-- arbor:block:v1 id="a" parent="" order="0" -->\n\nend`',
    '`Example\n    \n%% arbor:structure\n\nend`',
    '> `Example\n> \n> %% arbor:output\n> \n> end`',
    '`Example\n```text\nprotected block\n```\n%% arbor:output\nend`',
    '`Example\n\n<!-- arbor:metadata:v1:encoded -->\n\nend`',
    '`Example\n\n^arbor-a\n\nend`'
  ])("does not let backticks cross blank paragraphs to hide live controls %j", (markdown) => {
    expect(validateIncoming(markdown, "markdown")).toEqual({ kind: "reject", reason: "managed-document" });
  });

  it.each([
    '> ```md\n> example\n%% arbor:output',
    '- ```md\n  example\n%% arbor:output'
  ])("does not let an ended Markdown container hide a live marker %j", markdown => {
    expect(validateIncoming(markdown, "plain")).toEqual({ kind: "reject", reason: "managed-document" });
  });

  it("round-trips source-derived, synthetic and captured-export fixture contracts", () => {
    const fixtures = JSON.parse(readFileSync(new URL("./fixtures/ingestion/payloads.json", import.meta.url), "utf8")) as {
      transfers: Array<{ snapshot: TransferSnapshot; expected: { markdown: string; via: string } }>;
    };
    for (const fixture of fixtures.transfers) {
      expect(decodeTransfer(fixture.snapshot)).toEqual({ kind: "content", content: fixture.expected });
    }
  });
});
