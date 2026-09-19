import type { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { buildCleanExportDocument, type CleanExportOptions } from "../src/storage/cleanExport";
import {
  ExportController,
  type ExportPort,
  type OverviewSnapshot
} from "../src/view/export/ExportController";
import { deferred, fixtureLoaded, fixtureOutput, fixtureTree } from "./helpers/arborFixtures";

const cleanOptions: CleanExportOptions = { frontmatter: "keep", excluded: "omit" };
const treeOptions = { format: "png" as const, quality: "standard" as const };

function file(path: string): TFile {
  // The controller only observes identity, path, and name; Obsidian has no test runtime constructor.
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
  return { path, name: path.split("/").at(-1) ?? path } as unknown as TFile;
}

function snapshot(dispose = vi.fn()): OverviewSnapshot {
  return { frame: {} as HTMLElement, width: 800, height: 600, dispose };
}

function createPort(): ExportPort {
  return {
    getFile: () => null,
    getState: () => null,
    getSession: () => null,
    clearBlurCommitTimer: vi.fn(),
    commitEditIfNeeded: vi.fn<ExportPort["commitEditIfNeeded"]>(async () => undefined),
    chooseClean: vi.fn<ExportPort["chooseClean"]>(async () => null),
    chooseTree: vi.fn<ExportPort["chooseTree"]>(async () => null),
    createCleanCopy: vi.fn<ExportPort["createCleanCopy"]>(),
    openMarkdown: vi.fn<ExportPort["openMarkdown"]>(),
    createTreeExport: vi.fn<ExportPort["createTreeExport"]>(),
    snapshot: vi.fn<ExportPort["snapshot"]>(),
    encodePng: vi.fn<ExportPort["encodePng"]>(async () => null),
    notify: vi.fn(),
    reportError: vi.fn()
  };
}

describe("ExportController", () => {
  it("does not open the clean export dialog without a loaded file", async () => {
    const port = createPort();

    await new ExportController(port).exportCleanCopy();

    expect(port.chooseClean).not.toHaveBeenCalled();
    expect(port.createCleanCopy).not.toHaveBeenCalled();
  });

  it("does not create a clean copy when its open dialog is cancelled", async () => {
    const port = createPort();
    port.getFile = () => file("test.md");
    port.getState = () => fixtureLoaded();
    port.chooseClean = vi.fn(async () => null);

    await new ExportController(port).exportCleanCopy();

    expect(port.chooseClean).toHaveBeenCalledOnce();
    expect(port.createCleanCopy).not.toHaveBeenCalled();
  });

  it("exports the captured draft without mutating the original tree", async () => {
    const port = createPort();
    const source = file("test.md");
    const state = fixtureLoaded();
    const original = structuredClone(state.metadata);
    let contents = "";
    port.getFile = () => source;
    port.getState = () => state;
    port.getSession = () => ({ blockId: "first", originalContent: "First", value: "Draft content", autofocus: false, origin: "card" });
    port.chooseClean = async () => cleanOptions;
    port.createCleanCopy = vi.fn<ExportPort["createCleanCopy"]>(async (_source, value) => {
      contents = value;
      return file("test — export.md");
    });

    await new ExportController(port).exportCleanCopy();

    expect(contents).toContain("Draft content");
    expect(contents).not.toContain("First\n\n");
    expect(state.metadata).toEqual(original);
    expect(port.openMarkdown).toHaveBeenCalledWith(file("test — export.md"));
  });

  it("does not create a clean copy after the source file changes during its dialog", async () => {
    const port = createPort();
    const source = file("a.md");
    const changed = file("b.md");
    const choice = deferred<CleanExportOptions | null>();
    let current = source;
    port.getFile = () => current;
    port.getState = () => fixtureLoaded();
    port.chooseClean = () => choice.promise;
    const exportPromise = new ExportController(port).exportCleanCopy();

    current = changed;
    choice.resolve(cleanOptions);
    await exportPromise;

    expect(port.createCleanCopy).not.toHaveBeenCalled();
  });

  it("uses clean-export inputs captured before its dialog", async () => {
    const port = createPort();
    const source = file("test.md");
    const state = fixtureLoaded();
    const choice = deferred<CleanExportOptions | null>();
    const expected = buildCleanExportDocument(
      state.frontmatter,
      state.metadata,
      state.outputState,
      cleanOptions
    );
    let contents = "";
    port.getFile = () => source;
    port.getState = () => state;
    port.chooseClean = () => choice.promise;
    port.createCleanCopy = vi.fn<ExportPort["createCleanCopy"]>(async (_source, value) => {
      contents = value;
      return file("test — export.md");
    });

    const exportPromise = new ExportController(port).exportCleanCopy();
    await Promise.resolve();
    state.frontmatter = "--- changed: true ---\n";
    state.metadata = fixtureTree();
    state.metadata.blocks[0].content = "Changed root";
    state.outputState = fixtureOutput("changed");
    choice.resolve(cleanOptions);
    await exportPromise;

    expect(contents).toBe(expected);
    expect(port.commitEditIfNeeded).not.toHaveBeenCalled();
  });

  it("disposes a snapshot after an encoder failure and permits retry", async () => {
    const port = createPort();
    const source = file("test.md");
    const failedDispose = vi.fn();
    const retryDispose = vi.fn();
    let attempts = 0;
    port.getFile = () => source;
    port.getState = () => fixtureLoaded();
    port.chooseTree = async () => treeOptions;
    port.snapshot = vi.fn(async () => attempts++ === 0 ? snapshot(failedDispose) : snapshot(retryDispose));
    port.encodePng = vi.fn(async () => {
      if (attempts === 1) throw new Error("encode failed");
      return new Uint8Array([1, 2, 3]);
    });
    port.createTreeExport = vi.fn(async () => file("test — Tree Overview.png"));

    const controller = new ExportController(port);
    await controller.exportTreeOverview();
    await controller.exportTreeOverview();

    expect(failedDispose).toHaveBeenCalledOnce();
    expect(retryDispose).toHaveBeenCalledOnce();
    expect(port.reportError).toHaveBeenCalledWith("Arbor could not export the tree overview.", expect.any(Error));
    expect(port.createTreeExport).toHaveBeenCalledOnce();
  });

  it("reports an oversized tree and disposes the created snapshot", async () => {
    const port = createPort();
    const dispose = vi.fn();
    port.getFile = () => file("test.md");
    port.getState = () => fixtureLoaded();
    port.chooseTree = async () => ({ format: "png", quality: "ultra" });
    port.snapshot = async () => ({ frame: {} as HTMLElement, width: 5_000, height: 5_000, dispose });

    await new ExportController(port).exportTreeOverview();

    expect(port.notify).toHaveBeenCalledWith("This tree overview is too large for the selected quality. Choose a lower quality and try again.");
    expect(port.encodePng).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes a snapshot after export creation fails", async () => {
    const port = createPort();
    const dispose = vi.fn();
    port.getFile = () => file("test.md");
    port.getState = () => fixtureLoaded();
    port.chooseTree = async () => treeOptions;
    port.snapshot = async () => snapshot(dispose);
    port.encodePng = async () => new Uint8Array([1]);
    port.createTreeExport = async () => { throw new Error("create failed"); };

    await new ExportController(port).exportTreeOverview();

    expect(dispose).toHaveBeenCalledOnce();
    expect(port.reportError).toHaveBeenCalledWith("Arbor could not export the tree overview.", expect.any(Error));
  });

  it("allows only one active tree export when two dialogs complete together", async () => {
    const port = createPort();
    const firstChoice = deferred<typeof treeOptions | null>();
    const secondChoice = deferred<typeof treeOptions | null>();
    const encode = deferred<Uint8Array | null>();
    let dialogs = 0;
    port.getFile = () => file("test.md");
    port.getState = () => fixtureLoaded();
    port.chooseTree = () => ++dialogs === 1 ? firstChoice.promise : secondChoice.promise;
    port.snapshot = vi.fn<ExportPort["snapshot"]>(async () => snapshot());
    port.encodePng = vi.fn<ExportPort["encodePng"]>(() => encode.promise);
    port.createTreeExport = vi.fn<ExportPort["createTreeExport"]>(async () => file("test — Tree Overview.png"));
    const controller = new ExportController(port);
    const first = controller.exportTreeOverview();
    const second = controller.exportTreeOverview();

    firstChoice.resolve(treeOptions);
    secondChoice.resolve(treeOptions);
    await Promise.resolve();
    await Promise.resolve();
    expect(port.snapshot).toHaveBeenCalledOnce();
    encode.resolve(new Uint8Array([1]));
    await Promise.all([first, second]);

    expect(port.createTreeExport).toHaveBeenCalledOnce();
  });
});
