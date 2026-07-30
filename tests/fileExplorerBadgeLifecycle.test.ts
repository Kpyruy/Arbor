import { describe, expect, it } from "vitest";
import { ArborBadgeGeneration } from "../src/fileExplorerBadgeLifecycle";

describe("Arbor File Explorer badge lifecycle", () => {
  it("invalidates reads started before a newer refresh", () => {
    const generation = new ArborBadgeGeneration();
    const firstRefresh = generation.beginRefresh();
    const secondRefresh = generation.beginRefresh();

    expect(generation.isCurrent(firstRefresh)).toBe(false);
    expect(generation.isCurrent(secondRefresh)).toBe(true);
  });

  it("invalidates pending reads when unloaded", () => {
    const generation = new ArborBadgeGeneration();
    const refresh = generation.beginRefresh();

    generation.dispose();

    expect(generation.isCurrent(refresh)).toBe(false);
  });
});
