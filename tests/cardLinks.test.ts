import { describe, expect, it, vi } from "vitest";
import { CardLinkController } from "../src/view/navigation/CardLinkController";

function makeLinkEvent(options: {
  internal: boolean; href: string; dataHref?: string;
  type?: "click" | "auxclick"; button?: number; detail?: number;
  defaultPrevented?: boolean; inside?: boolean; embedded?: boolean; target?: "anchor" | "text" | "other";
}) {
  const content = {};
  const anchor = {
    nodeType: 1,
    classList: { contains: (name: string) => name === "internal-link" && options.internal },
    getAttribute: (name: string) => name === "data-href" ? options.dataHref ?? null
      : name === "href" ? options.href : null,
    closest: (selector: string): unknown => selector === "a" ? anchor
      : selector === ".internal-embed" ? options.embedded ? {} : null : content
  };
  const textNode = { nodeType: 3, parentElement: anchor };
  const other = { nodeType: 1, closest: () => null };
  const card = {
    contains: (node: unknown) => options.inside !== false && node === content
  } as unknown as HTMLElement;
  const event = {
    type: options.type ?? "click", button: options.button ?? 0, detail: options.detail ?? 1,
    defaultPrevented: options.defaultPrevented ?? false,
    target: options.target === "text" ? textNode : options.target === "other" ? other : anchor,
    currentTarget: card, preventDefault: vi.fn(), stopPropagation: vi.fn()
  } as unknown as MouseEvent;
  return { card, event };
}

function makeController(overrides: Partial<{
  getSourcePath: () => string;
  paneForEvent: (event: MouseEvent) => "tab" | "split" | "window" | false;
  openInternal: (linktext: string, sourcePath: string, pane: "tab" | "split" | "window" | false) => Promise<void>;
  reportOpenError: (error: unknown) => void;
  selectLocalBlock: (blockId: string) => boolean;
}> = {}) {
  const openInternal = vi.fn(async () => undefined);
  const reportOpenError = overrides.reportOpenError ?? vi.fn();
  return {
    controller: new CardLinkController({
      getSourcePath: overrides.getSourcePath ?? (() => "Folder/Source.md"),
      paneForEvent: overrides.paneForEvent ?? (() => false),
      openInternal: overrides.openInternal ?? openInternal,
      selectLocalBlock: overrides.selectLocalBlock ?? (() => false),
      reportOpenError
    }),
    openInternal,
    reportOpenError
  };
}

describe("CardLinkController", () => {
  it("selects a copied same-note block link synchronously without native protocol navigation", () => {
    let selected = "parent";
    const { controller, openInternal } = makeController({
      selectLocalBlock: (id) => { selected = id; return true; }
    });
    const { card, event } = makeLinkEvent({
      internal: false,
      href: "obsidian://arbor?file=Folder%2FSource.md&block=other-branch-child"
    });
    expect(controller.handleActivation(event, card)).toBe(true);
    expect(selected).toBe("other-branch-child");
    expect(Reflect.get(event, "preventDefault")).toHaveBeenCalledOnce();
    expect(Reflect.get(event, "stopPropagation")).toHaveBeenCalledOnce();
    expect(openInternal).not.toHaveBeenCalled();
  });

  it("consumes the second click without selecting a local block twice", () => {
    let selections = 0;
    const { controller } = makeController({ selectLocalBlock: () => { selections++; return true; } });
    const href = "obsidian://arbor?file=Folder%2FSource.md&block=child";
    const first = makeLinkEvent({ internal: false, href });
    const second = makeLinkEvent({ internal: false, href, detail: 2 });
    controller.handleActivation(first.event, first.card);
    controller.handleActivation(second.event, second.card);
    expect(selections).toBe(1);
    expect(Reflect.get(second.event, "preventDefault")).toHaveBeenCalledOnce();
  });

  it("handles a keyboard-generated local click using the current source path", () => {
    let path = "Before.md";
    let selected = "parent";
    const { controller } = makeController({
      getSourcePath: () => path,
      selectLocalBlock: (id) => { selected = id; return true; }
    });
    path = "Папка/Нотатка.md";
    const { card, event } = makeLinkEvent({
      internal: false, detail: 0,
      href: "obsidian://arbor?file=%D0%9F%D0%B0%D0%BF%D0%BA%D0%B0%2F%D0%9D%D0%BE%D1%82%D0%B0%D1%82%D0%BA%D0%B0.md&block=child"
    });
    controller.handleActivation(event, card);
    expect(selected).toBe("child");
    expect(Reflect.get(event, "preventDefault")).toHaveBeenCalledOnce();
  });

  it.each([
    { type: "click" as const, button: 0, defaultPrevented: true },
    { type: "auxclick" as const, button: 1, defaultPrevented: false }
  ])("preserves owned or middle-click local links: %j", (activation) => {
    let selected = "parent";
    const { controller } = makeController({ selectLocalBlock: (id) => { selected = id; return true; } });
    const { card, event } = makeLinkEvent({
      internal: false, href: "obsidian://arbor?file=Folder%2FSource.md&block=child", ...activation
    });
    controller.handleActivation(event, card);
    expect(selected).toBe("parent");
    expect(Reflect.get(event, "preventDefault")).not.toHaveBeenCalled();
  });

  it("reports a local selection error without starting a second native navigation", () => {
    const error = new Error("selection failed");
    const reportOpenError = vi.fn();
    const { controller } = makeController({
      selectLocalBlock: () => { throw error; }, reportOpenError
    });
    const { card, event } = makeLinkEvent({
      internal: false, href: "obsidian://arbor?file=Folder%2FSource.md&block=child"
    });
    expect(() => controller.handleActivation(event, card)).not.toThrow();
    expect(reportOpenError).toHaveBeenCalledExactlyOnceWith(error);
    expect(Reflect.get(event, "preventDefault")).toHaveBeenCalledOnce();
  });

  it.each([
    "obsidian://arbor?file=Folder%2FOther.md&block=child",
    "obsidian://arbor?file=Folder%2FSource.md&block=child&vault=Other",
    "obsidian://arbor?file=Folder%2FSource.md",
    "obsidian://arbor?file=Folder%2FSource.md&block=",
    "obsidian://open?file=Folder%2FSource.md&block=child",
    "https://arbor?file=Folder%2FSource.md&block=child"
  ])("leaves a non-local or incomplete protocol URL native: %s", (href) => {
    let selected = "parent";
    const { controller } = makeController({ selectLocalBlock: (id) => { selected = id; return true; } });
    const { card, event } = makeLinkEvent({ internal: false, href });
    controller.handleActivation(event, card);
    expect(selected).toBe("parent");
    expect(Reflect.get(event, "preventDefault")).not.toHaveBeenCalled();
  });

  it("leaves a missing local block to the normal protocol error handler", () => {
    const { controller } = makeController({ selectLocalBlock: () => false });
    const { card, event } = makeLinkEvent({
      internal: false, href: "obsidian://arbor?file=Folder%2FSource.md&block=missing"
    });
    controller.handleActivation(event, card);
    expect(Reflect.get(event, "preventDefault")).not.toHaveBeenCalled();
  });

  it.each(["tab", "split", "window"] as const)("does not intercept local protocol links with pane modifier %s", (pane) => {
    let selected = "parent";
    const { controller } = makeController({
      paneForEvent: () => pane,
      selectLocalBlock: (id) => { selected = id; return true; }
    });
    const { card, event } = makeLinkEvent({
      internal: false, href: "obsidian://arbor?file=Folder%2FSource.md&block=child"
    });
    controller.handleActivation(event, card);
    expect(selected).toBe("parent");
    expect(Reflect.get(event, "preventDefault")).not.toHaveBeenCalled();
  });

  it("opens an internal destination once with source context and its full subpath", () => {
    const { controller, openInternal } = makeController();
    const { card, event } = makeLinkEvent({
      internal: true,
      href: "../PDF/Book.pdf#page=7&selection=0,10,20",
      dataHref: "../PDF/Book.pdf#page=7&selection=0,10,20"
    });
    expect(controller.handleActivation(event, card)).toBe(true);
    expect(openInternal).toHaveBeenCalledExactlyOnceWith(
      "../PDF/Book.pdf#page=7&selection=0,10,20", "Folder/Source.md", false
    );
    expect(Reflect.get(event, "preventDefault")).toHaveBeenCalledOnce();
  });

  it.each([
    "Note", "folder/Note", "Note#Heading", "Note#^block",
    "Folder/Name with spaces.md", "../Sibling.md", "PDF.pdf#page=2&annotation=abc"
  ])("preserves the raw internal linktext %s", (linktext) => {
    const { controller, openInternal } = makeController();
    const { card, event } = makeLinkEvent({ internal: true, href: "https://host/absolute/path", dataHref: linktext });
    controller.handleActivation(event, card);
    expect(openInternal).toHaveBeenCalledExactlyOnceWith(linktext, "Folder/Source.md", false);
  });

  it.each(["https://example.org", "obsidian://arbor?note=Note"]) (
    "leaves non-internal destination %s to its owner", (href) => {
      const { controller, openInternal } = makeController();
      const { card, event } = makeLinkEvent({ internal: false, href });
      expect(controller.handleActivation(event, card)).toBe(true);
      expect(openInternal).not.toHaveBeenCalled();
      expect(Reflect.get(event, "preventDefault")).not.toHaveBeenCalled();
    }
  );

  it("returns false for a non-anchor or a link outside rendered card content", () => {
    const { controller, openInternal } = makeController();
    const outside = makeLinkEvent({ internal: true, href: "Note", inside: false });
    const nonAnchor = makeLinkEvent({ internal: true, href: "Note", target: "other" });
    expect(controller.handleActivation(outside.event, outside.card)).toBe(false);
    expect(controller.handleActivation(nonAnchor.event, nonAnchor.card)).toBe(false);
    expect(openInternal).not.toHaveBeenCalled();
  });

  it("claims an already-prevented internal link without reopening it", () => {
    const { controller, openInternal } = makeController();
    const { card, event } = makeLinkEvent({ internal: true, href: "Note", defaultPrevented: true });
    expect(controller.handleActivation(event, card)).toBe(true);
    expect(openInternal).not.toHaveBeenCalled();
  });

  it("leaves internal embed navigation to its own owner", () => {
    const { controller, openInternal } = makeController();
    const { card, event } = makeLinkEvent({ internal: true, href: "Note", embedded: true });
    expect(controller.handleActivation(event, card)).toBe(true);
    expect(openInternal).not.toHaveBeenCalled();
    expect(Reflect.get(event, "preventDefault")).not.toHaveBeenCalled();
  });

  it("reports a missing source path without attempting to open", () => {
    const reportOpenError = vi.fn();
    const { controller, openInternal } = makeController({ getSourcePath: () => "", reportOpenError });
    const { card, event } = makeLinkEvent({ internal: true, href: "Note" });
    expect(controller.handleActivation(event, card)).toBe(true);
    expect(openInternal).not.toHaveBeenCalled();
    expect(reportOpenError).toHaveBeenCalledExactlyOnceWith(new Error("Missing source path for Arbor link"));
  });

  it("opens a middle-click once and ignores other buttons", () => {
    const { controller, openInternal } = makeController();
    const middle = makeLinkEvent({ internal: true, href: "Note", type: "auxclick", button: 1 });
    const other = makeLinkEvent({ internal: true, href: "Note", type: "auxclick", button: 2 });
    expect(controller.handleActivation(middle.event, middle.card)).toBe(true);
    expect(controller.handleActivation(other.event, other.card)).toBe(true);
    expect(openInternal).toHaveBeenCalledExactlyOnceWith("Note", "Folder/Source.md", false);
  });

  it("does not open again for the second click of a double-click", () => {
    const { controller, openInternal } = makeController();
    const first = makeLinkEvent({ internal: true, href: "Note", detail: 1 });
    const second = makeLinkEvent({ internal: true, href: "Note", detail: 2 });
    controller.handleActivation(first.event, first.card);
    controller.handleActivation(second.event, second.card);
    expect(openInternal).toHaveBeenCalledExactlyOnceWith("Note", "Folder/Source.md", false);
  });

  it.each(["tab", "split", "window"] as const)("passes pane choice %s through", (pane) => {
    const { controller, openInternal } = makeController({ paneForEvent: () => pane });
    const { card, event } = makeLinkEvent({ internal: true, href: "Note" });
    controller.handleActivation(event, card);
    expect(openInternal).toHaveBeenCalledExactlyOnceWith("Note", "Folder/Source.md", pane);
  });

  it("reports synchronous and asynchronous open failures without throwing or leaking rejection", async () => {
    const error = new Error("open failed");
    const asyncReporter = vi.fn();
    const asyncController = new CardLinkController({
      selectLocalBlock: () => false,
      getSourcePath: () => "Folder/Source.md", paneForEvent: () => false,
      openInternal: () => Promise.reject(error), reportOpenError: asyncReporter
    });
    const asyncEvent = makeLinkEvent({ internal: true, href: "Note" });
    expect(() => asyncController.handleActivation(asyncEvent.event, asyncEvent.card)).not.toThrow();
    await vi.waitFor(() => expect(asyncReporter).toHaveBeenCalledExactlyOnceWith(error));

    const syncReporter = vi.fn();
    const syncController = new CardLinkController({
      selectLocalBlock: () => false,
      getSourcePath: () => "Folder/Source.md", paneForEvent: () => false,
      openInternal: (() => { throw error; }) as unknown as () => Promise<void>,
      reportOpenError: syncReporter
    });
    const syncEvent = makeLinkEvent({ internal: true, href: "Note" });
    expect(() => syncController.handleActivation(syncEvent.event, syncEvent.card)).not.toThrow();
    expect(syncReporter).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("uses non-empty href when data-href is empty and skips when both are empty", () => {
    const { controller, openInternal } = makeController();
    const fallback = makeLinkEvent({ internal: true, href: "Note", dataHref: "" });
    const empty = makeLinkEvent({ internal: true, href: "", dataHref: "" });
    controller.handleActivation(fallback.event, fallback.card);
    controller.handleActivation(empty.event, empty.card);
    expect(openInternal).toHaveBeenCalledExactlyOnceWith("Note", "Folder/Source.md", false);
  });
});
