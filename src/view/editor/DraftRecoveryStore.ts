export interface RecoverableDraft {
  readonly draftId: string;
  readonly filePath: string;
  readonly blockId: string;
  readonly originalContent: string;
  readonly value: string;
}

export class DraftRecoveryStore {
  private readonly drafts = new Map<string, RecoverableDraft>();

  retain(draft: RecoverableDraft): void {
    this.drafts.set(draft.draftId, { ...draft });
  }

  getAll(filePath: string, blockId: string): readonly RecoverableDraft[] {
    return [...this.drafts.values()]
      .filter(draft => draft.filePath === filePath && draft.blockId === blockId)
      .map(draft => ({ ...draft }));
  }

  remove(draftId: string): void {
    this.drafts.delete(draftId);
  }

  getForFile(filePath: string): readonly RecoverableDraft[] {
    return [...this.drafts.values()]
      .filter(draft => draft.filePath === filePath)
      .map(draft => ({ ...draft }));
  }
}
