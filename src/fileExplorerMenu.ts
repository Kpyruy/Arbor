export type FileExplorerMenuTarget = "empty" | "file" | "folder";

export function shouldShowNewArborMenuItem(target: FileExplorerMenuTarget, isMobile: boolean): boolean {
  return !isMobile && (target === "empty" || target === "folder");
}
