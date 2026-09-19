import { ButtonComponent, Modal } from "obsidian";
import type { CleanExportOptions } from "../../storage/cleanExport";

export class CleanExportModal extends Modal {
  private resolved = false;
  private options: CleanExportOptions = { frontmatter: "keep", excluded: "omit" };
  private resolver: (value: CleanExportOptions | null) => void = () => undefined;

  waitForChoice(): Promise<CleanExportOptions | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("arbor-export-modal");
    contentEl.createEl("h3", { text: "Create clean export copy" });
    contentEl.createEl("p", {
      text: "Choose what the Markdown copy should keep. The source note stays unchanged."
    });

    const choicesEl = contentEl.createDiv({ cls: "arbor-clean-export-choices" });
    const frontmatterGroup = choicesEl.createDiv({ cls: "arbor-clean-export-group" });
    frontmatterGroup.createEl("strong", { text: "YAML frontmatter" });
    this.addChoice(frontmatterGroup, { group: "frontmatter", value: "keep" }, "Keep YAML");
    this.addChoice(frontmatterGroup, { group: "frontmatter", value: "omit" }, "Export body only");
    const excludedGroup = choicesEl.createDiv({ cls: "arbor-clean-export-group" });
    excludedGroup.createEl("strong", { text: "Excluded blocks" });
    this.addChoice(excludedGroup, { group: "excluded", value: "omit" }, "Omit excluded blocks");
    this.addChoice(
      excludedGroup,
      { group: "excluded", value: "comment" },
      "Keep excluded blocks as comments"
    );

    const actionsEl = contentEl.createDiv({ cls: "arbor-confirm-actions" });
    new ButtonComponent(actionsEl)
      .setButtonText("Cancel")
      .onClick(() => this.finish(null));
    new ButtonComponent(actionsEl)
      .setButtonText("Create export")
      .setCta()
      .onClick(() => this.finish({ ...this.options }));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolver(null);
    }
  }

  private addChoice(
    container: HTMLElement,
    choice:
      | { group: "frontmatter"; value: CleanExportOptions["frontmatter"] }
      | { group: "excluded"; value: CleanExportOptions["excluded"] },
    label: string
  ): void {
    const choiceEl = container.createEl("label", { cls: "arbor-clean-export-choice" });
    const input = choiceEl.createEl("input", {
      attr: {
        type: "radio",
        name: `arbor-clean-export-${choice.group}`,
        value: choice.value
      }
    });
    input.checked = this.options[choice.group] === choice.value;
    input.addEventListener("change", () => {
      if (!input.checked) {
        return;
      }
      if (choice.group === "frontmatter") {
        this.options = { ...this.options, frontmatter: choice.value };
      } else {
        this.options = { ...this.options, excluded: choice.value };
      }
    });
    choiceEl.createSpan({ text: label });
  }

  private finish(value: CleanExportOptions | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolver(value);
    this.close();
  }
}
