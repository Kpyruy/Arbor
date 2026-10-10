import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";
import type { ArborView } from "../../src/view/ArborView";
import type { DocumentController } from "../../src/view/state/DocumentController";
import type { BlockEditorController } from "../../src/view/editor/BlockEditorController";
import type { BranchRenderer } from "../../src/view/branch/BranchRenderer";
import type { TreeOverviewController } from "../../src/view/overview/TreeOverviewController";
import type { ContentIngestionController } from "../../src/view/ingestion/ContentIngestionController";
import type { ArborOverviewOrientation, ArborPresentationMode } from "../../src/types";
import type { BranchViewContext } from "../../src/view/state/viewTypes";
import { buildBranchDocument } from "../../src/storage/document";
import { loadImportedBranchDocument } from "../../src/storage/reconcile";
import { linearizeTree } from "../../src/storage/serializer";
import { buildColumnModels } from "../../src/model/tree";
import { buildViewContext } from "../../src/view/state/viewModel";
import { fixtureOutput, fixtureSettings, fixtureTree } from "./arborFixtures";

interface DomModule { Window: new () => Window & typeof globalThis; }
const requireModule = createRequire(import.meta.url);
const domModule = requireModule(process.env.ARBOR_TEST_DOM ?? "happy-dom") as DomModule;

interface TestMenuItem {
  title: string;
  disabled: boolean;
  action: () => unknown;
}
interface TestCommand { id: string; checkCallback?: (checking: boolean) => boolean; }
export interface IngestionView extends Omit<ArborView, "render"> {
  documentController: DocumentController;
  editor: BlockEditorController;
  branchRenderer: BranchRenderer;
  overview: TreeOverviewController;
  ingestion: ContentIngestionController;
  presentationMode: ArborPresentationMode;
  viewContext: BranchViewContext | null;
  ensureShell(): void;
  renderNow(): Promise<void>;
  render(): void;
  buildBlockMenu(id: string): { items: TestMenuItem[] };
  teardownShell(): void;
}

let loaded: {
  ArborView: new (leaf: unknown, plugin: unknown) => IngestionView;
  ArborPlugin: new () => { registerCommands(): void; commands: TestCommand[]; app: unknown };
  TFile: new (path: string) => NonNullable<ArborView["file"]>;
};

export async function loadIngestionView(): Promise<void> {
  const bundled = await build({
    absWorkingDir: process.cwd(),
    stdin: { contents: 'export { ArborView } from "./src/view/ArborView"; export { default as ArborPlugin } from "./src/main"; export { TFile } from "obsidian";', loader: "ts", resolveDir: process.cwd() },
    bundle: true, format: "esm", platform: "node", write: false,
    plugins: [{
      name: "ingestion-host",
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
        builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ loader: "js", contents: `
          export class App {}
          export class Plugin { commands = []; addCommand(command) { this.commands.push(command); } }
          export class PluginSettingTab {}
          export class Setting {}
          export class TAbstractFile {}
          export class TFolder {}
          export const normalizePath = value => value;
          export class TFile { constructor(path) { this.path = path; this.basename = "Receiver"; this.extension = "md"; } }
          export class WorkspaceLeaf {}
          export class FileView {
            constructor(leaf) { this.app = leaf.app; this.contentEl = leaf.root; this.leaf = leaf; }
            register() {} registerDomEvent() {} onClose() { return Promise.resolve(); }
          }
          export class MarkdownView {}
          export class Modal { constructor(app) { this.contentEl = app.root.createDiv(); } open() {} close() { this.contentEl.remove(); } }
          export class ButtonComponent {
            constructor(root) { this.buttonEl = root.createEl("button"); }
            setButtonText(text) { this.buttonEl.textContent = text; return this; }
            setDisabled(value) { this.buttonEl.disabled = value; return this; }
            onClick(action) { this.buttonEl.addEventListener("click", action); return this; }
          }
          export class Menu {
            items = [];
            addItem(configure) {
              const item = { title: "", disabled: false, action: () => {},
                setTitle(value) { this.title = value; return this; },
                setIcon() { return this; }, setDisabled(value) { this.disabled = value; return this; },
                setChecked() { return this; }, setWarning() { return this; }, onClick(action) { this.action = action; return this; } };
              configure(item); this.items.push(item); return this;
            }
            addSeparator() { return this; } showAtPosition() {} showAtMouseEvent() {}
          }
          export class Notice { constructor(message) { globalThis.__ingestionNotices.push(message); } }
          export const MarkdownRenderer = { render: async (app, markdown, target) => {
            if (app.renderMarkdown) return app.renderMarkdown(markdown, target);
            target.createEl("a", { cls: "internal-link", text: markdown, attr: { "data-href": "Book.pdf#page=7" } });
          } };
          export const Keymap = { isModEvent: () => false };
          export const Platform = {};
          export const setIcon = () => undefined;
          export const parseLinktext = text => ({ path: text.split("#")[0], subpath: text.includes("#") ? "#" + text.split("#")[1] : "" });
          export const resolveSubpath = () => null;
        ` }));
        builder.onResolve({ filter: /^html-to-image$/ }, () => ({ path: "image", namespace: "image" }));
        builder.onLoad({ filter: /.*/, namespace: "image" }, () => ({ loader: "js", contents: "export const toBlob = async () => null;" }));
      }
    }]
  });
  const modulePath = join(await mkdtemp(join(tmpdir(), "arbor-ingestion-dom-")), "view.mjs");
  await writeFile(modulePath, bundled.outputFiles[0].text);
  loaded = await import(pathToFileURL(modulePath).href) as typeof loaded;
}

function installElementHelpers(win: Window & typeof globalThis): void {
  Object.defineProperty(win, "DragEvent", { configurable: true, value: class extends win.MouseEvent {
    readonly dataTransfer: DataTransfer | null;
    constructor(type: string, options: DragEventInit = {}) {
      super(type, options);
      this.dataTransfer = options.dataTransfer ?? null;
    }
  } });
  const prototype = win.Element.prototype;
  Object.assign(prototype, {
    instanceOf(this: Element, constructor: typeof Element) { return this instanceof constructor; },
    createEl(this: Element, tag: string, options: { cls?: string; text?: string; attr?: Record<string, string>; prepend?: boolean } = {}) {
      const element = this.ownerDocument.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text) element.textContent = options.text;
      Object.entries(options.attr ?? {}).forEach(([key, value]) => element.setAttribute(key, value));
      if (options.prepend) this.prepend(element); else this.append(element);
      return element;
    },
    createDiv(this: HTMLElement, options: object) { return this.createEl("div", options); },
    createSpan(this: HTMLElement, options: object) { return this.createEl("span", options); },
    createSvg(this: HTMLElement, tag: string, options: { cls?: string; attr?: Record<string, string>; prepend?: boolean } = {}) {
      const element = this.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
      if (options.cls) element.setAttribute("class", options.cls);
      Object.entries(options.attr ?? {}).forEach(([key, value]) => element.setAttribute(key, value));
      if (options.prepend) this.prepend(element); else this.append(element);
      return element;
    },
    empty(this: Element) { this.replaceChildren(); },
    setText(this: Element, text: string) { this.textContent = text; },
    addClass(this: Element, ...names: string[]) { this.classList.add(...names); },
    removeClass(this: Element, ...names: string[]) { this.classList.remove(...names); },
    hasClass(this: Element, name: string) { return this.classList.contains(name); },
    toggleClass(this: Element, name: string, value: boolean) { this.classList.toggle(name, value); },
    setCssProps(this: HTMLElement, values: Record<string, string>) { Object.entries(values).forEach(([key, value]) => this.style.setProperty(key, value)); },
    setCssStyles(this: HTMLElement, values: Record<string, string>) { Object.assign(this.style, values); },
    setAttr(this: Element, key: string, value: string) { this.setAttribute(key, value); },
    getAttr(this: Element, key: string) { return this.getAttribute(key); }
  });
  Object.defineProperty(prototype, "win", { configurable: true, get(this: Element) { return this.ownerDocument.defaultView; } });
  Object.assign(win.HTMLElement.prototype, { scrollIntoView() {}, scrollTo() {}, scrollBy() {} });
}

export async function ingestionHarness(mode: "editor" | "overview" = "editor", orientation: ArborOverviewOrientation = "horizontal") {
  const win = new domModule.Window();
  installElementHelpers(win);
  for (const key of ["window", "document", "HTMLElement", "HTMLTextAreaElement", "Element", "Node", "Event", "MouseEvent", "ResizeObserver", "navigator"] as const) {
    vi.stubGlobal(key, key === "window" ? win : win[key]);
  }
  const notices: string[] = [];
  vi.stubGlobal("__ingestionNotices", notices);
  const root = win.document.body.createDiv({ cls: "arbor-view" });
  const settings = fixtureSettings();
  settings.overviewOrientation = orientation;
  const tree = fixtureTree();
  tree.blocks[1].appearance = { cardColor: "#123456", branchColor: "#abcdef" };
  let disk = buildBranchDocument("", linearizeTree(tree).body, tree, fixtureOutput());
  const writes: string[] = [];
  const attachments: string[] = [];
  const links: string[] = [];
  const clipboard = { readText: async () => "clipboard", writeText: async (text: string) => { links.push(text); } };
  Object.defineProperty(win.navigator, "clipboard", { value: clipboard, configurable: true });
  const app = {
    root, dragManager: { draggable: null as unknown },
    renderMarkdown: null as null | ((markdown: string, target: HTMLElement) => void | Promise<void>),
    vault: { read: async () => disk, cachedRead: async () => disk, process: async (_file: unknown, transform: (text: string) => string) => { disk = transform(disk); writes.push(disk); return disk; },
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      createBinary: async (path: string) => { attachments.push(path); return new loaded.TFile(path); } },
    fileManager: { generateMarkdownLink: (file: { path: string }, _source: string, subpath?: string, alias?: string) => `[[${file.path}${subpath ?? ""}${alias ? "|" + alias : ""}]]`, getAvailablePathForAttachment: async (name: string) => name },
    metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null },
    workspace: { openLinkText: async (link: string) => { links.push(link); } }
  };
  const files = new Map<string, NonNullable<ArborView["file"]>>();
  const plugin = {
    settings, markOwnWrite() {}, rememberManagedNote() {},
    getArborThemeVariables: () => ({}), getThemeVariables: () => ({}),
    getEffectiveThemeState: () => ({ activeThemeId: "automatic", customThemes: [] }),
    draftRecoveryStore: undefined
  };
  const view = new loaded.ArborView({ app, root }, plugin);
  view.file = new loaded.TFile("Receiver.md");
  files.set("Receiver.md", view.file);
  let renderRequests = 0;
  view.render = () => { renderRequests++; };
  const state = await view.documentController.readLoadedFileState(view.file, "first");
  view.documentController.replaceLoadedState(state.state);
  view.presentationMode = mode;
  view.ensureShell();
  const render = async () => {
    const current = view.documentController.getState()!;
    const context = buildViewContext(current.metadata, current.selectedBlockId, current.outputState, "", settings);
    view.viewContext = context;
    if (mode === "editor") await view.branchRenderer.syncColumns(buildColumnModels(current.metadata, current.selectedBlockId, 220), context);
    else await view.overview.syncTreeOverview();
  };
  await render();
  const card = (id = "first") => root.querySelector<HTMLElement>(`.${mode === "editor" ? "arbor-card" : "arbor-overview-card"}[data-block-id="${id}"]`)!;
  const transfer = (plain = "quote", type = "text/plain") => {
    const data = new Map([[type, plain]]);
    return { types: [...data.keys()], files: [] as File[], items: [] as DataTransferItem[], getData: (mime: string) => data.get(mime) ?? "", setData: (mime: string, value: string) => { data.set(mime, value); }, setDragImage() {}, dropEffect: "", effectAllowed: "" };
  };
  const event = (name: string, data = transfer()) => {
    const gesture = new win.Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(gesture, name === "paste" ? "clipboardData" : "dataTransfer", { value: data });
    return gesture;
  };
  const settle = async () => { for (let index = 0; index < 16; index++) await new Promise(resolve => setTimeout(resolve, 0)); };
  const commandPlugin = new loaded.ArborPlugin();
  commandPlugin.app = { workspace: { getActiveViewOfType: (constructor: unknown) => constructor === loaded.ArborView ? view : null } };
  commandPlugin.registerCommands();
  return { view, win, root, app, clipboard, notices, writes, attachments, links, settings, card, transfer, event, render, settle, commandPlugin,
    addFile: (path: string) => { const file = new loaded.TFile(path); files.set(path, file); return file; },
    content: (id = "first") => loadImportedBranchDocument(disk).metadata.blocks.find(block => block.id === id)?.content,
    renderRequests: () => renderRequests };
}
