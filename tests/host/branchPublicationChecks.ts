/** Browser-only: geometry and hit testing alone do not prove painted visibility. */
export function checkBranchPublication(root: HTMLElement): { blockId: string; opacity: number }[] {
  const win = root.ownerDocument.defaultView!;
  const viewport = root.querySelector<HTMLElement>(".arbor-columns-viewport")!;
  const active = root.querySelector<HTMLElement>(".arbor-card.is-active")!;
  if (!viewport || !active) throw Error("Missing active Branch card");
  const cards = Array.from(root.querySelectorAll<HTMLElement>(".arbor-card"));
  const result = cards.map(card => {
    let opacity = 1;
    for (let element: HTMLElement | null = card; element; element = element.parentElement) {
      const style = win.getComputedStyle(element);
      opacity *= Number(style.opacity);
      if (style.display === "none" || style.visibility !== "visible") throw Error(`Unpainted card ${card.dataset.blockId}`);
      if (element === root) break;
    }
    if (opacity < 0.01) throw Error(`Transparent card ${card.dataset.blockId}: ${opacity}`);
    if (card.closest(".is-rebinding")) throw Error(`Unpublished card ${card.dataset.blockId}`);
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw Error(`Empty card ${card.dataset.blockId}`);
    return { blockId: card.dataset.blockId!, opacity };
  });
  const bounds = viewport.getBoundingClientRect();
  const selected = active.getBoundingClientRect();
  if (selected.right <= bounds.left || selected.left >= bounds.right || selected.bottom <= bounds.top || selected.top >= bounds.bottom) {
    throw Error(`Active card outside viewport: ${active.dataset.blockId}`);
  }
  return result;
}

/** Icon-only controls must paint an icon, not just an empty hit target. */
export function checkBranchControlIcons(root: HTMLElement): number {
  const win = root.ownerDocument.defaultView!;
  const buttons = Array.from(root.querySelectorAll<HTMLElement>(".arbor-mode-controls button, .arbor-touch-dock button, .arbor-frame > button"))
    .filter(button => !button.textContent?.trim() && win.getComputedStyle(button).display !== "none");
  if (!buttons.length) throw Error("No icon-only controls checked");
  for (const button of buttons) {
    const svg = button.querySelector<SVGSVGElement>("svg");
    if (!svg || !svg.querySelector("path, line, polyline, rect, circle, polygon, ellipse")) {
      throw Error(`Empty icon control: ${button.getAttribute("aria-label") ?? button.className}`);
    }
    const box = svg.getBoundingClientRect();
    const style = win.getComputedStyle(svg);
    if (box.width <= 0 || box.height <= 0 || style.visibility !== "visible" || Number(style.opacity) === 0) {
      throw Error(`Unpainted icon: ${button.getAttribute("aria-label") ?? button.className}`);
    }
  }
  return buttons.length;
}

/** Tablet columns scroll natively without a detached rail above the cards. */
export function checkTouchColumnScrollbars(root: HTMLElement): number {
  if (!root.classList.contains("has-touch-controls") || root.classList.contains("is-compact")) throw Error("Wide touch view required");
  const win = root.ownerDocument.defaultView!;
  const lists = Array.from(root.querySelectorAll<HTMLElement>(".arbor-card-list"));
  let scrollable = 0;
  for (const list of lists) {
    const style = win.getComputedStyle(list);
    if (style.scrollbarWidth !== "none") throw Error("Detached tablet column scrollbar is visible");
    if (style.overflowY !== "auto") throw Error("Native tablet column scrolling was disabled");
    if (list.scrollHeight > list.clientHeight + 1) scrollable++;
  }
  if (!scrollable) throw Error("Fixture has no scrollable column");
  return scrollable;
}
