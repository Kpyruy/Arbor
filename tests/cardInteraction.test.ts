import { describe, expect, it } from "vitest";
import { resolveBranchCardInteraction } from "../src/cardInteraction";

describe("branch editor card interaction", () => {
  it("keeps a one-click selection separate from opening the editor", () => {
    const cardTarget = { closest: () => null } as unknown as EventTarget;

    expect(resolveBranchCardInteraction({ target: cardTarget, isActive: false, clickCount: 1 })).toEqual({
      select: true,
      edit: false,
      preserveDefault: false
    });
    expect(resolveBranchCardInteraction({ target: cardTarget, isActive: true, clickCount: 1 })).toEqual({
      select: false,
      edit: false,
      preserveDefault: false
    });
    expect(resolveBranchCardInteraction({ target: cardTarget, isActive: true, clickCount: 2 })).toEqual({
      select: false,
      edit: true,
      preserveDefault: false
    });
  });

  it("leaves Markdown links to Obsidian instead of selecting or editing the card", () => {
    const linkTarget = {
      closest: (selector: string) => selector === "a" ? {} : null
    } as unknown as EventTarget;

    expect(resolveBranchCardInteraction({ target: linkTarget, isActive: true, clickCount: 1 })).toEqual({
      select: false,
      edit: false,
      preserveDefault: true
    });
    expect(resolveBranchCardInteraction({ target: linkTarget, isActive: true, clickCount: 2 })).toEqual({
      select: false,
      edit: false,
      preserveDefault: true
    });
  });
});
