import { decodeTransfer, validateIncoming } from "./IncomingContent";
import type { DecodeResult, IngestionTarget, TransferSnapshot } from "./ingestionTypes";
import { isImageAttachment } from "../editor/EditorAttachments";

export interface ContentIngestionPort {
  captureTarget(blockId: string, newBlock?: IngestionTarget["newBlock"]): IngestionTarget | null;
  isCurrent(target: IngestionTarget): boolean;
  getEditingBlockId(): string | null;
  insertDraft(target: IngestionTarget, markdown: string): boolean;
  append(target: IngestionTarget, markdown: string): Promise<void>;
  create(target: IngestionTarget, markdown: string): Promise<void>;
  saveImage(file: File, target: IngestionTarget): Promise<string>;
  readNative(value: unknown, destinationPath: string): Promise<string | null>;
  readClipboardText(): Promise<string>;
  openEditorForPaste(target: IngestionTarget): void | Promise<void>;
  notify(message: string): void;
}

export type IngestionResult =
  | { kind: "appended" | "created" | "draft" | "paste-fallback" }
  | { kind: "ignored" | "rejected"; reason: string }
  | { kind: "retained"; id: number };

export interface RetainedIncomingContent {
  readonly id: number;
  readonly target: IngestionTarget;
  readonly markdown: string | null;
  readonly reason: string;
}

interface Gesture {
  readonly target: IngestionTarget;
  readonly route: "draft" | "append" | "create";
  readonly version: number;
  readonly read: () => Promise<DecodeResult>;
}

interface RetainedGesture {
  gesture: Gesture;
  content: RetainedIncomingContent;
  retry?: Promise<IngestionResult>;
}

export class ContentIngestionController {
  private readonly events = new WeakMap<object, Promise<IngestionResult>>();
  private readonly retained = new Map<number, RetainedGesture>();
  private readonly gestures = new WeakMap<IngestionTarget, Gesture>();
  private version = 0;
  private nextId = 1;
  private closed = false;

  constructor(private readonly port: ContentIngestionPort) {}

  cancelPending(): void { this.version++; }

  close(): void {
    this.closed = true;
    this.cancelPending();
  }

  getRetained(): RetainedIncomingContent[] {
    return [...this.retained.values()].map(({ content }) => ({ ...content, target: { ...content.target } }));
  }

  discard(id: number): void { this.retained.delete(id); }

  isCurrent(target: IngestionTarget): boolean {
    const gesture = this.gestures.get(target);
    return Boolean(gesture && this.isCurrentGesture(gesture));
  }

  drop(event: object, blockId: string, snapshot: TransferSnapshot, nativeValue?: unknown, newBlock?: IngestionTarget["newBlock"]): Promise<IngestionResult> {
    const previous = this.events.get(event);
    if (previous) return previous;
    const transfer: TransferSnapshot = { ...snapshot, types: [...snapshot.types], imageFiles: [...snapshot.imageFiles ?? []] };
    const images = transfer.imageFiles!;
    const savedImages: string[] = [];
    let nativeRequired = false;
    const read = async (): Promise<DecodeResult> => {
      if (images.length) {
        for (let index = 0; index < images.length; index++) {
          if (savedImages[index] !== undefined) continue;
          if (!this.isCurrent(target!)) throw new Error("The original image receiver changed");
          savedImages[index] = await this.port.saveImage(images[index], target!);
        }
        return validateIncoming(savedImages.join("\n\n"), "native");
      }
      if (nativeValue !== undefined && nativeValue !== null) {
        try {
          const native = await this.port.readNative(nativeValue, target!.filePath);
          if (native !== null) {
            nativeRequired = true;
            return validateIncoming(native, "native");
          }
          if (nativeRequired) throw new Error("The original native content source is unavailable");
        } catch (error) {
          nativeRequired = true;
          throw error;
        }
      }
      return decodeTransfer(transfer);
    };
    const target = this.capture(blockId, newBlock);
    const gesture = target ? this.gesture(target, read) : null;
    const unsupportedFiles = images.some(file => !isImageAttachment(file)) || transfer.hasFiles && !images.length;
    const result = !target || transfer.ownArborDrag || unsupportedFiles
      ? Promise.resolve<IngestionResult>({ kind: "ignored", reason: !target ? "unavailable-target" : transfer.ownArborDrag ? "internal" : "files" })
      : Promise.resolve().then(() => this.receive(gesture!));
    this.events.set(event, result);
    return result;
  }

  async paste(blockId: string): Promise<IngestionResult> {
    const target = this.capture(blockId);
    if (!target) return { kind: "ignored", reason: "unavailable-target" };
    const gesture = this.gesture(target, async () => validateIncoming(await this.port.readClipboardText(), "plain"));
    let decoded: DecodeResult;
    try {
      decoded = await gesture.read();
    } catch {
      if (!this.isCurrentGesture(gesture)) return { kind: "ignored", reason: "stale-target" };
      try {
        await this.port.openEditorForPaste(target);
        if (!this.isCurrentGesture(gesture)) throw new Error("The original Paste target changed while opening its editor");
      } catch (error) {
        return this.retain(gesture, null, error);
      }
      this.port.notify("Clipboard access failed. Use system Paste in the original card editor.");
      return { kind: "paste-fallback" };
    }
    return this.receiveDecoded(gesture, decoded);
  }

  retry(id: number): Promise<IngestionResult> {
    const retained = this.retained.get(id);
    if (!retained) return Promise.resolve({ kind: "ignored", reason: "missing-retained-content" });
    if (retained.retry) return retained.retry;
    const gesture = { ...retained.gesture, version: this.version };
    this.gestures.set(gesture.target, gesture);
    const attempt = retained.content.markdown === null
      ? this.isCurrentGesture(gesture) ? this.receive(gesture, id) : Promise.resolve<IngestionResult>({ kind: "retained", id })
      : this.receiveDecoded(gesture, { kind: "content", content: { markdown: retained.content.markdown, via: "plain" } }, id);
    retained.retry = attempt.finally(() => { retained.retry = undefined; });
    return retained.retry;
  }

  private capture(blockId: string, newBlock?: IngestionTarget["newBlock"]): IngestionTarget | null {
    if (this.closed) return null;
    const target = this.port.captureTarget(blockId, newBlock);
    if (!target) return null;
    // Creation is anchored to a block, never to a textarea selection/session.
    return Object.freeze(newBlock ? { filePath: target.filePath, loadEpoch: target.loadEpoch,
      blockId: target.blockId, anchorParentId: target.anchorParentId, newBlock } : { ...target });
  }

  private gesture(target: IngestionTarget, read: Gesture["read"]): Gesture {
    const gesture: Gesture = { target, read, version: this.version,
      route: target.newBlock ? "create" : this.port.getEditingBlockId() === target.blockId ? "draft" : "append" };
    this.gestures.set(target, gesture);
    return gesture;
  }

  private isCurrentGesture(gesture: Gesture): boolean {
    return !this.closed && gesture.version === this.version && this.port.isCurrent(gesture.target)
      && (gesture.route !== "draft" || Boolean(gesture.target.editingSessionId)
        && this.port.getEditingBlockId() === gesture.target.blockId);
  }

  private retain(gesture: Gesture, markdown: string | null, error: unknown, id = this.nextId++): IngestionResult {
    const reason = error instanceof Error ? error.message : String(error);
    const existing = this.retained.get(id);
    const content = { id, target: gesture.target, markdown, reason };
    if (existing) existing.content = content;
    else this.retained.set(id, { gesture, content });
    this.port.notify("Incoming content was not inserted. It remains available for explicit retry or copy to its original target.");
    return { kind: "retained", id };
  }

  private async receive(gesture: Gesture, retainedId?: number): Promise<IngestionResult> {
    let decoded: DecodeResult;
    try {
      decoded = await gesture.read();
    } catch (error) {
      return this.retain(gesture, null, error, retainedId);
    }
    return this.receiveDecoded(gesture, decoded, retainedId);
  }

  private async receiveDecoded(gesture: Gesture, decoded: DecodeResult, retainedId?: number): Promise<IngestionResult> {
    if (decoded.kind !== "content") {
      if (decoded.kind === "reject") this.port.notify(`Incoming content rejected: ${decoded.reason}`);
      if (retainedId !== undefined) this.retained.delete(retainedId);
      return { kind: decoded.kind === "reject" ? "rejected" : "ignored", reason: decoded.reason };
    }
    const markdown = decoded.content.markdown;
    if (!this.isCurrentGesture(gesture)) return this.retain(gesture, markdown, "The original receiver or editing session changed", retainedId);
    try {
      if (gesture.route === "draft") {
        if (!this.port.insertDraft(gesture.target, markdown)) return this.retain(gesture, markdown, "The original draft insertion was not accepted", retainedId);
      } else if (gesture.route === "create") {
        await this.port.create(gesture.target, markdown);
      } else {
        await this.port.append(gesture.target, markdown);
      }
    } catch (error) {
      return this.retain(gesture, markdown, error, retainedId);
    }
    if (retainedId !== undefined) this.retained.delete(retainedId);
    return { kind: gesture.route === "draft" ? "draft" : gesture.route === "create" ? "created" : "appended" };
  }
}
