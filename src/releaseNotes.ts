export interface ArborReleaseNote {
  version: string;
  title: string;
  changes: string[];
  action?: {
    label: string;
    id: "open-settings";
  };
}

export const ARBOR_RELEASE_NOTES: readonly ArborReleaseNote[] = [
  {
    version: "0.2.9",
    title: "Shape every draft",
    changes: [
      "Output Profiles let one complete Arbor tree hold Draft, Short, Final and other versions.",
      "Include or exclude individual blocks and complete subtrees, with inherited choices shown directly on cards.",
      "Output Preview renders the active profile before export, using the same projection as the clean Markdown copy.",
      "Clean Markdown export can omit hidden blocks or preserve them as plain comments without Arbor labels."
    ],
    action: {
      label: "Open Arbor settings",
      id: "open-settings"
    }
  },
  {
    version: "0.2.8",
    title: "Take Arbor with you",
    changes: [
      "Arbor is now officially supported on phones and tablets.",
      "The compact mobile Branch Editor keeps the selected sibling column in focus with touch-friendly controls.",
      "Pinch with two fingers to adjust editor density; Tree Overview supports touch pan and pinch zoom.",
      "Mobile loading, legacy-note recovery and export limits are tuned for smaller devices."
    ],
    action: {
      label: "Open Arbor settings",
      id: "open-settings"
    }
  },
  {
    version: "0.2.7",
    title: "Make the tree your own",
    changes: [
      "Export a full Tree Overview as a PNG or a one-page PDF, with 1×, 2× or 4× quality.",
      "Theme Studio adds automatic, built-in and custom palettes with live previews.",
      "Move through branch columns with the mouse wheel, and edit an off-screen overview card without losing your place."
    ],
    action: {
      label: "Open Arbor settings",
      id: "open-settings"
    }
  },
  {
    version: "0.2.6",
    title: "Write in your direction",
    changes: [
      "Choose a left-to-right or right-to-left Arbor layout in settings.",
      "The editor, Tree Overview and keyboard navigation now mirror the selected direction while your Markdown stays unchanged."
    ],
    action: {
      label: "Open Arbor settings",
      id: "open-settings"
    }
  }
];
