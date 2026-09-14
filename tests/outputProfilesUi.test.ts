import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { ArborOutputState, BranchTreeMetadata } from "../src/types";

type OutputProfilesUiModule = typeof import("../src/view/OutputProfilesModal");

let ui: OutputProfilesUiModule;

beforeAll(async () => {
  const bundled = await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["src/view/OutputProfilesModal.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "obsidian-test-host",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-host" }));
        builder.onLoad({ filter: /.*/, namespace: "test-host" }, () => ({
          contents: "export class ButtonComponent {} export class Menu {} export class Modal {}",
          loader: "js"
        }));
      }
    }]
  });
  const source = bundled.outputFiles[0].text;
  const loaded: unknown = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  ui = loaded as OutputProfilesUiModule;
});

function tree(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [
      { id: "root", parentId: null, order: 0, content: "Root", after: "\n\n" },
      { id: "child", parentId: "root", order: 0, content: "Child", after: "" }
    ]
  };
}

function outputState(activeProfileId = "full"): ArborOutputState {
  return {
    version: 1,
    activeProfileId,
    profiles: [{
      id: "draft",
      name: "Draft",
      rules: [{ blockId: "root", state: "exclude" }]
    }]
  };
}

describe("Output Profiles manager UI", () => {
  it("offers creation and the complete custom-profile action set", () => {
    const model = ui.buildOutputProfileManagerModel(outputState(), tree());
    const draft = model.profiles.find((profile) => profile.id === "draft");

    expect(model.createAction.label).toBe("Create profile");
    expect(draft?.actions.map((action) => action.label)).toEqual([
      "Activate",
      "Duplicate",
      "Rename",
      "Delete"
    ]);
    expect(draft).toMatchObject({ includedCount: 0, excludedCount: 2 });
  });

  it("keeps Full tree immutable while allowing it to be duplicated", () => {
    const fullTree = ui.buildOutputProfileManagerModel(outputState("draft"), tree()).profiles[0];

    expect(fullTree).toMatchObject({ id: "full", name: "Full tree", includedCount: 2, excludedCount: 0 });
    expect(fullTree.actions.map((action) => action.label)).toEqual(["Activate", "Duplicate"]);
    expect(fullTree.actions.map((action) => action.id)).not.toContain("rename");
    expect(fullTree.actions.map((action) => action.id)).not.toContain("delete");
  });

  it("builds the active profile pill label and accessible name", () => {
    expect(ui.getOutputProfileButtonPresentation(outputState("draft"))).toEqual({
      text: "Draft",
      ariaLabel: "Output profile: Draft"
    });
  });

  it("creates a Draft toolbar button with the accessible profile label", () => {
    const attributes = new Map<string, string>();
    const button = {
      textContent: "",
      getAttribute: (name: string) => attributes.get(name) ?? null
    } as HTMLButtonElement;
    const container = {
      createEl: (_tag: string, options: { text?: string; attr?: Record<string, string> }) => {
        button.textContent = options.text ?? "";
        Object.entries(options.attr ?? {}).forEach(([name, value]) => attributes.set(name, value));
        return button;
      }
    } as HTMLElement;

    const created = ui.createOutputProfileButton(container, outputState("draft"));

    expect(created.textContent).toBe("Draft");
    expect(created.getAttribute("aria-label")).toBe("Output profile: Draft");
  });

  it("rejects blank and duplicate names before profile save", () => {
    const state = outputState("draft");

    expect(ui.validateOutputProfileName(state, "   ")).toBe("Enter a profile name.");
    expect(ui.validateOutputProfileName(state, " Full tree ")).toBe("Profile names must be unique.");
    expect(ui.validateOutputProfileName(state, " draft ")).toBe("Profile names must be unique.");
    expect(ui.validateOutputProfileName(state, " draft ", "draft")).toBeNull();
    expect(ui.validateOutputProfileName(state, "Publish")).toBeNull();
  });

  it("duplicates the chosen profile immutably without changing the active profile", () => {
    const initial = outputState();
    const duplicate = ui.duplicateOutputProfileState(initial, "draft", tree());

    expect(duplicate).not.toBe(initial);
    expect(duplicate.activeProfileId).toBe("full");
    expect(duplicate.profiles).toEqual([
      initial.profiles[0],
      {
        id: "draft-copy",
        name: "Draft copy",
        rules: [{ blockId: "root", state: "exclude" }]
      }
    ]);
    expect(initial.profiles).toHaveLength(1);
  });

  it("marks typed create and changed rename drafts as unsaved", () => {
    expect(ui.hasUnsavedOutputProfileDraft(null, "")).toBe(false);
    expect(ui.hasUnsavedOutputProfileDraft(null, " Draft ")).toBe(true);
    expect(ui.hasUnsavedOutputProfileDraft("Draft", "Draft")).toBe(false);
    expect(ui.hasUnsavedOutputProfileDraft("Draft", "Publish")).toBe(true);
  });

  it("requires an explicit reset before malformed output can be replaced", () => {
    const model = ui.buildOutputProfileManagerModel(outputState(), tree(), "Invalid output metadata");

    expect(model.resetAction).toEqual({ id: "reset", label: "Reset output profiles" });
    expect(model.createAction.disabled).toBe(true);
    expect(model.profiles.every((profile) => profile.actions.every((action) => action.disabled))).toBe(true);
  });
});
