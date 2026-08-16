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
