export type FileExplorerMenuTarget = "empty" | "file" | "folder";

export const FILE_EXPLORER_CREATION_SECTION = "action-primary";

export function shouldShowNewArborMenuItem(target: FileExplorerMenuTarget): boolean {
  return target === "empty" || target === "folder";
}
