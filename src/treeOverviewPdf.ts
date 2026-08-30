import { PDFDocument } from "pdf-lib";

export async function buildSinglePageTreeOverviewPdf(
  pngBytes: Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([width, height]);
  const image = await document.embedPng(pngBytes);
  page.drawImage(image, { x: 0, y: 0, width, height });
  return document.save();
}
