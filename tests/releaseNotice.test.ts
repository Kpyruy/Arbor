import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getReleaseNote, shouldShowReleaseNotice } from "../src/releaseNotice";

describe("release notice", () => {
  it("does not show a release note on a fresh install", () => {
    expect(shouldShowReleaseNotice(undefined, "0.2.9", true)).toBe(false);
  });

  it("shows only the current registered release after an update", () => {
    expect(shouldShowReleaseNotice("0.2.8", "0.2.9", false)).toBe(true);
    const releaseNote = getReleaseNote("0.2.9");
    expect(releaseNote).toMatchObject({
      version: "0.2.9",
      title: "Shape every draft"
    });
    expect(releaseNote?.changes).toEqual(expect.arrayContaining([
      expect.stringContaining("Output Profiles"),
      expect.stringContaining("Output Preview"),
      expect.stringContaining("clean Markdown")
    ]));
  });

  it("does not repeat a seen, downgraded, or unregistered release", () => {
    expect(shouldShowReleaseNotice("0.2.9", "0.2.9", false)).toBe(false);
    expect(shouldShowReleaseNotice("0.3.0", "0.2.9", false)).toBe(false);
    expect(shouldShowReleaseNotice("0.2.4", "9.9.9", false)).toBe(false);
  });

  it("uses Obsidian's native notice shell instead of nesting a fixed-width card", () => {
    const main = readFileSync(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const noticeStyles = styles.slice(
      styles.indexOf(".arbor-release-notice-content"),
      styles.indexOf(".arbor-release-notice-title")
    );

    expect(main).toContain('const content = noticeEl.createDiv({ cls: "arbor-release-notice-content" });');
    expect(noticeStyles).toContain("min-width: 0;");
    expect(noticeStyles).not.toMatch(/^\s*width:/m);
    expect(noticeStyles).not.toContain("background:");
    expect(noticeStyles).not.toContain("border:");
    expect(noticeStyles).not.toContain("box-shadow:");
  });
});
