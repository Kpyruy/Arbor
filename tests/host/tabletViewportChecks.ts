/** Run with real layout; happy-dom cannot establish visibility or hit testing. */
export function checkTabletViewportHost(root: HTMLElement): { dockWithinFrame: boolean; dropTargetsWithinContent: boolean } {
  const frame = root.querySelector<HTMLElement>(".arbor-frame")!;
  const dock = root.querySelector<HTMLElement>(".arbor-touch-dock");
  const viewport = root.querySelector<HTMLElement>(".arbor-columns-viewport, .arbor-overview-viewport")!;
  if (!frame || !viewport) throw Error("Missing tablet fixture");
  const bounds = frame.getBoundingClientRect();
  if (dock) {
    const rect = dock.getBoundingClientRect();
    if (rect.bottom > bounds.bottom + 1 || rect.top < bounds.top) throw Error(`Dock outside frame: ${JSON.stringify({ rect, bounds })}`);
  }
  const content = viewport.getBoundingClientRect();
  for (const target of Array.from(root.querySelectorAll<HTMLElement>(".arbor-content-drop-options:not([hidden]) [data-new-block-kind]"))) {
    const rect = target.getBoundingClientRect();
    if (rect.left < content.left || rect.right > content.right || rect.top < content.top || rect.bottom > content.bottom
      || rect.width < 44 || rect.height < 44) throw Error(`Drop target outside content: ${JSON.stringify({ rect, content })}`);
    const hit = root.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || !target.contains(hit)) throw Error("Drop target covered");
  }
  return { dockWithinFrame: true, dropTargetsWithinContent: true };
}
