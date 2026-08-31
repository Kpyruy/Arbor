export type TreeOverviewExportFormat = "png" | "pdf";
export type TreeOverviewExportQuality = "standard" | "high" | "ultra";

const QUALITY_SCALE: Record<TreeOverviewExportQuality, number> = {
  standard: 2,
  high: 4,
  ultra: 8
};

const MAX_EXPORT_DIMENSION_PX = 16_384;
const MAX_EXPORT_PIXELS = 128_000_000;

export interface TreeOverviewExportSize {
  scale: number;
  width: number;
  height: number;
}

export function resolveTreeOverviewExportLinkStyle(textMuted: string): { fill: string; stroke: string; opacity: string } {
  return { fill: "none", stroke: textMuted, opacity: "0.52" };
}

export function resolveTreeOverviewExportSize(
  sourceWidth: number,
  sourceHeight: number,
  quality: TreeOverviewExportQuality
): TreeOverviewExportSize | null {
  const scale = QUALITY_SCALE[quality];
  const width = Math.ceil(sourceWidth * scale);
  const height = Math.ceil(sourceHeight * scale);
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    width > MAX_EXPORT_DIMENSION_PX ||
    height > MAX_EXPORT_DIMENSION_PX ||
    width * height > MAX_EXPORT_PIXELS
  ) {
    return null;
  }

  return { scale, width, height };
}

export function buildAvailableTreeOverviewExportPath(
  folderPath: string,
  sourceBaseName: string,
  format: TreeOverviewExportFormat,
  exists: (path: string) => boolean
): string {
  const baseName = `${sourceBaseName} — Tree Overview`;
  let index = 1;
  while (true) {
    const suffix = index === 1 ? "" : ` ${index}`;
    const fileName = `${baseName}${suffix}.${format}`;
    const candidate = folderPath ? `${folderPath}/${fileName}` : fileName;
    if (!exists(candidate)) {
      return candidate;
    }
    index += 1;
  }
}
