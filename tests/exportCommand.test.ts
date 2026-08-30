import { describe, expect, it } from "vitest";
import { canExportCleanCopy, canExportTreeOverview } from "../src/exportCommand";

describe("clean export command eligibility", () => {
  it("only enables export for an active Arbor view with a file", () => {
    expect(canExportCleanCopy({ hasActiveArborView: true, hasFile: true })).toBe(true);
    expect(canExportCleanCopy({ hasActiveArborView: false, hasFile: true })).toBe(false);
    expect(canExportCleanCopy({ hasActiveArborView: true, hasFile: false })).toBe(false);
  });
});

describe("Tree Overview export command eligibility", () => {
  it("only enables the image or PDF export for an active Arbor view with a file", () => {
    expect(canExportTreeOverview({ hasActiveArborView: true, hasFile: true })).toBe(true);
    expect(canExportTreeOverview({ hasActiveArborView: false, hasFile: true })).toBe(false);
    expect(canExportTreeOverview({ hasActiveArborView: true, hasFile: false })).toBe(false);
  });
});
