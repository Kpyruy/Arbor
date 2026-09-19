import { App, ButtonComponent, Modal } from "obsidian";

export class ArborConfirmModal extends Modal {
  private resolved = false;
  private resolver: (value: boolean) => void = () => undefined;

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly bodyText: string,
    private readonly confirmText: string
  ) {
    super(app);
  }

  waitForChoice(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("arbor-confirm-modal");
    contentEl.empty();
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.bodyText });

    const actionsEl = contentEl.createDiv({ cls: "arbor-confirm-actions" });
    new ButtonComponent(actionsEl)
      .setButtonText("Cancel")
      .onClick(() => this.finish(false));

    new ButtonComponent(actionsEl)
      .setButtonText(this.confirmText)
      .setWarning()
      .setCta()
      .onClick(() => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolver(false);
    }
  }

  private finish(value: boolean): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    this.resolver(value);
    this.close();
  }
}
