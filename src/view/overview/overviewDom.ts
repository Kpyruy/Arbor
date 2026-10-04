import { ArborLayoutDirection, ArborOverviewLayout, ArborOverviewOrientation, BranchBlockId } from "../../types";
import { buildOverviewLinkPath } from "../../model/overviewLayout";

export function applyOverviewLayout(
  scene: HTMLElement,
  surface: HTMLElement,
  cardsById: ReadonlyMap<BranchBlockId, HTMLElement>,
  layout: ArborOverviewLayout,
  zoom: number,
  direction: ArborLayoutDirection,
  orientation: ArborOverviewOrientation = "horizontal"
): void {
  scene.setCssProps({
    "--arbor-overview-zoom": String(zoom),
    "--arbor-overview-width": `${layout.width * zoom}px`,
    "--arbor-overview-height": `${layout.height * zoom}px`
  });
  scene.dataset.overviewWidth = String(layout.width);
  scene.dataset.overviewHeight = String(layout.height);
  surface.setCssProps({
    "--arbor-overview-surface-width": `${layout.width}px`,
    "--arbor-overview-surface-height": `${layout.height}px`
  });
  layout.nodes.forEach((node) => {
    cardsById.get(node.id)?.setCssProps({
      "--arbor-overview-x": `${node.x}px`,
      "--arbor-overview-y": `${node.y}px`,
      "--arbor-overview-card-width": `${node.width}px`,
      "--arbor-overview-card-height": `${node.height}px`
    });
  });
  surface.querySelector(".arbor-overview-links")?.remove();
  renderOverviewLinks(surface, layout, direction, orientation);
}

export function renderOverviewLinks(
  surface: HTMLElement,
  layout: ArborOverviewLayout,
  direction: ArborLayoutDirection,
  orientation: ArborOverviewOrientation = "horizontal"
): void {
  const svg = surface.createSvg("svg", {
    cls: "arbor-overview-links",
    attr: {
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      width: layout.width,
      height: layout.height
    },
    prepend: true
  });
  const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
  layout.links.forEach((link) => {
    const parent = nodesById.get(link.parentId);
    const child = nodesById.get(link.childId);
    if (!parent || !child) {
      return;
    }
    svg.createSvg("path", {
      cls: "arbor-overview-link",
      attr: { d: buildOverviewLinkPath(parent, child, direction, orientation) }
    });
  });
}
