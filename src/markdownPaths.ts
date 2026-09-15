export function buildAvailableMarkdownPath(
  folderPath: string,
  baseName: string,
  exists: (candidate: string) => boolean
): string {
  const normalizedFolderPath = folderPath === "/" ? "" : folderPath;
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : ` ${index}`;
    const fileName = `${baseName}${suffix}.md`;
    const candidate = normalizedFolderPath ? `${normalizedFolderPath}/${fileName}` : fileName;
    if (!exists(candidate)) {
      return candidate;
    }
    index += 1;
  }
}
