import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildSinglePageTreeOverviewPdf } from "../src/treeOverviewPdf";

const onePixelPng = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0)
);

describe("Tree Overview PDF export", () => {
  it("embeds the overview PNG on one landscape-oriented PDF page", async () => {
    const pdf = await buildSinglePageTreeOverviewPdf(onePixelPng, 1_600, 900);
    const header = new TextDecoder().decode(pdf.slice(0, 8));
    const document = await PDFDocument.load(pdf);
    const page = document.getPage(0);

    expect(header).toMatch(/^%PDF-/);
    expect(document.getPageCount()).toBe(1);
    expect(page.getWidth()).toBe(1600);
    expect(page.getHeight()).toBe(900);
  });
});
