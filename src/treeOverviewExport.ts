export type TreeOverviewExportFormat = "png" | "pdf";
export type TreeOverviewExportQuality = "standard" | "high" | "ultra";

export const DEFAULT_TREE_OVERVIEW_EXPORT_QUALITY: TreeOverviewExportQuality = "high";

const QUALITY_SCALE: Record<TreeOverviewExportQuality, number> = {
  standard: 1,
  high: 2,
  ultra: 4
};

export interface TreeOverviewExportLimits {
  readonly maxDimensionPx: number;
  readonly maxPixels: number;
}

const DESKTOP_TREE_OVERVIEW_EXPORT_LIMITS: TreeOverviewExportLimits = {
  maxDimensionPx: 16_384,
  maxPixels: 128_000_000
};

export const MOBILE_TREE_OVERVIEW_EXPORT_LIMITS: TreeOverviewExportLimits = {
  maxDimensionPx: 4_096,
  maxPixels: 8_000_000
};

export interface TreeOverviewExportSize {
  scale: number;
  width: number;
  height: number;
}

export function resolveTreeOverviewExportLinkStyle(textMuted: string): { stroke: string; opacity: string } {
  return { stroke: textMuted, opacity: "0.52" };
}

export function resolveTreeOverviewExportSize(
  sourceWidth: number,
  sourceHeight: number,
  quality: TreeOverviewExportQuality,
  limits: TreeOverviewExportLimits = DESKTOP_TREE_OVERVIEW_EXPORT_LIMITS
): TreeOverviewExportSize | null {
  const scale = QUALITY_SCALE[quality];
  const width = Math.ceil(sourceWidth * scale);
  const height = Math.ceil(sourceHeight * scale);
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    width > limits.maxDimensionPx ||
    height > limits.maxDimensionPx ||
    width * height > limits.maxPixels
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
