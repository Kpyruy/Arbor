import type { TFile } from "obsidian";

export function isImageAttachment(file: Pick<File, "name" | "type">): boolean {
  return file.type.toLowerCase().startsWith("image/") || /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);
}

export interface EditorAttachmentsPort {
  getFilePath(): string;
  hasSession(): boolean;
  getAvailablePath(name: string, sourcePath: string): Promise<string>;
  createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
  generateLink(file: TFile, sourcePath: string): string;
  onInserted(): void;
  notify(message: string): void;
  reportError(message: string, error: unknown): void;
}

export class EditorAttachments {
  private imageWrites: Promise<void> = Promise.resolve();
  constructor(private readonly port: EditorAttachmentsPort) {}

  /** Save to the captured note's attachment destination, never the current selection. */
  saveImageFile(file: File, sourcePath: string, isCurrent: () => boolean): Promise<string> {
    const operation = this.imageWrites.then(async () => {
      if (!isImageAttachment(file) || !isCurrent()) throw new Error("The original image receiver changed");
      const attachmentPath = await this.port.getAvailablePath(this.buildAttachmentName(file), sourcePath);
      const bytes = await file.arrayBuffer();
      if (!isCurrent()) throw new Error("The original image receiver changed while reading the file");
      const created = await this.port.createBinary(attachmentPath, bytes);
      const link = this.port.generateLink(created, sourcePath);
      return link.startsWith("!") ? link : `!${link}`;
    });
    this.imageWrites = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async handleEditorPaste(event: ClipboardEvent, textarea: HTMLTextAreaElement): Promise<void> {
    const items = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (items.length === 0) return;
    event.preventDefault();
    for (const item of items) {
      const file = item.getAsFile();
      if (file) await this.insertImageFileIntoEditor(file, textarea);
    }
  }

  async handleEditorDrop(event: DragEvent, textarea: HTMLTextAreaElement): Promise<void> {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    for (const file of files) await this.insertImageFileIntoEditor(file, textarea);
  }

  private async insertImageFileIntoEditor(file: File, textarea: HTMLTextAreaElement): Promise<void> {
    if (!this.port.getFilePath() || !this.port.hasSession()) return;
    try {
      const sourcePath = this.port.getFilePath();
      const attachmentPath = await this.port.getAvailablePath(this.buildAttachmentName(file), sourcePath);
      const created = await this.port.createBinary(attachmentPath, await file.arrayBuffer());
      const baseLink = this.port.generateLink(created, sourcePath);
      const embedLink = baseLink.startsWith("!") ? baseLink : `!${baseLink}`;
      this.insertTextAtCursor(textarea, `${textarea.value.trim().length > 0 ? "\n\n" : ""}${embedLink}`);
      this.port.onInserted();
    } catch (error) {
      this.port.reportError("[Arbor] Failed to save pasted image", error);
      this.port.notify("Arbor could not save the image into the vault.");
    }
  }

  private insertTextAtCursor(textarea: HTMLTextAreaElement, insertText: string): void {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = `${textarea.value.slice(0, start)}${insertText}${textarea.value.slice(end)}`;
    const nextCursor = start + insertText.length;
    textarea.setSelectionRange(nextCursor, nextCursor);
    textarea.dispatchEvent(new Event("input"));
  }

  private buildAttachmentName(file: File): string {
    if (file.name && file.name.trim().length > 0 && file.name !== "image.png") return file.name;
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const extension = file.type.split("/")[1] || "png";
    return `Pasted image ${stamp}.${extension}`;
  }
}
