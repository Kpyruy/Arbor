import type { DecodeResult, IncomingContent, TransferSnapshot } from "./ingestionTypes";

const MAX_TEXT_LENGTH = 1_000_000;

function hasManagedControls(markdown: string): boolean {
  let fence: { character: string; length: number; quoteDepth: number; listIndent: number } | null = null;
  let listIndent = 0;
  let paragraphOpen = false;
  const outside: string[] = [];
  for (const line of markdown.split(/\r\n|\n|\r/)) {
    // Inspect fence delimiters inside Markdown containers without rewriting input.
    const quotePrefix = line.match(/^(?: {0,3}> ?)+/)?.[0] ?? "";
    const quoteDepth = (quotePrefix.match(/>/g) ?? []).length;
    const unquoted = line.slice(quotePrefix.length);
    const indentation = unquoted.match(/^ */)![0].length;
    // Retain paragraph boundaries, including blank lines inside quote/list containers.
    if (!unquoted.trim()) {
      paragraphOpen = false;
      outside.push("");
      continue;
    }
    if (fence && unquoted.trim() && (quoteDepth < fence.quoteDepth || indentation < fence.listIndent)) fence = null;
    const listPrefix = unquoted.match(/^ {0,3}(?:[-+*]|\d{1,9}[.)]) +/)?.[0];
    if (!fence) {
      if (listPrefix) listIndent = listPrefix.length;
      else if (unquoted.trim() && indentation < listIndent) listIndent = 0;
    }
    const codeLine = listPrefix ? unquoted.slice(listPrefix.length) : unquoted.slice(listIndent);
    const delimiter = codeLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
      paragraphOpen = false;
      outside.push("");
      continue;
    }
    if (delimiter && (delimiter[1][0] !== "`" || !delimiter[2].includes("`"))) {
      fence = { character: delimiter[1][0], length: delimiter[1].length, quoteDepth, listIndent };
      paragraphOpen = false;
      outside.push("");
      continue;
    }
    if (!paragraphOpen && /^(?: {4}|\t)/.test(codeLine)) {
      outside.push("");
      continue;
    }
    // ATX headings end their block without requiring a blank line before code.
    paragraphOpen = !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(codeLine);
    outside.push(line);
  }
  // Inline spans may cross soft line breaks, never blank paragraphs or excluded blocks.
  const visible = outside.join("\n").split(/(\n[ \t]*\n)/)
    .map((block) => block.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "")).join("");
  return /%%\s*arbor:(?:structure|output)\b/.test(visible)
    || /<!--\s*arbor:(?:metadata:v1|block:v1)\b/.test(visible)
    || /^\s*\^arbor-[\w-]+\s*$/m.test(visible);
}

/** Validate without rewriting source text, references, comments or line endings. */
export function validateIncoming(markdown: string, via: IncomingContent["via"]): DecodeResult {
  if (markdown.length > MAX_TEXT_LENGTH) return { kind: "reject", reason: "too-large" };
  if (markdown.includes("\0")) return { kind: "reject", reason: "nul" };
  if (!markdown.trim()) return { kind: "ignore", reason: "empty" };
  if (hasManagedControls(markdown)) return { kind: "reject", reason: "managed-document" };
  return { kind: "content", content: { markdown, via } };
}

/** Native reads happen separately; validateIncoming(nativeText, "native") has priority. */
export function decodeTransfer(snapshot: TransferSnapshot): DecodeResult {
  if (snapshot.ownArborDrag) return { kind: "ignore", reason: "internal" };
  if (snapshot.hasFiles) return { kind: "ignore", reason: "files" };
  if (snapshot.markdown) return validateIncoming(snapshot.markdown, "markdown");
  if (snapshot.plain) return validateIncoming(snapshot.plain, "plain");
  if (snapshot.uriList) {
    // Check the supplied payload before filtering, so comments cannot hide NUL/oversize input.
    if (snapshot.uriList.length > MAX_TEXT_LENGTH) return { kind: "reject", reason: "too-large" };
    if (snapshot.uriList.includes("\0")) return { kind: "reject", reason: "nul" };
    const markdown = snapshot.uriList.split(/\r\n|\n|\r/)
      .map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).join("\n");
    return validateIncoming(markdown, "uri-list");
  }
  return { kind: "ignore", reason: snapshot.types.length ? "unsupported" : "empty" };
}
