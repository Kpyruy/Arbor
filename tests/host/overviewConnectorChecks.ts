import { toCanvas } from "html-to-image";
import { createOverviewSnapshot } from "../../src/view/export/overviewSnapshot";
import type { MarkdownPort } from "../../src/view/state/viewTypes";
import type { ArborOverviewOrientation } from "../../src/types";

/** Check real exported pixels, not the live SVG's stylesheet or a DOM mock. */
export async function checkOverviewConnectorHost(input: {
  document: Document;
  markdown: MarkdownPort;
  waitForNextPaint(): Promise<void>;
  orientations?: readonly ArborOverviewOrientation[];
}): Promise<{ checks: number }> {
  const { document: doc } = input;
  const results: Array<{ direction: string; custom: boolean; backgroundRatio: number; connectorPixels: number; peakRed: number }> = [];
  const customPaint = new CSSStyleSheet();
  customPaint.replaceSync(".arbor-tree-overview-export .arbor-overview-link { stroke: #e00000; stroke-opacity: 0.5; stroke-width: 3px; opacity: 0.5; }");
  const scenarios = [
    { direction: "ltr", custom: false }, { direction: "rtl", custom: false },
    { direction: "ltr", custom: true }, { direction: "rtl", custom: true }
  ] as const;
  for (const scenario of (input.orientations ?? ["horizontal"]).flatMap(orientation => scenarios.map(scenario => ({ ...scenario, orientation })))) {
    const { direction, custom, orientation } = scenario;
    if (custom) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, customPaint];
    let snapshot: Awaited<ReturnType<typeof createOverviewSnapshot>> | null = null;
    try {
      snapshot = await createOverviewSnapshot({
        document: doc,
        metadata: { version: 1, prefix: "", blocks: [
          { id: "root", parentId: null, order: 0, content: "Root", after: "" },
          { id: "upper", parentId: "root", order: 0, content: "Upper", after: "" },
          { id: "lower", parentId: "root", order: 1, content: "Lower", after: "" }
        ] },
        selectedBlockId: null, sourcePath: "", cardWidth: 200,
        direction, orientation: input.orientations ? orientation : undefined, snippetLength: 100,
        themeVariables: { "--background-primary": "#202020", "--background-secondary": "#202020" },
        textMuted: "#b3b3b3", markdown: input.markdown,
        waitForNextPaint: () => input.waitForNextPaint()
      });
      const root = snapshot.frame.querySelector<HTMLElement>('[data-block-id="root"]');
      const child = snapshot.frame.querySelector<HTMLElement>('[data-block-id="upper"]');
      if (!root || !child) throw Error("Export fixture is missing its cards");
      const frameBox = snapshot.frame.getBoundingClientRect();
      const parentBox = root.getBoundingClientRect();
      const childBox = child.getBoundingClientRect();
      // The central connector gap has no cards/text. With valid thin lines,
      // almost all its pixels remain background; filled curves occupy an area.
      const surfaceBox = snapshot.frame.querySelector(".arbor-overview-surface")!.getBoundingClientRect();
      const horizontal = orientation === "horizontal";
      const topDown = orientation === "vertical-top-down";
      const x = Math.round((horizontal ? (direction === "ltr" ? parentBox.right : childBox.right) + 20 : surfaceBox.left) - frameBox.left);
      const right = Math.round((horizontal ? (direction === "ltr" ? childBox.left : parentBox.left) - 20 : surfaceBox.right) - frameBox.left);
      const gapStart = topDown ? parentBox.bottom : childBox.bottom;
      const gapEnd = topDown ? childBox.top : parentBox.top;
      const y = Math.round((horizontal ? childBox.top + 20 : gapStart + (gapEnd - gapStart) / 3) - frameBox.top);
      const bottom = Math.round((horizontal ? parentBox.bottom - 20 : gapEnd - (gapEnd - gapStart) / 3) - frameBox.top);
      const canvas = await toCanvas(snapshot.frame, {
        width: snapshot.width, height: snapshot.height,
        pixelRatio: 1, backgroundColor: "#202020"
      });
      const context = canvas.getContext("2d");
      if (!context || right <= x || bottom <= y) throw Error("Invalid connector sampling region");
      const { data } = context.getImageData(x, y, right - x, bottom - y);
      let backgroundPixels = 0;
      let connectorPixels = 0;
      let peakRed = 0;
      for (let i = 0; i < data.length; i += 4) {
        peakRed = Math.max(peakRed, data[i]);
        if (data[i] >= 28 && data[i] <= 36 && data[i + 1] >= 28 && data[i + 1] <= 36 && data[i + 2] >= 28 && data[i + 2] <= 36) backgroundPixels += 1;
        if (custom) {
          // #e00000 at stroke-opacity .5 and path opacity .5 over #202020
          // gives (80, 24, 24). Without captured path opacity it is (128, 16, 16).
          if (Math.abs(data[i] - 80) < 4 && Math.abs(data[i + 1] - 24) < 4 && Math.abs(data[i + 2] - 24) < 4) connectorPixels += 1;
        } else if (data[i] > 50 && Math.abs(data[i] - data[i + 1]) < 3 && Math.abs(data[i] - data[i + 2]) < 3) connectorPixels += 1;
      }
      const backgroundRatio = backgroundPixels / (data.length / 4);
      results.push({ direction, custom, backgroundRatio, connectorPixels, peakRed });
    } finally {
      snapshot?.dispose();
      if (custom) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(sheet => sheet !== customPaint);
    }
  }
  const failures = results.filter(result => result.backgroundRatio < 0.9 || result.connectorPixels < 10 || (result.custom && (result.peakRed < 76 || result.peakRed > 84)));
  if (failures.length) throw Error(`Export connectors lost their paint: ${JSON.stringify(failures)}`);
  return { checks: results.length * 2 + results.filter(result => result.custom).length };
}
