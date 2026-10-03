import { getActivePath, getBlock, cloneMetadata } from "../../model/tree";
import { buildOverviewLayout } from "../../model/overviewLayout";
import { resolveTreeOverviewExportLinkStyle } from "../../treeOverviewExport";
import type { ArborLayoutDirection, BranchBlockId, BranchTreeMetadata } from "../../types";
import { extractSnippet } from "../../utils";
import type { OverviewSnapshot } from "./ExportController";
import { applyOverviewLayout } from "../overview/overviewDom";
import type { MarkdownPort } from "../state/viewTypes";

export interface OverviewSnapshotInput {
  document: Document;
  metadata: BranchTreeMetadata;
  selectedBlockId: BranchBlockId | null;
  sourcePath: string;
  cardWidth: number;
  direction: ArborLayoutDirection;
  snippetLength: number;
  themeVariables: Record<string, string>;
  textMuted: string;
  markdown: MarkdownPort;
  waitForNextPaint(): Promise<void>;
}

export async function createOverviewSnapshot(input: OverviewSnapshotInput): Promise<OverviewSnapshot> {
  const metadata = cloneMetadata(input.metadata);
  const selectedBlockId = input.selectedBlockId;
  const sourcePath = input.sourcePath;
  const cardWidth = input.cardWidth;
  const direction = input.direction;
  const snippetLength = input.snippetLength;
  const themeVariables = { ...input.themeVariables };
  const textMuted = input.textMuted;
  const padding = 48;
  const activePathIds = new Set(getActivePath(metadata, selectedBlockId).map((block) => block.id));
  const initialLayout = buildOverviewLayout(metadata, { cardWidth, direction });
  const root = input.document.body.createDiv({ cls: "arbor-tree-overview-export arbor-view" });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.remove();
  };

  root.toggleClass("is-rtl", direction === "rtl");
  root.setCssProps(themeVariables);
  try {
    const frame = root.createDiv({ cls: "arbor-tree-overview-export-frame" });
    const scene = frame.createDiv({ cls: "arbor-overview-scene" });
    const surface = scene.createDiv({ cls: "arbor-overview-surface arbor-tree-overview-export-surface" });
    const cardsById = new Map<BranchBlockId, HTMLElement>();

    prepareTreeOverviewExportFrame(frame, scene, surface, initialLayout.width, initialLayout.height, padding);
    for (const node of initialLayout.nodes) {
      const block = getBlock(metadata, node.id);
      if (!block) continue;

      const card = surface.createDiv({ cls: "arbor-overview-card arbor-tree-overview-export-card" });
      card.dataset.blockId = node.id;
      card.toggleClass("is-active", node.id === selectedBlockId);
      card.toggleClass("is-on-path", node.id !== selectedBlockId && activePathIds.has(node.id));
      card.setCssProps({
        "--arbor-overview-card-width": `${node.width}px`,
        "--arbor-overview-x": `${node.x}px`,
        "--arbor-overview-y": `${node.y}px`
      });
      const content = card.createDiv({ cls: "arbor-overview-card-content markdown-rendered" });
      await input.markdown.render(block.content, content, sourcePath);
      if (content.innerText.trim().length === 0) {
        content.setText(extractSnippet(block.content, snippetLength));
      }
      cardsById.set(node.id, card);
    }

    await waitForTreeOverviewExportAssets(surface, () => input.waitForNextPaint());
    const cardHeights = new Map<BranchBlockId, number>();
    cardsById.forEach((card, blockId) => {
      cardHeights.set(blockId, Math.max(card.offsetHeight, card.scrollHeight));
    });
    const layout = buildOverviewLayout(metadata, { cardWidth, cardHeights, direction });
    prepareTreeOverviewExportFrame(frame, scene, surface, layout.width, layout.height, padding);
    applyOverviewLayout(scene, surface, cardsById, layout, 1, direction);
    applyTreeOverviewExportLinkStyle(surface, textMuted);
    await waitForTreeOverviewExportAssets(surface, () => input.waitForNextPaint());

    return { frame, width: layout.width + padding * 2, height: layout.height + padding * 2, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function prepareTreeOverviewExportFrame(
  frame: HTMLElement,
  scene: HTMLElement,
  surface: HTMLElement,
  width: number,
  height: number,
  padding: number
): void {
  frame.setCssStyles({
    boxSizing: "border-box",
    height: `${height + padding * 2}px`,
    padding: `${padding}px`,
    width: `${width + padding * 2}px`
  });
  scene.setCssStyles({ height: `${height}px`, margin: "0", width: `${width}px` });
  surface.setCssProps({ "--arbor-overview-zoom": "1" });
}

export function applyTreeOverviewExportLinkStyle(surface: HTMLElement, textMuted: string): void {
  if (textMuted) {
    const style = resolveTreeOverviewExportLinkStyle(textMuted);
    surface.setCssProps({
      "--arbor-tree-export-link-stroke": style.stroke,
      "--arbor-tree-export-link-opacity": style.opacity
    });
  }

  // html-to-image clones SVG subtrees intact, without inlining their children's
  // CSS. Capture resolved paint as SVG attributes on this export-only snapshot.
  const view = surface.ownerDocument.defaultView;
  if (!view) return;
  const paintProperties = [
    "opacity", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "vector-effect"
  ];
  surface.querySelectorAll<SVGPathElement>(".arbor-overview-link").forEach((path) => {
    const computed = view.getComputedStyle(path);
    paintProperties.forEach((property) => path.setAttribute(property, computed.getPropertyValue(property)));
  });
}

export async function waitForTreeOverviewExportAssets(
  container: HTMLElement,
  waitForNextPaint: () => Promise<void>
): Promise<void> {
  const view = container.ownerDocument.defaultView;
  const wait = (milliseconds: number) => new Promise<void>((resolve) => {
    (view?.setTimeout ?? setTimeout)(resolve, milliseconds);
  });
  await Promise.race([container.ownerDocument.fonts.ready, wait(4_000)]);
  const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map(async (image) => {
    if (image.complete) {
      await image.decode?.().catch(() => undefined);
      return;
    }
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
      (view?.setTimeout ?? setTimeout)(finish, 4_000);
    });
  }));
  await waitForNextPaint();
  await waitForNextPaint();
}
