import { App, ButtonComponent, Menu, Modal } from "obsidian";
import {
  createProfile,
  deleteProfile,
  excludeAll,
  FULL_OUTPUT_PROFILE_ID,
  getActiveOutputProfile,
  includeAll,
  includeOnlySelectedBranch,
  invertSelection,
  renameProfile,
  resetProfile,
  resolveOutputStates,
  rootBlocksOnly,
  setActiveOutputProfile
} from "../outputProfiles";
import { ArborOutputProfile, ArborOutputState, BranchBlockId, BranchTreeMetadata } from "../types";

export type OutputProfileActionId = "activate" | "duplicate" | "rename" | "delete";

export interface OutputProfileActionModel {
  id: OutputProfileActionId;
  label: "Activate" | "Duplicate" | "Rename" | "Delete";
  disabled: boolean;
}

export type OutputProfilePresetActionId =
  | "include-all"
  | "exclude-all"
  | "invert-selection"
  | "selected-branch"
  | "root-blocks"
  | "reset-profile";

export interface OutputProfilePresetActionModel {
  id: OutputProfilePresetActionId;
  label: string;
  icon: string;
  disabled: boolean;
  requiresConfirmation: boolean;
}

export interface OutputProfileRowModel {
  id: string;
  name: string;
  isActive: boolean;
  includedCount: number;
  excludedCount: number;
  actions: OutputProfileActionModel[];
  presetActions: OutputProfilePresetActionModel[];
}

export interface OutputProfileManagerModel {
  createAction: { id: "create"; label: "Create profile"; disabled: boolean };
  resetAction: { id: "reset"; label: "Reset output profiles"; disabled: boolean } | null;
  profiles: OutputProfileRowModel[];
}

export interface OutputProfilesController {
  initialState: ArborOutputState;
  metadata: BranchTreeMetadata;
  selectedBlockId: BranchBlockId | null;
  outputError: string | null;
  activate: (state: ArborOutputState) => Promise<ArborOutputState>;
  mutate: (label: string, state: ArborOutputState) => Promise<ArborOutputState>;
  reset: () => Promise<ArborOutputState>;
  closed: () => void;
}

interface OutputProfileNameController {
  title: string;
  initialName: string;
  originalName: string | null;
  currentState: () => ArborOutputState;
  profileId?: string;
  save: (name: string) => Promise<void>;
  closed: () => void;
}

export class AsyncOperationCoordinator {
  private readonly queues = new Map<string, { tail: Promise<void>; token: symbol }>();
  private readonly activeSubmissions = new Set<string>();

  enqueue<T>(channel: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(channel)?.tail ?? Promise.resolve();
    const token = Symbol(channel);
    const operationResult = previous.then(operation, operation);
    const tail = operationResult.then(() => undefined, () => undefined);
    this.queues.set(channel, { tail, token });

    return operationResult.finally(() => {
      if (this.queues.get(channel)?.token === token) {
        this.queues.delete(channel);
      }
    });
  }

  runOnce<T>(channel: string, operation: () => Promise<T>): Promise<T | undefined> {
    if (this.activeSubmissions.has(channel)) {
      return Promise.resolve(undefined);
    }

    this.activeSubmissions.add(channel);
    return Promise.resolve()
      .then(operation)
      .finally(() => this.activeSubmissions.delete(channel));
  }

  isBusy(channel: string): boolean {
    return this.queues.has(channel) || this.activeSubmissions.has(channel);
  }
}

function fullTreeProfile(): ArborOutputProfile {
  return { id: FULL_OUTPUT_PROFILE_ID, name: "Full tree", rules: [] };
}

function cloneOutputState(state: ArborOutputState): ArborOutputState {
  return {
    version: 1,
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      rules: profile.rules.map((rule) => ({ ...rule }))
    }))
  };
}

function findProfile(state: ArborOutputState, profileId: string): ArborOutputProfile | null {
  if (profileId === FULL_OUTPUT_PROFILE_ID) {
    return fullTreeProfile();
  }
  const profile = state.profiles.find((candidate) => candidate.id === profileId);
  return profile ? { ...profile, rules: profile.rules.map((rule) => ({ ...rule })) } : null;
}

function uniqueProfileName(state: ArborOutputState, sourceName: string): string {
  const names = new Set(state.profiles.map((profile) => profile.name.trim().toLocaleLowerCase()));
  const base = `${sourceName.trim()} copy`;
  if (!names.has(base.toLocaleLowerCase())) {
    return base;
  }

  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) {
    suffix += 1;
  }
  return `${base} ${suffix}`;
}

function profileIdBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

function uniqueProfileId(state: ArborOutputState, name: string): string {
  const ids = new Set([FULL_OUTPUT_PROFILE_ID, ...state.profiles.map((profile) => profile.id)]);
  const base = profileIdBase(name);
  if (!ids.has(base)) {
    return base;
  }

  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function validateOutputProfileName(
  state: ArborOutputState,
  name: string,
  profileId?: string
): string | null {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return "Enter a profile name.";
  }
  const duplicate = normalizedName.toLocaleLowerCase() === "full tree" || state.profiles.some((profile) =>
    profile.id !== profileId && profile.name.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
  );
  return duplicate ? "Profile names must be unique." : null;
}

export function hasUnsavedOutputProfileDraft(originalName: string | null, draftName: string): boolean {
  return originalName === null ? draftName.trim().length > 0 : draftName !== originalName;
}

export function getOutputProfileButtonPresentation(state: ArborOutputState): {
  text: string;
  ariaLabel: string;
} {
  const active = getActiveOutputProfile(state);
  return { text: active.name, ariaLabel: `Output profile: ${active.name}` };
}

export function createOutputProfileButton(
  container: HTMLElement,
  state: ArborOutputState
): HTMLButtonElement {
  const presentation = getOutputProfileButtonPresentation(state);
  return container.createEl("button", {
    cls: "arbor-output-profile-button",
    text: presentation.text,
    attr: {
      type: "button",
      "aria-label": presentation.ariaLabel,
      "aria-haspopup": "menu"
    }
  });
}

export function buildOutputProfileManagerModel(
  state: ArborOutputState,
  metadata: BranchTreeMetadata,
  outputError: string | null = null,
  busy = false,
  selectedBlockId: BranchBlockId | null = null
): OutputProfileManagerModel {
  const mutationDisabled = outputError !== null || busy;
  const profiles = [fullTreeProfile(), ...state.profiles].map((profile): OutputProfileRowModel => {
    const resolutions = resolveOutputStates(metadata, profile);
    const includedCount = [...resolutions.values()].filter((resolution) => resolution.included).length;
    const actions: OutputProfileActionModel[] = [];
    if (profile.id !== state.activeProfileId) {
      actions.push({ id: "activate", label: "Activate", disabled: mutationDisabled });
    }
    actions.push({ id: "duplicate", label: "Duplicate", disabled: mutationDisabled });
    if (profile.id !== FULL_OUTPUT_PROFILE_ID) {
      actions.push({ id: "rename", label: "Rename", disabled: mutationDisabled });
      actions.push({ id: "delete", label: "Delete", disabled: mutationDisabled });
    }
    return {
      id: profile.id,
      name: profile.name,
      isActive: profile.id === state.activeProfileId,
      includedCount,
      excludedCount: metadata.blocks.length - includedCount,
      actions,
      presetActions:
        profile.id === state.activeProfileId && profile.id !== FULL_OUTPUT_PROFILE_ID
          ? buildOutputProfilePresetActions(metadata, profile, selectedBlockId, mutationDisabled)
          : []
    };
  });

  return {
    createAction: { id: "create", label: "Create profile", disabled: mutationDisabled },
    resetAction: outputError ? { id: "reset", label: "Reset output profiles", disabled: busy } : null,
    profiles
  };
}

export function duplicateOutputProfileState(
  state: ArborOutputState,
  profileId: string,
  metadata: BranchTreeMetadata
): ArborOutputState {
  const source = findProfile(state, profileId);
  if (!source) {
    return cloneOutputState(state);
  }

  const name = uniqueProfileName(state, source.name);
  const id = uniqueProfileId(state, name);
  const sourceActive = setActiveOutputProfile(state, profileId, metadata);
  const duplicated = createProfile(sourceActive, id, name, metadata);
  return setActiveOutputProfile(duplicated, state.activeProfileId, metadata);
}

export function applyOutputProfilePreset(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile,
  actionId: OutputProfilePresetActionId,
  selectedBlockId: BranchBlockId | null
): ArborOutputProfile {
  if (actionId === "include-all") return includeAll(metadata, profile);
  if (actionId === "exclude-all") return excludeAll(metadata, profile);
  if (actionId === "invert-selection") return invertSelection(metadata, profile);
  if (actionId === "selected-branch") {
    return selectedBlockId ? includeOnlySelectedBranch(metadata, profile, selectedBlockId) : profile;
  }
  if (actionId === "root-blocks") return rootBlocksOnly(metadata, profile);
  return resetProfile(metadata, profile);
}

function changedRuleCount(before: ArborOutputProfile, after: ArborOutputProfile): number {
  const beforeRules = new Map(before.rules.map((rule) => [rule.blockId, rule.state]));
  const afterRules = new Map(after.rules.map((rule) => [rule.blockId, rule.state]));
  const blockIds = new Set([...beforeRules.keys(), ...afterRules.keys()]);
  return [...blockIds].filter((blockId) => beforeRules.get(blockId) !== afterRules.get(blockId)).length;
}

export function buildOutputProfilePresetActions(
  metadata: BranchTreeMetadata,
  profile: ArborOutputProfile,
  selectedBlockId: BranchBlockId | null,
  disabled = false
): OutputProfilePresetActionModel[] {
  const definitions: Array<Pick<OutputProfilePresetActionModel, "id" | "label" | "icon">> = [
    { id: "include-all", label: "Include all", icon: "eye" },
    { id: "exclude-all", label: "Exclude all", icon: "eye-off" },
    { id: "invert-selection", label: "Invert selection", icon: "refresh-cw" },
    { id: "selected-branch", label: "Include only selected branch", icon: "git-branch" },
    { id: "root-blocks", label: "Root blocks only", icon: "rows-3" },
    { id: "reset-profile", label: "Reset profile", icon: "rotate-ccw" }
  ];

  return definitions.map((definition) => {
    const next = applyOutputProfilePreset(metadata, profile, definition.id, selectedBlockId);
    const changes = changedRuleCount(profile, next);
    return {
      ...definition,
      disabled:
        disabled ||
        changes === 0 ||
        (definition.id === "selected-branch" && selectedBlockId === null),
      requiresConfirmation:
        definition.id === "exclude-all" ||
        definition.id === "reset-profile" ||
        changes > 1
    };
  });
}

class OutputProfilesConfirmModal extends Modal {
  private resolved = false;
  private readonly submissions = new AsyncOperationCoordinator();
  private cancelButton: ButtonComponent | null = null;
  private confirmButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly description: string,
    private readonly confirmText: string,
    private readonly onConfirm: () => void | Promise<void>,
    private readonly onDismiss: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-output-profiles-confirm-modal");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.description });
    const actions = contentEl.createDiv({ cls: "arbor-output-profiles-confirm-actions" });
    this.cancelButton = new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    this.confirmButton = new ButtonComponent(actions)
      .setButtonText(this.confirmText)
      .setWarning()
      .onClick(() => void this.confirm());
  }

  override close(): void {
    if (!this.submissions.isBusy("confirm")) {
      super.close();
    }
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.onDismiss();
    }
  }

  private async confirm(): Promise<void> {
    if (this.resolved) {
      return;
    }

    const submission = this.submissions.runOnce("confirm", async () => {
      await this.onConfirm();
      this.resolved = true;
      super.close();
    });
    this.syncBusyPresentation();
    try {
      await submission;
    } finally {
      this.syncBusyPresentation();
    }
  }

  private syncBusyPresentation(): void {
    const busy = this.submissions.isBusy("confirm");
    this.contentEl.setAttr("aria-busy", busy ? "true" : "false");
    this.cancelButton?.setDisabled(busy);
    this.confirmButton?.setDisabled(busy);
  }
}

class OutputProfileNameModal extends Modal {
  private draftName: string;
  private forceClose = false;
  private confirmationOpen = false;
  private errorEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private cancelButton: ButtonComponent | null = null;
  private saveButton: ButtonComponent | null = null;
  private readonly submissions = new AsyncOperationCoordinator();

  constructor(app: App, private readonly controller: OutputProfileNameController) {
    super(app);
    this.draftName = controller.initialName;
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-output-profile-name-modal");
    this.render();
  }

  override close(): void {
    if (this.submissions.isBusy("save")) {
      return;
    }
    if (
      !this.forceClose &&
      hasUnsavedOutputProfileDraft(this.controller.originalName, this.draftName)
    ) {
      this.confirmDiscard();
      return;
    }
    super.close();
  }

  onClose(): void {
    this.contentEl.empty();
    this.controller.closed();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.controller.title });
    const field = contentEl.createEl("label", { cls: "arbor-output-profile-name-field" });
    field.createSpan({ text: "Profile name" });
    const input = field.createEl("input", {
      attr: { type: "text", autocomplete: "off" },
      value: this.draftName
    });
    this.inputEl = input;
    input.addEventListener("input", () => {
      this.draftName = input.value;
      this.showError(null);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        void this.save();
      }
    });
    this.errorEl = contentEl.createDiv({ cls: "arbor-output-profile-name-error" });
    const actions = contentEl.createDiv({ cls: "arbor-output-profile-name-actions" });
    this.cancelButton = new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    this.saveButton = new ButtonComponent(actions).setButtonText("Save").setCta().onClick(() => void this.save());
    window.requestAnimationFrame(() => input.focus());
  }

  private async save(): Promise<void> {
    const submission = this.submissions.runOnce("save", async () => {
      const error = validateOutputProfileName(
        this.controller.currentState(),
        this.draftName,
        this.controller.profileId
      );
      if (error) {
        this.showError(error);
        return;
      }

      await this.controller.save(this.draftName.trim());
      this.forceClose = true;
      super.close();
    });
    this.syncBusyPresentation();
    try {
      await submission;
    } finally {
      this.syncBusyPresentation();
    }
  }

  private showError(error: string | null): void {
    this.errorEl?.setText(error ?? "");
    this.errorEl?.toggleClass("is-visible", error !== null);
  }

  private syncBusyPresentation(): void {
    const busy = this.submissions.isBusy("save");
    this.contentEl.setAttr("aria-busy", busy ? "true" : "false");
    if (this.inputEl) {
      this.inputEl.disabled = busy;
    }
    this.cancelButton?.setDisabled(busy);
    this.saveButton?.setDisabled(busy);
  }

  private confirmDiscard(): void {
    if (this.confirmationOpen) {
      return;
    }
    this.confirmationOpen = true;
    new OutputProfilesConfirmModal(
      this.app,
      "Profile has unsaved changes",
      "Close without saving this profile name?",
      "Discard changes",
      () => {
        this.forceClose = true;
        super.close();
      },
      () => {
        this.confirmationOpen = false;
      }
    ).open();
  }
}

export class OutputProfilesModal extends Modal {
  private state: ArborOutputState;
  private nameModal: OutputProfileNameModal | null = null;
  private confirmationOpen = false;
  private readonly operations = new AsyncOperationCoordinator();

  constructor(app: App, private readonly controller: OutputProfilesController) {
    super(app);
    this.state = cloneOutputState(controller.initialState);
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-output-profiles-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.controller.closed();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Output profiles" });
    const busy = this.operations.isBusy("manager");
    contentEl.setAttr("aria-busy", busy ? "true" : "false");
    const model = buildOutputProfileManagerModel(
      this.state,
      this.controller.metadata,
      this.controller.outputError,
      busy,
      this.controller.selectedBlockId
    );

    if (this.controller.outputError && model.resetAction) {
      const warning = contentEl.createDiv({ cls: "arbor-output-profiles-warning" });
      const copy = warning.createDiv();
      copy.createEl("strong", { text: "Output profile metadata is invalid" });
      copy.createEl("p", {
        text: "The original metadata is preserved. Reset it explicitly before changing profiles."
      });
      new ButtonComponent(warning)
        .setButtonText(model.resetAction.label)
        .setDisabled(model.resetAction.disabled)
        .setWarning()
        .onClick(() => this.confirmReset());
    }

    const heading = contentEl.createDiv({ cls: "arbor-output-profiles-heading" });
    heading.createEl("p", { text: "Choose which branch selection drives output and export." });
    new ButtonComponent(heading)
      .setButtonText(model.createAction.label)
      .setDisabled(model.createAction.disabled)
      .onClick(() => this.openCreate());

    const list = contentEl.createDiv({ cls: "arbor-output-profiles-list" });
    model.profiles.forEach((profile) => this.renderProfile(list, profile));
  }

  private renderProfile(container: HTMLElement, profile: OutputProfileRowModel): void {
    const row = container.createDiv({ cls: "arbor-output-profile-row" });
    row.toggleClass("is-active", profile.isActive);
    const details = row.createDiv({ cls: "arbor-output-profile-details" });
    const nameLine = details.createDiv({ cls: "arbor-output-profile-name" });
    nameLine.createEl("strong", { text: profile.name });
    if (profile.isActive) {
      nameLine.createSpan({ cls: "arbor-output-profile-active", text: "Active" });
    }
    details.createDiv({
      cls: "arbor-output-profile-counts",
      text: `${profile.includedCount} included · ${profile.excludedCount} excluded`
    });

    const actionButton = new ButtonComponent(row)
      .setButtonText("Actions")
      .setTooltip(`Actions for ${profile.name}`);
    actionButton.buttonEl.setAttr("aria-haspopup", "menu");
    actionButton.onClick(() => this.openProfileMenu(actionButton.buttonEl, profile));
  }

  private openProfileMenu(anchor: HTMLButtonElement, profile: OutputProfileRowModel): void {
    const menu = new Menu();
    profile.actions.forEach((action) => {
      menu.addItem((item) => {
        item.setTitle(action.label).setDisabled(action.disabled);
        if (action.id === "activate") item.setIcon("check");
        if (action.id === "duplicate") item.setIcon("copy");
        if (action.id === "rename") item.setIcon("pencil");
        if (action.id === "delete") item.setIcon("trash-2").setWarning(true);
        item.onClick(() => this.runProfileAction(action.id, profile.id));
      });
    });
    if (profile.presetActions.length > 0) {
      menu.addSeparator();
      profile.presetActions.forEach((action) => {
        menu.addItem((item) => {
          item
            .setTitle(action.label)
            .setIcon(action.icon)
            .setDisabled(action.disabled)
            .onClick(() => this.runPresetAction(profile.id, action));
          if (action.id === "exclude-all" || action.id === "reset-profile") {
            item.setWarning(true);
          }
        });
      });
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 6 }, anchor.ownerDocument);
  }

  private runProfileAction(action: OutputProfileActionId, profileId: string): void {
    if (action === "activate") {
      void this.activate(profileId);
      return;
    }
    if (action === "duplicate") {
      void this.duplicate(profileId);
      return;
    }
    if (action === "rename") {
      this.openRename(profileId);
      return;
    }
    this.confirmDelete(profileId);
  }

  private runPresetAction(profileId: string, action: OutputProfilePresetActionModel): void {
    if (action.disabled || this.controller.outputError) {
      return;
    }
    if (action.requiresConfirmation) {
      this.confirmPreset(profileId, action);
      return;
    }
    void this.applyPreset(profileId, action);
  }

  private confirmPreset(profileId: string, action: OutputProfilePresetActionModel): void {
    const profile = findProfile(this.state, profileId);
    if (!profile || profile.id === FULL_OUTPUT_PROFILE_ID || this.confirmationOpen) {
      return;
    }

    this.confirmationOpen = true;
    const description = action.id === "exclude-all"
      ? `This will exclude every block from ${profile.name}.`
      : action.id === "reset-profile"
        ? `This will clear every output rule in ${profile.name}.`
        : `This preset replaces multiple output rules in ${profile.name}.`;
    new OutputProfilesConfirmModal(
      this.app,
      `${action.label}?`,
      description,
      action.label,
      async () => {
        try {
          await this.applyPreset(profileId, action);
        } finally {
          this.confirmationOpen = false;
        }
      },
      () => {
        this.confirmationOpen = false;
      }
    ).open();
  }

  private async applyPreset(
    profileId: string,
    action: OutputProfilePresetActionModel
  ): Promise<void> {
    await this.runManagerOperation(async () => {
      const profile = findProfile(this.state, profileId);
      if (
        !profile ||
        profile.id === FULL_OUTPUT_PROFILE_ID ||
        this.state.activeProfileId !== profile.id ||
        this.controller.outputError
      ) {
        return;
      }

      const updatedProfile = applyOutputProfilePreset(
        this.controller.metadata,
        profile,
        action.id,
        this.controller.selectedBlockId
      );
      const next: ArborOutputState = {
        ...this.state,
        profiles: this.state.profiles.map((candidate) =>
          candidate.id === profile.id ? updatedProfile : candidate
        )
      };
      this.state = await this.controller.mutate(action.label, next);
    });
  }

  private openCreate(): void {
    if (this.controller.outputError || this.operations.isBusy("manager")) {
      return;
    }
    this.openNameModal({
      title: "Create output profile",
      initialName: "",
      originalName: null,
      save: async (name) => {
        await this.runManagerOperation(async () => {
          const next = createProfile(
            this.state,
            uniqueProfileId(this.state, name),
            name,
            this.controller.metadata
          );
          this.state = await this.controller.mutate("Create output profile", next);
        });
      }
    });
  }

  private openRename(profileId: string): void {
    const profile = findProfile(this.state, profileId);
    if (
      !profile ||
      profile.id === FULL_OUTPUT_PROFILE_ID ||
      this.controller.outputError ||
      this.operations.isBusy("manager")
    ) {
      return;
    }
    this.openNameModal({
      title: "Rename output profile",
      initialName: profile.name,
      originalName: profile.name,
      profileId,
      save: async (name) => {
        await this.runManagerOperation(async () => {
          const next = renameProfile(this.state, profileId, name, this.controller.metadata);
          this.state = await this.controller.mutate("Rename output profile", next);
        });
      }
    });
  }

  private openNameModal(options: Omit<OutputProfileNameController, "currentState" | "closed">): void {
    this.nameModal = new OutputProfileNameModal(this.app, {
      ...options,
      currentState: () => this.state,
      closed: () => {
        this.nameModal = null;
      }
    });
    this.nameModal.open();
  }

  private async activate(profileId: string): Promise<void> {
    if (this.controller.outputError) {
      return;
    }
    await this.runManagerOperation(async () => {
      const next = setActiveOutputProfile(this.state, profileId, this.controller.metadata);
      this.state = await this.controller.activate(next);
    });
  }

  private async duplicate(profileId: string): Promise<void> {
    if (this.controller.outputError) {
      return;
    }
    await this.runManagerOperation(async () => {
      const next = duplicateOutputProfileState(this.state, profileId, this.controller.metadata);
      this.state = await this.controller.mutate("Duplicate output profile", next);
    });
  }

  private confirmDelete(profileId: string): void {
    const profile = findProfile(this.state, profileId);
    if (!profile || profile.id === FULL_OUTPUT_PROFILE_ID || this.confirmationOpen || this.controller.outputError) {
      return;
    }
    this.confirmationOpen = true;
    new OutputProfilesConfirmModal(
      this.app,
      `Delete ${profile.name}?`,
      "This removes the profile and its output rules.",
      "Delete",
      async () => {
        try {
          await this.runManagerOperation(async () => {
            const next = deleteProfile(this.state, profile.id, this.controller.metadata);
            this.state = await this.controller.mutate("Delete output profile", next);
          });
        } finally {
          this.confirmationOpen = false;
        }
      },
      () => {
        this.confirmationOpen = false;
      }
    ).open();
  }

  private confirmReset(): void {
    if (this.confirmationOpen || !this.controller.outputError) {
      return;
    }
    this.confirmationOpen = true;
    new OutputProfilesConfirmModal(
      this.app,
      "Reset output profiles?",
      "This replaces the invalid output metadata with a new Full tree state.",
      "Reset output profiles",
      async () => {
        try {
          await this.runManagerOperation(async () => {
            this.state = await this.controller.reset();
          });
          this.close();
        } finally {
          this.confirmationOpen = false;
        }
      },
      () => {
        this.confirmationOpen = false;
      }
    ).open();
  }

  private async runManagerOperation(operation: () => Promise<void>): Promise<void> {
    const pending = this.operations.enqueue("manager", operation);
    this.render();
    try {
      await pending;
    } finally {
      this.render();
    }
  }
}
