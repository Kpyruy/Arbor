import type { CachedMetadata, HeadingCache, PaneType } from "obsidian";
import type { LoadedFileState } from "../state/viewTypes";
import { findHeadingBlock } from "./headingBlock";

export interface HeadingLinkPort {
  getState(): Readonly<LoadedFileState> | null;
  getSourcePath(): string;
  resolveLocalHeading(linktext: string, sourcePath: string): { cache: CachedMetadata; heading: HeadingCache } | null;
  readSource(sourcePath: string): Promise<string>;
  selectLocalBlock(blockId: string): boolean;
  openInternal(linktext: string, sourcePath: string, pane: PaneType | boolean): Promise<void>;
}

export class HeadingLinkController {
  private generation = 0;

  constructor(private readonly port: HeadingLinkPort) {}

  cancelPending(): void { this.generation += 1; }

  async open(linktext: string, sourcePath: string, pane: PaneType | boolean): Promise<void> {
    const generation = ++this.generation;
    const state = this.port.getState();
    const metadata = state?.metadata;
    const selectedBlockId = state?.selectedBlockId;
    if (pane === false && state && sourcePath === this.port.getSourcePath()) {
      const target = this.port.resolveLocalHeading(linktext, sourcePath);
      if (target) {
        const source = await this.port.readSource(sourcePath);
        if (generation !== this.generation || this.port.getState() !== state || this.port.getSourcePath() !== sourcePath
          || state.metadata !== metadata || state.selectedBlockId !== selectedBlockId) return;
        const blockId = findHeadingBlock(state.metadata, target.cache, source, target.heading);
        if (blockId && this.port.selectLocalBlock(blockId)) return;
      }
    }
    await this.port.openInternal(linktext, sourcePath, pane);
  }
}
