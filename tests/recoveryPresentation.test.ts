import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";
import { DraftRecoveryStore } from "../src/view/editor/DraftRecoveryStore";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Recovery presentation", () => {
  it("keeps the chosen comparison layout concise without changing Restore behavior", async () => {
    const h = await ingestionHarness();
    try {
      const store = (h.view.editor as unknown as { recovery: DraftRecoveryStore }).recovery;
      const view = h.view as unknown as { plugin: { draftRecoveryStore: DraftRecoveryStore }; showDraftRecovery(): void };
      view.plugin.draftRecoveryStore = store;
      store.retain({ filePath: h.view.file!.path, blockId: "first", draftId: "internal-session-secret",
        originalContent: "First", value: "# Updated branch\n\nRecovered text" });
      view.showDraftRecovery();
      const dialog = h.root.querySelector(".arbor-recovery-modal");
      expect(dialog).not.toBeNull();
      expect(dialog!.querySelector("h4")).toBeNull();
      expect(dialog!.querySelector(".arbor-recovery-summary")).toBeNull();
      expect(dialog!.textContent).not.toContain("internal-session-secret");
      expect(dialog!.querySelectorAll(".arbor-recovery-pane label")).toHaveLength(2);
      expect(Array.from(dialog!.querySelectorAll<HTMLTextAreaElement>("textarea"), t => t.value)).toEqual(["First", "# Updated branch\n\nRecovered text"]);
      const restore = dialog!.querySelector<HTMLButtonElement>("button.mod-cta")!;
      expect(restore.textContent).toBe("Restore");
      expect(h.win.document.activeElement).toBe(restore);
      const groups = dialog!.querySelectorAll(".arbor-recovery-action-group");
      expect(groups).toHaveLength(2);
      expect(Array.from(groups[0].querySelectorAll("button"), b => b.textContent)).toEqual(["Later", "Discard"]);
      expect(Array.from(groups[1].querySelectorAll("button"), b => b.textContent)).toEqual(["Copy", "Restore"]);
      expect(dialog!.querySelector(".arbor-recovery-footer")).toBeNull();
      restore.click();
      expect(h.view.editor.getSession()?.value).toBe("# Updated branch\n\nRecovered text");
      expect(h.writes).toHaveLength(0);
      expect(store.getForFile(h.view.file!.path)).toHaveLength(1);
    } finally { await h.view.onClose(); }
  });

  it("Later leaves every draft available without saving or discarding it", async () => {
    const h = await ingestionHarness();
    try {
      const store = (h.view.editor as unknown as { recovery: DraftRecoveryStore }).recovery;
      const view = h.view as unknown as { plugin: { draftRecoveryStore: DraftRecoveryStore }; showDraftRecovery(): void };
      view.plugin.draftRecoveryStore = store;
      for (const id of ["one", "two"]) store.retain({ filePath: h.view.file!.path, blockId: "first", draftId: id, originalContent: "First", value: id });
      view.showDraftRecovery();
      const later = h.root.querySelector<HTMLButtonElement>(".arbor-recovery-action-group button")!;
      expect(later).not.toBeNull();
      expect(later.textContent).toBe("Later");
      later.click();
      expect(h.root.querySelector(".arbor-recovery-modal")).toBeNull();
      expect(store.getForFile(h.view.file!.path).map(d => d.value)).toEqual(["one", "two"]);
      expect(h.writes).toHaveLength(0);
    } finally { await h.view.onClose(); }
  });
});
