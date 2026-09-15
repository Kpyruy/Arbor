import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { addChild } from "../src/model/tree";
import { reconcileProfilesAfterTreeChange } from "../src/outputProfiles";
import { ArborOutputState, BranchTreeMetadata } from "../src/types";

type OutputProfilesUiModule = typeof import("../src/view/OutputProfilesModal");
type ArborViewUiModule = typeof import("../src/view/ArborView");

let ui: OutputProfilesUiModule;
let arborViewUi: ArborViewUiModule;

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
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "obsidian-host" }));
        builder.onLoad({ filter: /.*/, namespace: "obsidian-host" }, () => ({
          contents: "export class ButtonComponent {} export class Menu {} export class Modal {}",
          loader: "js"
        }));
      }
    }]
  });
  const source = bundled.outputFiles[0].text;
  const loaded: unknown = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  ui = loaded as OutputProfilesUiModule;

  const arborViewBundle = await build({
    absWorkingDir: process.cwd(),
    entryPoints: ["src/view/ArborView.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "arbor-view-test-host",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-host" }));
        builder.onLoad({ filter: /.*/, namespace: "test-host" }, () => ({
          contents: [
            "export class App {}",
            "export class ButtonComponent {}",
            "export class FileView {}",
            "export class MarkdownView {}",
            "export class Menu {}",
            "export class Modal {}",
            "export class Notice {}",
            "export class TFile {}",
            "export class WorkspaceLeaf {}",
            "export const MarkdownRenderer = {};",
            "export const Platform = {};",
            "export const setIcon = () => undefined;"
          ].join("\n"),
          loader: "js"
        }));
        builder.onResolve({ filter: /^html-to-image$/ }, () => ({ path: "html-to-image", namespace: "html-host" }));
        builder.onLoad({ filter: /.*/, namespace: "html-host" }, () => ({
          contents: "export const toBlob = async () => null;",
          loader: "js"
        }));
      }
    }]
  });
  const arborViewSource = arborViewBundle.outputFiles[0].text;
  const arborViewLoaded: unknown = await import(
    `data:text/javascript;base64,${Buffer.from(arborViewSource).toString("base64")}`
  );
  arborViewUi = arborViewLoaded as ArborViewUiModule;
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
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

    expect(model.resetAction).toEqual({
      id: "reset",
      label: "Reset output profiles",
      disabled: false
    });
    expect(model.createAction.disabled).toBe(true);
    expect(model.profiles.every((profile) => profile.actions.every((action) => action.disabled))).toBe(true);
  });

  it("disables every manager mutation while an operation is busy", () => {
    const model = ui.buildOutputProfileManagerModel(outputState(), tree(), null, true);
    const invalidModel = ui.buildOutputProfileManagerModel(
      outputState(),
      tree(),
      "Invalid output metadata",
      true
    );

    expect(model.createAction.disabled).toBe(true);
    expect(model.profiles.every((profile) => profile.actions.every((action) => action.disabled))).toBe(true);
    expect(invalidModel.resetAction?.disabled).toBe(true);
  });

  it("serializes rapid mutations against the latest persisted profile state", async () => {
    const coordinator = new ui.AsyncOperationCoordinator();
    const firstSave = deferred();
    let state: ArborOutputState = {
      ...outputState(),
      profiles: [
        ...outputState().profiles,
        { id: "publish", name: "Publish", rules: [] }
      ]
    };

    const duplicateDraft = coordinator.enqueue("manager", async () => {
      const next = ui.duplicateOutputProfileState(state, "draft", tree());
      await firstSave.promise;
      state = next;
    });
    const duplicatePublish = coordinator.enqueue("manager", async () => {
      state = ui.duplicateOutputProfileState(state, "publish", tree());
    });

    expect(coordinator.isBusy("manager")).toBe(true);
    await Promise.resolve();
    firstSave.resolve();
    await Promise.all([duplicateDraft, duplicatePublish]);

    expect(coordinator.isBusy("manager")).toBe(false);
    expect(state.profiles.map((profile) => profile.name)).toEqual([
      "Draft",
      "Publish",
      "Draft copy",
      "Publish copy"
    ]);
  });

  it.each(["name-save", "confirmation"])(
    "guards repeated %s submissions synchronously",
    async (channel) => {
      const coordinator = new ui.AsyncOperationCoordinator();
      const pending = deferred();
      let controllerCalls = 0;
      const submit = () => coordinator.runOnce(channel, async () => {
        controllerCalls += 1;
        await pending.promise;
      });

      const first = submit();
      const repeated = submit();
      expect(coordinator.isBusy(channel)).toBe(true);
      await Promise.resolve();

      expect(controllerCalls).toBe(1);
      await expect(repeated).resolves.toBeUndefined();
      pending.resolve();
      await first;
      expect(coordinator.isBusy(channel)).toBe(false);
    }
  );

  it("exposes block-only and subtree output actions only for custom profiles", () => {
    expect(arborViewUi.getBlockOutputMenuActions(outputState("draft")).map((action) => action.label)).toEqual([
      "Include block only",
      "Exclude block only",
      "Include subtree",
      "Exclude subtree"
    ]);
    expect(arborViewUi.getBlockOutputMenuActions(outputState("full")).map((action) => action.label)).toEqual([
      "Create output profile"
    ]);
  });

  it("groups all bulk presets on the active custom profile", () => {
    const model = ui.buildOutputProfileManagerModel(outputState("draft"), tree(), null, false, "child");
    const draft = model.profiles.find((profile) => profile.id === "draft");
    const full = model.profiles.find((profile) => profile.id === "full");

    expect(draft?.presetActions.map((action) => action.label)).toEqual([
      "Include all",
      "Exclude all",
      "Invert selection",
      "Include only selected branch",
      "Root blocks only",
      "Reset profile"
    ]);
    expect(full?.presetActions).toEqual([]);
    expect(draft?.presetActions.find((action) => action.id === "exclude-all")?.requiresConfirmation).toBe(true);
    expect(draft?.presetActions.find((action) => action.id === "reset-profile")?.requiresConfirmation).toBe(true);
    expect(draft?.presetActions.find((action) => action.id === "include-all")?.requiresConfirmation).toBe(false);
    expect(draft?.presetActions.find((action) => action.id === "root-blocks")?.requiresConfirmation).toBe(true);
  });

  it("disables the selected-branch preset when no block is selected", () => {
    const model = ui.buildOutputProfileManagerModel(outputState("draft"), tree(), null, false, null);
    const selectedBranch = model.profiles
      .find((profile) => profile.id === "draft")
      ?.presetActions.find((action) => action.id === "selected-branch");

    expect(selectedBranch?.disabled).toBe(true);
  });

  it("disables preset mutations while malformed metadata is locked", () => {
    const model = ui.buildOutputProfileManagerModel(
      outputState("draft"),
      tree(),
      "Invalid output metadata",
      false,
      "child"
    );
    const presets = model.profiles.find((profile) => profile.id === "draft")?.presetActions ?? [];

    expect(presets).toHaveLength(6);
    expect(presets.every((action) => action.disabled)).toBe(true);
  });

  it("describes direct and inherited output exclusion without relying on color", () => {
    const state = outputState("draft");
    const includedState: ArborOutputState = {
      ...state,
      profiles: [{ ...state.profiles[0], rules: [] }]
    };

    const direct = arborViewUi.getOutputCardPresentation(tree(), state, "root");
    const inherited = arborViewUi.getOutputCardPresentation(tree(), state, "child");

    expect(direct).toMatchObject({
      className: "is-output-excluded-direct",
      badgeIcon: "eye-off"
    });
    expect(direct.ariaLabel).toContain("Excluded directly from output profile Draft");
    expect(inherited).toMatchObject({
      className: "is-output-excluded-inherited",
      badgeIcon: "eye-off"
    });
    expect(inherited.ariaLabel).toContain('Inherited exclusion from ancestor "Root"');
    expect(arborViewUi.getOutputCardPresentation(tree(), includedState, "root")).toMatchObject({
      className: null,
      badgeIcon: null,
      ariaLabel: "Root. Included in output profile Draft."
    });
  });

  it("renders an active profile before its asynchronous persistence finishes", async () => {
    const pendingSave = deferred();
    const renderedProfileIds: string[] = [];
    const view = Object.create(arborViewUi.ArborView.prototype) as ArborViewUiModule["ArborView"] & {
      state: {
        metadata: BranchTreeMetadata;
        outputState: ArborOutputState;
        outputError: null;
      };
      commitEditIfNeeded: () => Promise<void>;
      persistState: () => Promise<void>;
      render: () => void;
      applyActiveOutputProfile: (next: ArborOutputState) => Promise<ArborOutputState>;
    };
    view.state = { metadata: tree(), outputState: outputState("full"), outputError: null };
    view.commitEditIfNeeded = async () => undefined;
    view.persistState = () => pendingSave.promise;
    view.render = () => renderedProfileIds.push(view.state.outputState.activeProfileId);

    const activation = view.applyActiveOutputProfile(outputState("draft"));
    await Promise.resolve();
    await Promise.resolve();

    expect(renderedProfileIds).toEqual(["draft"]);
    pendingSave.resolve();
    await expect(activation).resolves.toMatchObject({ activeProfileId: "draft" });
  });

  it("updates visible Tree Overview cards before profile persistence finishes", async () => {
    const pendingSave = deferred();
    const classNames = new Set<string>();
    const attributes = new Map<string, string>();
    const badge = { dataset: {} };
    const card = {
      dataset: { blockId: "root" },
      addClass: (...names: string[]) => names.forEach((name) => classNames.add(name)),
      removeClass: (...names: string[]) => names.forEach((name) => classNames.delete(name)),
      querySelector: () => null,
      setAttr: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
      createSpan: () => badge
    } as unknown as HTMLElement;
    const view = Object.create(arborViewUi.ArborView.prototype) as ArborViewUiModule["ArborView"] & {
      state: {
        metadata: BranchTreeMetadata;
        outputState: ArborOutputState;
        outputError: null;
      };
      viewContext: null;
      overviewSurfaceEl: { querySelectorAll: () => HTMLElement[] };
      commitEditIfNeeded: () => Promise<void>;
      persistState: () => Promise<void>;
      render: () => void;
      applyActiveOutputProfile: (next: ArborOutputState) => Promise<ArborOutputState>;
    };
    view.state = { metadata: tree(), outputState: outputState("full"), outputError: null };
    view.viewContext = null;
    view.overviewSurfaceEl = { querySelectorAll: () => [card] };
    view.commitEditIfNeeded = async () => undefined;
    view.persistState = () => pendingSave.promise;
    view.render = () => undefined;

    const activation = view.applyActiveOutputProfile(outputState("draft"));
    await Promise.resolve();
    await Promise.resolve();

    expect(classNames.has("is-output-excluded-direct")).toBe(true);
    expect(attributes.get("aria-label")).toContain("Excluded directly from output profile Draft");
    pendingSave.resolve();
    await activation;
  });

  it("keeps only the accessible Obsidian tooltip on excluded cards", () => {
    const attributes = new Map<string, string>([["title", "stale browser tooltip"]]);
    const badge = { dataset: {} };
    const card = {
      addClass: () => undefined,
      removeClass: () => undefined,
      querySelector: () => null,
      setAttr: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
      createSpan: () => badge
    } as unknown as HTMLElement;
    const view = Object.create(arborViewUi.ArborView.prototype) as ArborViewUiModule["ArborView"] & {
      state: {
        metadata: BranchTreeMetadata;
        outputState: ArborOutputState;
        outputError: null;
      };
      viewContext: null;
      syncOutputCardPresentation: (card: HTMLElement, blockId: string) => void;
    };
    view.state = { metadata: tree(), outputState: outputState("draft"), outputError: null };
    view.viewContext = null;

    view.syncOutputCardPresentation(card, "root");

    expect(attributes.get("aria-label")).toContain("Excluded directly from output profile Draft");
    expect(attributes.has("title")).toBe(false);
  });

  it("marks a new child inherited from an excluded parent as excluded", () => {
    const before = tree();
    const created = addChild(before, "root");
    const state = reconcileProfilesAfterTreeChange(
      before,
      created.metadata,
      outputState("draft")
    );

    expect(arborViewUi.getOutputCardPresentation(
      created.metadata,
      state,
      created.selectedBlockId
    )).toMatchObject({
      className: "is-output-excluded-inherited",
      badgeIcon: "eye-off"
    });
  });
});
