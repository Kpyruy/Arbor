import { describe, expect, it } from "vitest";
import { isArborManagedText } from "../src/fileExplorerBadge";

describe("Arbor File Explorer badge recognition", () => {
  it("recognizes legacy hidden Arbor metadata", () => {
    expect(isArborManagedText("# Legacy\n<!-- arbor:metadata:v1\neyJ2ZXJzaW9uIjoxfQ==\n-->" )).toBe(true);
  });

  it("recognizes current structured Arbor metadata", () => {
    expect(isArborManagedText("# Current\n%% arbor:structure\n```json\n{\"arbor-plugin\":\"tree\",\"version\":2,\"blocks\":[]}\n```\n%%" )).toBe(true);
  });

  it("does not recognize a plain Markdown note", () => {
    expect(isArborManagedText("# Plain note")).toBe(false);
  });
});
