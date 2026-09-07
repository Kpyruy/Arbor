import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PluginManifest {
  version: string;
  minAppVersion: string;
  isDesktopOnly: boolean;
}

interface PackageMetadata {
  version: string;
}

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), fileName), "utf8")) as T;
}

describe("plugin metadata", () => {
  it("declares mobile support and keeps release versions in sync", () => {
    const manifest = readJson<PluginManifest>("manifest.json");
    const packageMetadata = readJson<PackageMetadata>("package.json");

    expect(manifest.isDesktopOnly).toBe(false);
    expect(manifest.minAppVersion).toBe("1.7.2");
    expect(manifest.version).toBe(packageMetadata.version);
  });
});
