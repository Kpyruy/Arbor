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
    version: "0.2.5",
    title: "Tree Overview",
    changes: [
      "Explore the full note as a smooth, editable visual tree.",
      "Navigate, zoom, pan and create branches without leaving Arbor."
    ],
    action: {
      label: "Open Arbor settings",
      id: "open-settings"
    }
  }
];
