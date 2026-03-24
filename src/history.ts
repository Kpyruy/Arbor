import { HISTORY_LIMIT } from "./constants";
import { BranchHistoryEntry, BranchTreeMetadata, BranchBlockId } from "./types";
import { cloneMetadata } from "./model/tree";

export class BranchHistory {
  private undoStack: BranchHistoryEntry[] = [];
  private redoStack: BranchHistoryEntry[] = [];

  push(label: string, metadata: BranchTreeMetadata, selectedBlockId: BranchBlockId | null): void {
    this.undoStack.push({
      label,
      metadata: cloneMetadata(metadata),
      selectedBlockId
    });

    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }

    this.redoStack = [];
  }

  undo(current: BranchHistoryEntry): BranchHistoryEntry | null {
    const previous = this.undoStack.pop() ?? null;
    if (!previous) {
      return null;
    }

    this.redoStack.push({
      label: current.label,
      metadata: cloneMetadata(current.metadata),
      selectedBlockId: current.selectedBlockId
    });
    return previous;
  }

  redo(current: BranchHistoryEntry): BranchHistoryEntry | null {
    const next = this.redoStack.pop() ?? null;
    if (!next) {
      return null;
    }

    this.undoStack.push({
      label: current.label,
      metadata: cloneMetadata(current.metadata),
      selectedBlockId: current.selectedBlockId
    });
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
