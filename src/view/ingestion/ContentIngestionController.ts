import { decodeTransfer, validateIncoming } from "./IncomingContent";
import type { DecodeResult, IngestionTarget, TransferSnapshot } from "./ingestionTypes";

export interface ContentIngestionPort {
  captureTarget(blockId: string): IngestionTarget | null;
  isCurrent(target: IngestionTarget): boolean;
  getEditingBlockId(): string | null;
  insertDraft(target: IngestionTarget, markdown: string): boolean;
  append(target: IngestionTarget, markdown: string): Promise<void>;
  readNative(value: unknown, destinationPath: string): Promise<string | null>;
  readClipboardText(): Promise<string>;
  openEditorForPaste(target: IngestionTarget): void;
  notify(message: string): void;
}

export type IngestionResult =
  | { kind: "appended" | "draft" | "paste-fallback" }
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
  readonly route: "draft" | "append";
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

  drop(event: object, blockId: string, snapshot: TransferSnapshot, nativeValue?: unknown): Promise<IngestionResult> {
    const previous = this.events.get(event);
    if (previous) return previous;
    const transfer: TransferSnapshot = { ...snapshot, types: [...snapshot.types] };
    let nativeRequired = false;
    const read = async (): Promise<DecodeResult> => {
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
    const target = this.capture(blockId);
    const gesture = target ? this.gesture(target, read) : null;
    const result = !target || transfer.ownArborDrag || transfer.hasFiles
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
      this.port.openEditorForPaste(target);
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

  private capture(blockId: string): IngestionTarget | null {
    if (this.closed) return null;
    const target = this.port.captureTarget(blockId);
    return target ? Object.freeze({ ...target }) : null;
  }

  private gesture(target: IngestionTarget, read: Gesture["read"]): Gesture {
    const gesture: Gesture = { target, read, version: this.version, route: this.port.getEditingBlockId() === target.blockId ? "draft" : "append" };
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
      } else {
        await this.port.append(gesture.target, markdown);
      }
    } catch (error) {
      return this.retain(gesture, markdown, error, retainedId);
    }
    if (retainedId !== undefined) this.retained.delete(retainedId);
    return { kind: gesture.route === "draft" ? "draft" : "appended" };
  }
}
