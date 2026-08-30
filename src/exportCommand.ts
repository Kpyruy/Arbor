export interface CleanExportCommandContext {
  hasActiveArborView: boolean;
  hasFile: boolean;
}

export function canExportCleanCopy(context: CleanExportCommandContext): boolean {
  return context.hasActiveArborView && context.hasFile;
}

export function canExportTreeOverview(context: CleanExportCommandContext): boolean {
  return context.hasActiveArborView && context.hasFile;
}
