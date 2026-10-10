/** Values copied synchronously from a gesture before any async native read. */
export interface TransferSnapshot {
  readonly types: readonly string[];
  readonly markdown: string;
  readonly plain: string;
  readonly uriList: string;
  readonly hasFiles: boolean;
  readonly ownArborDrag: boolean;
  readonly imageFiles?: readonly File[];
}

export interface IncomingContent {
  readonly markdown: string;
  readonly via: "native" | "markdown" | "plain" | "uri-list";
}

export type DecodeResult =
  | { kind: "content"; content: IncomingContent }
  | { kind: "ignore"; reason: "internal" | "files" | "empty" | "unsupported" }
  | { kind: "reject"; reason: "too-large" | "nul" | "managed-document" };

export interface IngestionTarget {
  readonly filePath: string;
  readonly blockId: string;
  readonly loadEpoch: number;
  readonly editingSessionId?: string;
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
  readonly selectionDraftValue?: string;
  readonly newBlock?: "sibling" | "child";
  readonly anchorParentId?: string | null;
}

export interface NativeDragReader {
  /** Probe only; never invoke a provider generator during hover. */
  canRead(value: unknown): boolean;
  /** Unsupported returns null; a recognized native reader failure must reject. */
  read(value: unknown, destinationPath: string): Promise<string | null>;
}

/** The caller validates files with the host's public TFile/vault APIs. */
export interface NativeDragPorts<File> {
  resolveFile(value: unknown): File | null;
  resolveLink?(linkpath: string, sourcePath: string): File | null;
  generateMarkdownLink(file: File, destinationPath: string, subpath?: string, alias?: string): string;
  isImageFile?(file: File): boolean;
}
