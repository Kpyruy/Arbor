import type { TFile } from "obsidian";
import { buildCleanExportDocument, type CleanExportOptions } from "../../storage/cleanExport";
import { buildSinglePageTreeOverviewPdf } from "../../treeOverviewPdf";
import type { TreeOverviewExportFormat, TreeOverviewExportQuality } from "../../treeOverviewExport";
import type { TreeOverviewExportOptions } from "../modals/TreeOverviewExportModal";
import type { EditingSession, LoadedFileState } from "../state/viewTypes";

export interface OverviewSnapshot {
  frame: HTMLElement;
  width: number;
  height: number;
  dispose(): void;
}

export interface ExportPort {
  getFile(this: void): TFile | null;
  getState(this: void): Readonly<LoadedFileState> | null;
  getSession(this: void): EditingSession | null;
  clearBlurCommitTimer(this: void): void;
  commitEditIfNeeded(this: void): Promise<void>;
  chooseClean(this: void): Promise<CleanExportOptions | null>;
  chooseTree(this: void): Promise<TreeOverviewExportOptions | null>;
  createCleanCopy(this: void, source: TFile, contents: string): Promise<TFile>;
  openMarkdown(this: void, file: TFile): Promise<void>;
  createTreeExport(this: void, source: TFile, format: TreeOverviewExportFormat, contents: Uint8Array): Promise<TFile>;
  snapshot(this: void): Promise<OverviewSnapshot>;
  encodePng(this: void, snapshot: OverviewSnapshot, quality: TreeOverviewExportQuality): Promise<Uint8Array | null>;
  notify(this: void, message: string): void;
  reportError(this: void, message: string, error: unknown): void;
}

export class ExportController {
  private isExportingTreeOverview = false;

  constructor(private readonly port: ExportPort) {}

  async exportCleanCopy(): Promise<void> {
    const source = this.port.getFile();
    const state = this.port.getState();
    if (!source || !state) {
      return;
    }

    const { frontmatter, metadata, outputState } = state;
    const pendingEdit = this.toPendingEdit(this.port.getSession());
    this.port.clearBlurCommitTimer();
    const options = await this.port.chooseClean();
    if (!options || this.port.getFile() !== source || !this.port.getState()) {
      return;
    }

    try {
      const contents = buildCleanExportDocument(
        frontmatter,
        metadata,
        outputState,
        options,
        pendingEdit
      );
      const exported = await this.port.createCleanCopy(source, contents);
      await this.port.openMarkdown(exported);
    } catch (error) {
      this.port.reportError("Arbor could not create the clean export copy.", error);
    }
  }

  async exportTreeOverview(): Promise<void> {
    if (!this.port.getFile() || !this.port.getState() || this.isExportingTreeOverview) {
      return;
    }

    const choice = await this.port.chooseTree();
    if (!choice || this.isExportingTreeOverview) {
      return;
    }

    this.isExportingTreeOverview = true;
    let snapshot: OverviewSnapshot | null = null;
    try {
      await this.port.commitEditIfNeeded();
      const source = this.port.getFile();
      if (!source || !this.port.getState()) {
        return;
      }

      snapshot = await this.port.snapshot();
      const pngBytes = await this.port.encodePng(snapshot, choice.quality);
      if (!pngBytes) {
        this.port.notify("This tree overview is too large for the selected quality. Choose a lower quality and try again.");
        return;
      }

      const contents = choice.format === "pdf"
        ? await buildSinglePageTreeOverviewPdf(pngBytes, snapshot.width, snapshot.height)
        : pngBytes;
      const exported = await this.port.createTreeExport(source, choice.format, contents);
      this.port.notify(`Exported tree overview: ${exported.name}`);
    } catch (error) {
      this.port.reportError("Arbor could not export the tree overview.", error);
    } finally {
      snapshot?.dispose();
      this.isExportingTreeOverview = false;
    }
  }

  private toPendingEdit(session: EditingSession | null): { blockId: string; content: string } | undefined {
    return session ? { blockId: session.blockId, content: session.value } : undefined;
  }
}
