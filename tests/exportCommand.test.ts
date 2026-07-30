import { describe, expect, it } from "vitest";
import { canExportCleanCopy } from "../src/exportCommand";

describe("clean export command eligibility", () => {
  it("only enables export for an active Arbor view with a file", () => {
    expect(canExportCleanCopy({ hasActiveArborView: true, hasFile: true })).toBe(true);
    expect(canExportCleanCopy({ hasActiveArborView: false, hasFile: true })).toBe(false);
    expect(canExportCleanCopy({ hasActiveArborView: true, hasFile: false })).toBe(false);
  });
});
