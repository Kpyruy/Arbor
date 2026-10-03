import { describe, expect, it } from "vitest";
import { readHeadingLinker, collectLocalHeadingMatches, type HeadingProviderSnapshot } from "../src/view/navigation/LocalHeadingLinks";

function provider(settings: Record<string, unknown> = {}) {
  return {
    settings: { highlightInReading: true, scopeMode: "vault", excludeFolders: "", ...settings } as Record<string, unknown>,
    api: {
      getTerms: () => [
        { linktext: "Tree#Neural signal", path: "QA/Tree.md", label: "Neural signal", aliases: ["NS"] },
        { linktext: "Other#Neural signal", path: "Other.md", label: "Neural signal", aliases: [] }
      ],
      findMatches: () => [{ start: 0, end: 13, display: "neural signal", linktext: "Tree#Neural signal" }]
    }
  };
}

function snapshot(matches: unknown): HeadingProviderSnapshot {
  return { identity: {}, signature: "fixture", targets: new Set(["Tree#Neural signal", "Tree#Synapse"]), findMatches: () => matches };
}

describe("readHeadingLinker", () => {
  it("uses the actual public provider API and keeps only indexed same-file targets", () => {
    const result = readHeadingLinker(provider(), "QA/Tree.md", {});
    expect(result?.targets).toEqual(new Set(["Tree#Neural signal"]));
    expect(result?.findMatches("neural signal")).toEqual([{ start: 0, end: 13, display: "neural signal", linktext: "Tree#Neural signal" }]);
  });
  it.each([undefined, {}, { api: {} }, provider({ highlightInReading: false })])("ignores absent, incompatible or disabled providers: %j", (p) => {
    expect(readHeadingLinker(p, "QA/Tree.md", {})).toBeNull();
  });
  it.each([false, "false", "OFF", "no", "ignore", "disabled"])("respects per-note opt-out %s", (value) => {
    expect(readHeadingLinker(provider(), "QA/Tree.md", { "heading-linker": value })).toBeNull();
  });
  it("respects scope and exclusion boundaries without mistaking QA2 for QA", () => {
    const p = provider({ scopeMode: "folders", scopeFolders: "QA", excludeFolders: "QA/Hidden" });
    expect(readHeadingLinker(p, "QA/Tree.md", {})?.targets.has("Tree#Neural signal")).toBe(true);
    expect(readHeadingLinker(p, "QA2/Tree.md", {})).toBeNull();
    expect(readHeadingLinker(p, "QA/Hidden/Tree.md", {})).toBeNull();
    expect(readHeadingLinker(p, "QA/Hidden2/Tree.md", {})).not.toBeNull();
  });
  it("invalidates the snapshot signature when matching settings or aliases change", () => {
    const p = provider();
    const first = readHeadingLinker(p, "QA/Tree.md", {});
    p.settings.matchMode = "exact";
    expect(readHeadingLinker(p, "QA/Tree.md", {})?.signature).not.toBe(first?.signature);
  });
  it("does not break rendering when the third-party index throws", () => {
    const p = provider();
    p.api.getTerms = () => { throw new Error("unavailable"); };
    expect(readHeadingLinker(p, "QA/Tree.md", {})).toBeNull();
  });
});

describe("collectLocalHeadingMatches", () => {
  it("preserves text offsets and selects the unique local target even when it is an alternative", () => {
    expect(collectLocalHeadingMatches("neural signal", snapshot([
      { start: 0, end: 13, display: "neural signal", linktext: "Other#Neural signal", alts: ["Tree#Neural signal"] }
    ]))).toEqual([{ start: 0, end: 13, linktext: "Tree#Neural signal" }]);
  });
  it("skips non-local and ambiguous local terms rather than choosing a wrong card", () => {
    expect(collectLocalHeadingMatches("neural signal", snapshot([
      { start: 0, end: 13, linktext: "Other#Neural signal" },
      { start: 0, end: 13, linktext: "Tree#Neural signal", alts: ["Tree#Synapse"] }
    ]))).toEqual([]);
  });
  it("rejects invalid and overlapping provider offsets and mismatched visible text", () => {
    expect(collectLocalHeadingMatches("neural signal", snapshot([
      { start: -1, end: 4, linktext: "Tree#Neural signal" },
      { start: 0, end: 99, linktext: "Tree#Neural signal" },
      { start: 0, end: 0, linktext: "Tree#Neural signal" },
      { start: 0.5, end: 4, linktext: "Tree#Neural signal" },
      { start: 0, end: 13, display: "wrong text", linktext: "Tree#Neural signal" },
      { start: 0, end: 6, display: "neural", linktext: "Tree#Neural signal" },
      { start: 4, end: 13, linktext: "Tree#Synapse" }
    ]))).toEqual([{ start: 0, end: 6, linktext: "Tree#Neural signal" }]);
  });
  it("preserves UTF-16 Unicode offsets supplied by the provider", () => {
    expect(collectLocalHeadingMatches("☕ neural signal", snapshot([
      { start: 2, end: 15, display: "neural signal", linktext: "Tree#Neural signal" }
    ]))).toEqual([{ start: 2, end: 15, linktext: "Tree#Neural signal" }]);
  });
  it("treats a failed or malformed matcher as no decoration", () => {
    expect(collectLocalHeadingMatches("text", snapshot(null))).toEqual([]);
    const p = snapshot([]);
    p.findMatches = () => { throw new Error("matcher unavailable"); };
    expect(collectLocalHeadingMatches("text", p)).toEqual([]);
  });
});
