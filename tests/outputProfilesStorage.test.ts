import { describe, expect, it } from "vitest";
import { OUTPUT_MARKER } from "../src/constants";
import { buildOutputBlock, isDefaultOutputState, parseOutputBlock } from "../src/storage/outputProfiles";

describe("output profile metadata codec", () => {
  it("round-trips a readable output profile block in canonical rule order", () => {
    const raw = buildOutputBlock({
      version: 1,
      activeProfileId: "draft",
      profiles: [{
        id: "draft",
        name: "Draft",
        rules: [
          { blockId: "z", state: "include" },
          { blockId: "b", state: "exclude" }
        ]
      }]
    });

    expect(OUTPUT_MARKER).toBe("arbor:output");
    expect(raw).toContain("%% arbor:output");
    expect(raw).toContain('"arbor-plugin": "output"');
    expect(parseOutputBlock(raw)).toEqual({
      ok: true,
      state: {
        version: 1,
        activeProfileId: "draft",
        profiles: [{
          id: "draft",
          name: "Draft",
          rules: [
            { blockId: "b", state: "exclude" },
            { blockId: "z", state: "include" }
          ]
        }]
      }
    });
  });

  it("rejects malformed output metadata without throwing", () => {
    const valid = {
      "arbor-plugin": "output",
      version: 1,
      active: "draft",
      profiles: [{ id: "draft", name: "Draft", rules: [] }]
    };
    const raw = (value: unknown) => ["%% arbor:output", "```json", JSON.stringify(value), "```", "%%"].join("\n");

    for (const value of [
      {},
      { ...valid, unexpected: true },
      { ...valid, profiles: [{ id: "draft", name: "Draft", rules: [] }, { id: "draft", name: "Other", rules: [] }] },
      { ...valid, profiles: [{ id: "draft", name: "", rules: [] }] },
      { ...valid, profiles: [{ id: "draft", name: "Draft", rules: [{ blockId: "b", state: "hidden" }] }] },
      { ...valid, profiles: {} }
    ]) {
      const parsed = parseOutputBlock(raw(value));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.raw).toBe(raw(value));
        expect(parsed.error).toBeTruthy();
      }
    }

    expect(parseOutputBlock("%% arbor:output\n```json\n{}\n```\n%%").ok).toBe(false);
    expect(parseOutputBlock("%% arbor:output\n```json\n{\n```\n%%").ok).toBe(false);
  });

  it("recognizes only the clean full-tree state as default", () => {
    expect(isDefaultOutputState({ version: 1, activeProfileId: "full", profiles: [] })).toBe(true);
    expect(isDefaultOutputState({ version: 1, activeProfileId: "draft", profiles: [] })).toBe(false);
    expect(isDefaultOutputState({
      version: 1,
      activeProfileId: "full",
      profiles: [{ id: "draft", name: "Draft", rules: [] }]
    })).toBe(false);
  });
});
