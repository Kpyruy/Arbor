import { setIcon } from "obsidian";
import type {
  ArborOutputProfile,
  ArborOutputResolution,
  ArborOutputRuleState,
  ArborOutputState,
  BranchBlockId,
  BranchTreeMetadata
} from "../../types";
import {
  FULL_OUTPUT_PROFILE_ID,
  getActiveOutputProfile,
  resolveOutputStates
} from "../../outputProfiles";
import { getBlock } from "../../model/tree";
import { extractPathLabel } from "../../utils";

export type BlockOutputMenuActionId =
  | "create-profile"
  | "include-block"
  | "exclude-block"
  | "include-subtree"
  | "exclude-subtree";

export interface BlockOutputMenuAction {
  id: BlockOutputMenuActionId;
  label: string;
  icon: string;
  state?: ArborOutputRuleState;
  scope?: "block" | "subtree";
}

export interface OutputCardPresentation {
  className: "is-output-excluded-direct" | "is-output-excluded-inherited" | null;
  badgeIcon: "eye-off" | null;
  ariaLabel: string;
}

export function getBlockOutputMenuActions(state: ArborOutputState): BlockOutputMenuAction[] {
  if (getActiveOutputProfile(state).id === FULL_OUTPUT_PROFILE_ID) {
    return [{ id: "create-profile", label: "Create output profile", icon: "list-plus" }];
  }

  return [
    { id: "include-block", label: "Include block only", icon: "eye", state: "include", scope: "block" },
    { id: "exclude-block", label: "Exclude block only", icon: "eye-off", state: "exclude", scope: "block" },
    { id: "include-subtree", label: "Include subtree", icon: "list-tree", state: "include", scope: "subtree" },
    { id: "exclude-subtree", label: "Exclude subtree", icon: "list-x", state: "exclude", scope: "subtree" }
  ];
}

export function getOutputCardPresentation(
  metadata: BranchTreeMetadata,
  state: ArborOutputState,
  blockId: BranchBlockId,
  profile: ArborOutputProfile = getActiveOutputProfile(state),
  resolutions: ReadonlyMap<BranchBlockId, ArborOutputResolution> = resolveOutputStates(metadata, profile)
): OutputCardPresentation {
  const block = getBlock(metadata, blockId);
  const blockLabel = block ? extractPathLabel(block.content) : "Block";
  const resolution = resolutions.get(blockId);

  if (!resolution || resolution.included) {
    return {
      className: null,
      badgeIcon: null,
      ariaLabel: `${blockLabel}. Included in output profile ${profile.name}.`
    };
  }

  if (resolution.source === "direct") {
    return {
      className: "is-output-excluded-direct",
      badgeIcon: "eye-off",
      ariaLabel: `${blockLabel}. Excluded directly from output profile ${profile.name}.`
    };
  }

  const ancestor = resolution.ruleBlockId ? getBlock(metadata, resolution.ruleBlockId) : null;
  const ancestorLabel = ancestor ? extractPathLabel(ancestor.content) : "an ancestor";
  return {
    className: "is-output-excluded-inherited",
    badgeIcon: "eye-off",
    ariaLabel: `${blockLabel}. Inherited exclusion from ancestor "${ancestorLabel}" in output profile ${profile.name}.`
  };
}

export function syncOutputCardPresentation(
  card: HTMLElement,
  presentation: OutputCardPresentation | null
): void {
  card.removeClass("is-output-excluded-direct", "is-output-excluded-inherited");
  const existingBadge = card.querySelector<HTMLElement>(".arbor-output-state-badge");

  if (!presentation) {
    existingBadge?.remove();
    card.removeAttribute("aria-label");
    card.removeAttribute("title");
    return;
  }

  if (presentation.className) {
    card.addClass(presentation.className);
  }
  card.setAttr("aria-label", presentation.ariaLabel);
  card.removeAttribute("title");

  if (!presentation.badgeIcon) {
    existingBadge?.remove();
    return;
  }

  const badge = existingBadge ?? card.createSpan({
    cls: "arbor-output-state-badge",
    attr: { "aria-hidden": "true" }
  });
  if (badge.dataset.icon !== presentation.badgeIcon) {
    setIcon(badge, presentation.badgeIcon);
    badge.dataset.icon = presentation.badgeIcon;
  }
}
