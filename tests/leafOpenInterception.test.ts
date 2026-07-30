import { describe, expect, it } from "vitest";
import { captureOriginalSetViewState, invokeOriginalSetViewState } from "../src/leafOpenInterception";

interface TestLeaf {
  opened: string[];
}

interface TestViewState {
  file: string;
}

describe("leaf open interception", () => {
  it("keeps the base setter when Arbor is reloaded", () => {
    const original = function (this: TestLeaf, state: TestViewState): void {
      this.opened.push(state.file);
    };
    const prototype = { setViewState: original };

    expect(captureOriginalSetViewState(prototype)).toBe(original);

    prototype.setViewState = function (): void {
      throw new Error("interceptor should not become the new base setter");
    };

    expect(captureOriginalSetViewState(prototype)).toBe(original);
  });

  it("opens Markdown with the base setter instead of the interceptor", async () => {
    const leaf: TestLeaf = { opened: [] };
    const original = function (this: TestLeaf, state: TestViewState): void {
      this.opened.push(state.file);
    };

    await invokeOriginalSetViewState(original, leaf, { file: "Essay.md" });

    expect(leaf.opened).toEqual(["Essay.md"]);
  });
});
