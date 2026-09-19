import { expect, it } from "vitest";
import { sourceMethod } from "./helpers/viewSource";

it("rejects a missing source anchor instead of testing an empty slice", () => {
  expect(() => sourceMethod("src/view/ArborView.ts", "ArborView", "missingMethod")).toThrow("Missing method");
  expect(sourceMethod("src/view/ArborView.ts", "ArborView", "selectBlock")).toContain("selectBlock(");
});
