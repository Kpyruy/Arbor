import { describe, expect, it } from "vitest";
import { shouldShowReleaseNotice } from "../src/releaseNotice";

describe("release notice", () => {
  it("shows once for an unseen plugin version", () => {
    expect(shouldShowReleaseNotice(undefined, "0.2.4")).toBe(true);
    expect(shouldShowReleaseNotice("0.2.3", "0.2.4")).toBe(true);
    expect(shouldShowReleaseNotice("0.2.4", "0.2.4")).toBe(false);
  });
});
