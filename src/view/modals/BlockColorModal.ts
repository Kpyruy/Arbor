import { ButtonComponent, Modal, type App } from "obsidian";
import { normalizeBlockColor } from "../../model/blockAppearance";
import type { ArborBlockColorScope } from "../../types";
import { syncCardColour } from "../appearance/cardColours";

export interface BlockColorChoice { color: string | null }
export interface BlockColorDialogOptions {
  scope: ArborBlockColorScope;
  title: string;
  initialColor: string | null;
  inheritedColor: string | null;
}

const SWATCHES = [
  ["Green", "#44aa88"], ["Purple", "#9966dd"], ["Amber", "#e9b44c"],
  ["Blue", "#559bdd"], ["Rose", "#df739d"], ["Coral", "#dd7866"]
] as const;

export class BlockColorModal extends Modal {
  private resolved = false;
  private resolver: (choice: BlockColorChoice | null) => void = () => undefined;
  private draft: string | null;

  constructor(app: App, private readonly options: BlockColorDialogOptions) {
    super(app);
    this.draft = normalizeBlockColor(options.initialColor);
  }

  waitForChoice(): Promise<BlockColorChoice | null> {
    return new Promise(resolve => { this.resolver = resolve; this.open(); });
  }

  onOpen(): void {
    this.modalEl.addClass("arbor-block-colour-modal");
    const body = this.contentEl;
    body.empty();
    body.createEl("h3", { text: this.options.scope === "card" ? "Card color" : "Branch color" });
    body.createEl("p", { cls: "arbor-block-colour-description", text: this.options.scope === "card"
      ? "Only this card changes. Its children keep their own or inherited colors."
      : "New and existing children inherit this color. Individual overrides are kept." });

    const palette = body.createDiv({ cls: "arbor-block-colour-swatches" });
    const buttons = SWATCHES.map(([name, color]) => {
      const button = palette.createEl("button", { cls: "arbor-block-colour-swatch", text: name, attr: { type: "button", "aria-label": name } });
      button.setCssProps({ "--arbor-swatch-color": color });
      button.dataset.color = color;
      button.addEventListener("click", () => { this.draft = color; hex.value = color; refresh(); });
      return button;
    });
    const row = body.createDiv({ cls: "arbor-block-colour-inputs" });
    const pickerLabel = row.createEl("label", { cls: "arbor-block-colour-picker-label", text: "Color" });
    const picker = pickerLabel.createEl("input", { attr: { type: "color", "aria-label": "Custom color" } });
    const hexLabel = row.createEl("label", { text: "Hex" });
    const hex = hexLabel.createEl("input", { attr: { type: "text", placeholder: "#rrggbb", "aria-label": "Hex color", spellcheck: "false" } });
    hex.value = this.draft ?? "";
    const error = body.createDiv({ cls: "arbor-block-colour-error", attr: { role: "status", "aria-live": "polite" } });
    const previewRoot = body.createDiv({ cls: "arbor-view arbor-block-colour-preview" });
    const preview = previewRoot.createDiv({ cls: "arbor-card" });
    preview.createEl("strong", { text: this.options.title });
    preview.createEl("p", { text: "Text follows your theme." });
    const resetRow = body.createDiv({ cls: "arbor-block-colour-reset" });
    new ButtonComponent(resetRow).setButtonText("Use inherited / theme color").onClick(() => {
      this.draft = null; hex.value = ""; refresh();
    });
    const actions = body.createDiv({ cls: "arbor-confirm-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.finish(null));
    const apply = new ButtonComponent(actions).setButtonText("Apply").setCta().onClick(() => {
      const color = this.draft === null ? null : normalizeBlockColor(this.draft);
      if (this.draft !== null && color === null) return;
      this.finish({ color });
    });

    const refresh = () => {
      const color = this.draft === null ? null : normalizeBlockColor(this.draft);
      const invalid = this.draft !== null && color === null;
      apply.setDisabled(invalid);
      error.setText(invalid ? "Enter a six-digit HEX color, for example #44aa88." : "");
      error.toggleClass("is-empty", !invalid);
      const effective = color ?? normalizeBlockColor(this.options.inheritedColor);
      picker.value = effective ?? "#44aa88";
      syncCardColour(preview, effective ? { color: effective, source: "card", ruleBlockId: null } : null);
      buttons.forEach(button => button.setAttribute("aria-pressed", String(color === button.dataset.color)));
    };
    picker.addEventListener("input", () => { this.draft = picker.value; hex.value = picker.value; refresh(); });
    hex.addEventListener("input", () => { this.draft = hex.value; refresh(); });
    refresh();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) { this.resolved = true; this.resolver(null); }
  }

  private finish(choice: BlockColorChoice | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolver(choice);
    this.close();
  }
}
