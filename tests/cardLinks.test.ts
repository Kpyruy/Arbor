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
}> = {}) {
  const openInternal = vi.fn(async () => undefined);
  const reportOpenError = overrides.reportOpenError ?? vi.fn();
  return {
    controller: new CardLinkController({
      getSourcePath: overrides.getSourcePath ?? (() => "Folder/Source.md"),
      paneForEvent: overrides.paneForEvent ?? (() => false),
      openInternal: overrides.openInternal ?? openInternal,
      reportOpenError
    }),
    openInternal,
    reportOpenError
  };
}

describe("CardLinkController", () => {
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
      getSourcePath: () => "Folder/Source.md", paneForEvent: () => false,
      openInternal: () => Promise.reject(error), reportOpenError: asyncReporter
    });
    const asyncEvent = makeLinkEvent({ internal: true, href: "Note" });
    expect(() => asyncController.handleActivation(asyncEvent.event, asyncEvent.card)).not.toThrow();
    await vi.waitFor(() => expect(asyncReporter).toHaveBeenCalledExactlyOnceWith(error));

    const syncReporter = vi.fn();
    const syncController = new CardLinkController({
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
