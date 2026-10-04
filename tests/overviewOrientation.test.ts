import { describe, expect, it } from "vitest";
import { normalizeOverviewOrientation, resolveOverviewOrientation, getOverviewDirectionKeys } from "../src/overviewOrientation";

describe("overview orientation contracts", () => {
  it.each(["horizontal", "vertical-top-down", "vertical-bottom-up"])("accepts %s", value => {
    expect(normalizeOverviewOrientation(value)).toBe(value);
  });
  it.each([undefined, null, "vertical", "rtl", " Horizontal", 0, {}, []])("rejects invalid value %j", value => {
    expect(normalizeOverviewOrientation(value)).toBeNull();
  });
  it.each([
    ["vertical-top-down", "vertical-bottom-up", "vertical-bottom-up"],
    ["horizontal", "vertical-top-down", "vertical-top-down"],
    ["vertical-bottom-up", "horizontal", "horizontal"],
    ["vertical-top-down", undefined, "vertical-top-down"],
    ["vertical-bottom-up", "invalid", "vertical-bottom-up"],
    ["invalid", "invalid", "horizontal"],
    [undefined, null, "horizontal"],
    ["invalid", "vertical-bottom-up", "vertical-bottom-up"]
  ])("resolves default %j and override %j", (defaultValue, override, want) => {
    expect(resolveOverviewOrientation(defaultValue, override)).toBe(want);
  });
  it.each([
    ["ltr", "horizontal", { parent: "ArrowLeft", child: "ArrowRight", previous: "ArrowUp", next: "ArrowDown" }],
    ["rtl", "horizontal", { parent: "ArrowRight", child: "ArrowLeft", previous: "ArrowUp", next: "ArrowDown" }],
    ["ltr", "vertical-top-down", { parent: "ArrowUp", child: "ArrowDown", previous: "ArrowLeft", next: "ArrowRight" }],
    ["rtl", "vertical-top-down", { parent: "ArrowUp", child: "ArrowDown", previous: "ArrowRight", next: "ArrowLeft" }],
    ["ltr", "vertical-bottom-up", { parent: "ArrowDown", child: "ArrowUp", previous: "ArrowLeft", next: "ArrowRight" }],
    ["rtl", "vertical-bottom-up", { parent: "ArrowDown", child: "ArrowUp", previous: "ArrowRight", next: "ArrowLeft" }]
  ] as const)("maps logical arrows %s/%s", (direction, value, want) => {
    expect(getOverviewDirectionKeys(direction, value)).toEqual(want);
  });
});
