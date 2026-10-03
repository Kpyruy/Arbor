import { normalizeBlockColor } from "../../model/blockAppearance";
import type { ArborBlockColorResolution } from "../../types";

export function syncCardColour(card: HTMLElement, resolution: ArborBlockColorResolution | null): void {
  const colour = normalizeBlockColor(resolution?.color);
  card.toggleClass("has-block-colour", colour !== null);
  card.setCssProps({ "--arbor-block-color": colour ?? "" });
  if (colour && resolution) card.dataset.colourSource = resolution.source;
  else delete card.dataset.colourSource;
}
