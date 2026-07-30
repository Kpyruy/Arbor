import { describe, expect, it } from "vitest";
import { isArborManagedText } from "../src/fileExplorerBadgeRecognition";

describe("Arbor File Explorer badge recognition", () => {
  it("recognizes legacy hidden Arbor metadata", () => {
    expect(isArborManagedText("# Legacy\n<!-- arbor:metadata:v1\neyJ2ZXJzaW9uIjoxfQ==\n-->" )).toBe(true);
  });

  it("recognizes current structured Arbor metadata", () => {
    expect(isArborManagedText("# Current\n%% arbor:structure\n```json\n{\"arbor-plugin\":\"tree\",\"version\":2,\"blocks\":[]}\n```\n%%" )).toBe(true);
  });

  it("recognizes current structured Arbor metadata with CRLF line endings", () => {
    expect(isArborManagedText("# Current\r\n%% arbor:structure\r\n```json\r\n{\"arbor-plugin\":\"tree\",\"version\":2,\"blocks\":[]}\r\n```\r\n%%" )).toBe(true);
  });

  it("rejects invalid or foreign structured metadata", () => {
    expect(isArborManagedText("%% arbor:structure\n```json\n{}\n```\n%%")).toBe(false);
    expect(isArborManagedText("%% arbor:structure\n```json\n{\"arbor-plugin\":\"tree\",\"version\":3,\"blocks\":[]}\n```\n%%")).toBe(false);
  });

  it("does not recognize a plain Markdown note", () => {
    expect(isArborManagedText("# Plain note")).toBe(false);
  });
});
