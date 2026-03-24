import { BranchBlock, BranchBlockId, BreadcrumbLabelFallbackMode } from "./types";

export function generateBlockId(): BranchBlockId {
  return `bw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

export function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sortBlocks(blocks: BranchBlock[]): BranchBlock[] {
  return [...blocks].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function ensureBlockAfter(after: string | undefined, fallback = "\n\n"): string {
  return after === undefined ? fallback : after;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSnippet(markdown: string, length: number): string {
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[\[([^\]]+)\]\]/g, "[embed: $1]")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[image: $1]")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^>\s*\[![^\]]+\]\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) {
    return "Empty block";
  }

  return stripped.length > length ? `${stripped.slice(0, Math.max(0, length - 3)).trimEnd()}...` : stripped;
}

export interface PathLabelOptions {
  preferredPrefix?: string;
  fallback?: BreadcrumbLabelFallbackMode;
  maxWords?: number;
  maxLength?: number;
}

function normalizeLabelLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)-]?\s+/, "")
    .trim();
}

function stripRepeatedPrefix(line: string, prefix: string): string {
  if (!prefix) {
    return line.trim();
  }

  let value = line.trimStart();
  while (value.startsWith(prefix)) {
    value = value.slice(prefix.length).trimStart();
  }

  return value.trim();
}

function trimPathLabel(label: string, maxWords: number, maxLength: number): string {
  const words = label.split(/\s+/).filter(Boolean).slice(0, maxWords);
  if (words.length === 0) {
    return "Empty block";
  }

  const compact = words.join(" ");
  return compact.length > maxLength
    ? `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
    : compact;
}

export function extractPathLabel(markdown: string, options: PathLabelOptions = {}): string {
  const maxWords = options.maxWords ?? 4;
  const maxLength = options.maxLength ?? 36;
  const preferredPrefix = options.preferredPrefix ?? "#";
  const fallback = options.fallback ?? "firstLine";
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => normalizeLabelLine(line))
    .filter((line) => line.length > 0);

  if (preferredPrefix) {
    const matchedLine = lines.find((line) => line.startsWith(preferredPrefix));
    if (matchedLine) {
      return trimPathLabel(stripRepeatedPrefix(matchedLine, preferredPrefix), maxWords, maxLength);
    }
  }

  if (fallback === "firstLine") {
    const firstLine = lines[0];
    if (firstLine) {
      return trimPathLabel(stripRepeatedPrefix(firstLine, preferredPrefix), maxWords, maxLength);
    }
  }

  if (fallback === "snippet") {
    const snippet = extractSnippet(markdown, Math.max(maxLength * 2, 48));
    return trimPathLabel(snippet, maxWords, maxLength);
  }

  return "Empty block";
}
