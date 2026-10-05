interface VisualObservation {
  error?: number;
  separation?: number;
  sameEditor?: boolean;
  sameSession?: boolean;
  focused?: boolean;
  renders?: number;
  anchorError?: number;
  growth?: boolean;
  caret?: number[];
  delta?: number;
  frames?: { same: boolean; rebinding: boolean; animations: unknown[]; activeAnimations?: { name?: string }[] }[];
  svg?: string;
  label?: unknown;
  align?: string;
  fade?: string;
  mask?: string;
}

export function checkVisualFixObservations(suite: string, observations: VisualObservation[]): number {
  let checks = 0;
  const check = (condition: unknown, message: string) => {
    if (!condition) throw Error(`${suite}: ${message}`);
    checks += 1;
  };
  check(observations.length > 0, "native observations must exist");
  for (const observation of observations) {
    if (suite === "chain") check((observation.error ?? Infinity) < 3, "ordinary opening must center a fitting narrow chain");
    if (suite === "editor") {
      check((observation.separation ?? -1) >= 14, "editing card must stay separated from its child");
      check(observation.sameEditor && observation.sameSession, "geometry reflow must retain the editor and draft session");
      check(observation.focused, "inline editor must retain focus");
      check(observation.renders === 0, "typing must not rerender Markdown");
      check((observation.anchorError ?? Infinity) < 2, "connectors must stay anchored to the reflowed cards");
      if (observation.growth) check(observation.caret?.[0] === 3 && observation.caret[1] === 7, "typing reflow must retain the caret selection");
    }
    if (suite === "branch") {
      check((observation.delta ?? Infinity) < 2, "common parent must not jump during child-only navigation");
      check(observation.frames?.every(frame => frame.same && !frame.rebinding && frame.animations.length === 0), "parent identity and animation state must stay stable");
      check(observation.frames?.some(frame => frame.activeAnimations?.some(animation => animation.name === "arbor-card-focus-enter")), "newly selected children must retain their intended entrance animation");
    }
    if (suite === "icons") check(observation.svg && !observation.svg.includes("lucide-check"), "each layout row must have a real layout icon");
    if (suite === "profile") check(observation.label && observation.align === "start", "bounded profile label must start at its logical beginning");
    if (suite === "fade") check(observation.mask?.includes("linear-gradient") && !observation.fade?.includes("linear-gradient"), "preview must fade its content rather than paint a mismatched rectangle");
  }
  return checks;
}
