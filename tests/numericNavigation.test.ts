import { describe, expect, it } from "vitest";
import { resolveNumericChildTarget } from "../src/numericNavigation";

const children = Array.from({ length: 25 }, (_, index) => ({ id: "child-" + (index + 1) })) as never;

describe("numeric child navigation", () => {
  it("selects a one-based child and clamps overflow to the last child", () => {
    expect(resolveNumericChildTarget("parent", null, children, 25)).toBe("child-25");
    expect(resolveNumericChildTarget("parent", null, children, 26)).toBe("child-25");
  });

  it("returns the parent for zero and nothing for root zero", () => {
    expect(resolveNumericChildTarget("parent", "root", children, 0)).toBe("root");
    expect(resolveNumericChildTarget("root", null, children, 0)).toBeNull();
  });
});
