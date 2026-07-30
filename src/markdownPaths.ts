export function buildAvailableMarkdownPath(
  folderPath: string,
  baseName: string,
  exists: (candidate: string) => boolean
): string {
  let index = 1;
  while (true) {
    const suffix = index === 1 ? "" : ` ${index}`;
    const fileName = `${baseName}${suffix}.md`;
    const candidate = folderPath ? `${folderPath}/${fileName}` : fileName;
    if (!exists(candidate)) {
      return candidate;
    }
    index += 1;
  }
}
