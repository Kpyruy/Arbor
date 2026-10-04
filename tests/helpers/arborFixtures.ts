import type { ArborOutputState, ArborSettings, BranchTreeMetadata } from "../../src/types";
import type { LoadedFileState } from "../../src/view/state/viewTypes";
import { linearizeTree } from "../../src/storage/serializer";

export function fixtureTree(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [
      { id: "root", parentId: null, order: 0, content: "Root", after: "\n\n" },
      { id: "first", parentId: "root", order: 0, content: "First", after: "\n\n" },
      { id: "second", parentId: "root", order: 1, content: "Second", after: "\n\n" },
      { id: "leaf", parentId: "first", order: 0, content: "Leaf", after: "" }
    ]
  };
}

export function fixtureOutput(active = "draft"): ArborOutputState {
  return {
    version: 1,
    activeProfileId: active,
    profiles: [{
      id: "draft",
      name: "Draft",
      rules: [{ blockId: "root", state: "exclude" }]
    }]
  };
}

export function fixtureSettings(): ArborSettings {
  return {
    layoutDirection: "ltr", overviewOrientation: "horizontal", activeThemeId: "automatic", customThemes: [],
    defaultPresentationMode: "editor", splitDirection: "vertical", cardWidth: 300,
    cardMinHeight: 120, horizontalSpacing: 20, verticalSpacing: 12, zoomLevel: 1,
    previewSnippetLength: 220, dragAndDrop: true, dimNonPathBlocks: false,
    enableCtrlWheelZoom: true, autoOpenManagedNotes: true, showBreadcrumb: true,
    showBreadcrumbFlow: true, breadcrumbLabelPreferredPrefix: "#",
    breadcrumbLabelFallback: "firstLine", liveLinearPreview: false
  };
}

export function fixtureLoaded(active = "full"): LoadedFileState {
  const metadata = fixtureTree();
  return {
    metadata,
    frontmatter: "",
    outputState: fixtureOutput(active),
    outputRaw: "",
    outputError: null,
    selectedBlockId: "first",
    staleMetadata: null,
    origin: "metadata",
    linearized: linearizeTree(metadata)
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
