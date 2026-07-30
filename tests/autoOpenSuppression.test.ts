import { describe, expect, it } from "vitest";
import { AutoOpenSuppression } from "../src/autoOpenSuppression";

describe("auto-open suppression", () => {
  it("suppresses every auto-open event during one Markdown transition", () => {
    const suppression = new AutoOpenSuppression(1_000);
    suppression.suppress("Essay.md", 100);

    expect(suppression.isSuppressed("Essay.md", 100)).toBe(true);
    expect(suppression.isSuppressed("Essay.md", 250)).toBe(true);
    expect(suppression.isSuppressed("Essay.md", 900)).toBe(true);
  });

  it("releases the path after the transition window", () => {
    const suppression = new AutoOpenSuppression(1_000);
    suppression.suppress("Essay.md", 100);

    expect(suppression.isSuppressed("Essay.md", 1_100)).toBe(false);
  });
});
