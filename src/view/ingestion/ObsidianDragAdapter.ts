import type { NativeDragPorts, NativeDragReader } from "./ingestionTypes";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

/** Optional active-draggable route; no mutation, interception or provider API dependency. */
export function getNativeDraggable(manager: unknown): unknown {
  try {
    return record(manager)?.draggable ?? null;
  } catch {
    return null;
  }
}

export class NativeDragReadError extends Error {
  constructor(readonly cause: unknown) {
    super("Could not read native dragged content");
    this.name = "NativeDragReadError";
  }
}

function linkParts(linktext: string): { path: string; subpath?: string; alias?: string } {
  const aliasIndex = linktext.indexOf("|");
  const target = aliasIndex < 0 ? linktext : linktext.slice(0, aliasIndex);
  const subpathIndex = target.indexOf("#");
  return {
    path: subpathIndex < 0 ? target : target.slice(0, subpathIndex),
    subpath: subpathIndex < 0 ? undefined : target.slice(subpathIndex),
    alias: aliasIndex < 0 ? undefined : linktext.slice(aliasIndex + 1)
  };
}

/** Knows only generic native generator and explicitly supported core file/link shapes. */
export class ObsidianDragAdapter<File> implements NativeDragReader {
  constructor(private readonly ports: NativeDragPorts<File>) {}

  canRead(value: unknown): boolean {
    try {
      const native = record(value);
      if (!native) return false;
      if (typeof native.getText === "function") return true;
      if (native.type === "file") return this.ports.resolveFile(native.file) !== null;
      return native.type === "link" && typeof native.linktext === "string"
        && (this.ports.resolveFile(native.file) !== null
          || (typeof native.sourcePath === "string" && typeof this.ports.resolveLink === "function"));
    } catch {
      return false;
    }
  }

  async read(value: unknown, destinationPath: string): Promise<string | null> {
    try {
      const native = record(value);
      if (!native) return null;
      // Preserve receiver and destination. Failure here must never fall through to a preview.
      if (typeof native.getText === "function") {
        const markdown: unknown = await native.getText.call(value, destinationPath);
        if (typeof markdown !== "string") throw new Error("Native generator did not return text");
        return markdown;
      }
      if (native.type !== "file" && native.type !== "link") return null;
      if (native.type === "link" && typeof native.linktext !== "string") return null;
      const parts = native.type === "link" ? linkParts(native.linktext as string) : null;
      const file = this.ports.resolveFile(native.file)
        ?? (parts && typeof native.sourcePath === "string" ? this.ports.resolveLink?.(parts.path, native.sourcePath) : null);
      if (!file) {
        if (parts && typeof native.sourcePath === "string" && this.ports.resolveLink) {
          throw new Error("Native reference could not be resolved");
        }
        return null;
      }
      const alias = parts?.alias ?? (parts && typeof native.title === "string" ? native.title : undefined);
      const markdown: unknown = this.ports.generateMarkdownLink(file, destinationPath, parts?.subpath, alias);
      if (typeof markdown !== "string") throw new Error("Native link generator did not return text");
      return this.ports.isImageFile?.(file) && !markdown.startsWith("!") ? `!${markdown}` : markdown;
    } catch (error) {
      throw new NativeDragReadError(error);
    }
  }
}
