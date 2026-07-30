export function shouldShowReleaseNotice(lastSeenVersion: string | undefined, currentVersion: string): boolean {
  return lastSeenVersion !== currentVersion;
}
