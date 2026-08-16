import { ARBOR_RELEASE_NOTES, type ArborReleaseNote } from "./releaseNotes";

export function getReleaseNote(version: string): ArborReleaseNote | undefined {
  return ARBOR_RELEASE_NOTES.find((note) => note.version === version);
}

export function shouldShowReleaseNotice(
  lastSeenVersion: string | undefined,
  currentVersion: string,
  isFreshInstall: boolean
): boolean {
  if (isFreshInstall || !getReleaseNote(currentVersion)) {
    return false;
  }

  return !lastSeenVersion || compareSemver(lastSeenVersion, currentVersion) < 0;
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
