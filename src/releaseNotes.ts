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
