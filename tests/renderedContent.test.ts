import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const renderedOnlyMarkupCases: Array<[string, string, (target: HTMLElement) => void]> = [
  ["image", ".internal-embed img", (target) => {
    const embed = target.createSpan({ cls: "internal-embed is-loaded" });
    embed.createEl("img", { attr: { src: "attachment.png", alt: "Photo" } });
  }],
  ["loading internal embed", ".internal-embed[data-src='Attachment.png']", (target) => {
    target.createSpan({ cls: "internal-embed", attr: { "data-src": "Attachment.png" } });
  }],
  ["SVG", "svg path", (target) => {
    const svg = target.createSvg("svg", { attr: { viewBox: "0 0 10 10" } });
    svg.createSvg("path", { attr: { d: "M0 0L10 10" } });
  }],
  ["math", ".math .mjx-container svg path", (target) => {
    const math = target.createSpan({ cls: "math" });
    const mjx = math.createSpan({ cls: "mjx-container" });
    const svg = mjx.createSvg("svg");
    svg.createSvg("path", { attr: { d: "M0 0" } });
  }]
];

describe("BranchRenderer rendered-only content", () => {
  it.each(renderedOnlyMarkupCases)("preserves %s DOM when rendered text is empty", async (_label, selector, renderMarkup) => {
    const test = await ingestionHarness();
    const state = test.view.documentController.getState()!;
    state.metadata.blocks.find(block => block.id === "first")!.content = "![Photo](attachment.png)";
    const rendererPort = (test.view.branchRenderer as unknown as {
      port: { markdown: { render(markdown: string, target: HTMLElement, sourcePath: string): Promise<void> } };
    }).port;
    rendererPort.markdown.render = async (_markdown, target) => { renderMarkup(target); };
    test.view.branchRenderer.reset();

    await test.render();

    const content = test.card().querySelector<HTMLElement>(".arbor-card-content")!;
    expect(content.querySelector(selector)).not.toBeNull();
    expect(content.textContent).toBe("");
  });

  it("uses the snippet fallback for truly empty rendered content", async () => {
    const test = await ingestionHarness();
    const state = test.view.documentController.getState()!;
    state.metadata.blocks.find(block => block.id === "first")!.content = "A note with no renderable result";
    const rendererPort = (test.view.branchRenderer as unknown as {
      port: { markdown: { render(markdown: string, target: HTMLElement, sourcePath: string): Promise<void> } };
    }).port;
    rendererPort.markdown.render = async () => undefined;
    test.view.branchRenderer.reset();

    await test.render();

    expect(test.card().querySelector(".arbor-card-content")!.textContent).toBe("A note with no renderable result");
  });

  it("keeps text produced by the Markdown renderer", async () => {
    const test = await ingestionHarness();
    const rendererPort = (test.view.branchRenderer as unknown as {
      port: { markdown: { render(markdown: string, target: HTMLElement, sourcePath: string): Promise<void> } };
    }).port;
    rendererPort.markdown.render = async (_markdown, target) => { target.createEl("p", { text: "Rendered text" }); };
    test.view.branchRenderer.reset();

    await test.render();

    expect(test.card().querySelector(".arbor-card-content")!.textContent).toBe("Rendered text");
  });

  it("preserves the image when Overview restores card content after editing", async () => {
    const test = await ingestionHarness("overview");
    test.app.renderMarkdown = (_markdown, target) => { target.createEl("img", { attr: { src: "photo.png" } }); };
    test.view.documentController.getState()!.metadata.blocks.find(block => block.id === "first")!.content = "![[photo.png]]";
    await test.render();
    await test.view.overview.restoreOverviewCardContentInPlace("first");
    expect(test.card().querySelector("img")).not.toBeNull();
    expect(test.card().textContent).not.toContain("[embed:");
  });
});
