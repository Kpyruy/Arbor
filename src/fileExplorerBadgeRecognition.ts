import { LEGACY_METADATA_MARKER, STRUCTURE_MARKER } from "./constants";
import { parseStructureBlock } from "./storage/serializer";
import { normalizeNewlines } from "./utils";

const LEGACY_METADATA_PATTERN = new RegExp(`<!--\\s*${LEGACY_METADATA_MARKER}\\b[\\s\\S]*?-->`);
const STRUCTURED_METADATA_PATTERN = new RegExp("%%\\s*" + STRUCTURE_MARKER + "\\s*\\n```json\\n[\\s\\S]*?\\n```\\n%%");

export function isArborManagedText(text: string): boolean {
  const normalized = normalizeNewlines(text);
  if (LEGACY_METADATA_PATTERN.test(normalized)) {
    return true;
  }

  const structure = normalized.match(STRUCTURED_METADATA_PATTERN)?.[0];
  return structure ? parseStructureBlock(structure) !== null : false;
}
