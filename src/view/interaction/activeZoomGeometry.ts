/** CSS-based Branch zoom includes fixed-height caps. Measure at native scale
 * synchronously, restoring styles before paint, rather than dividing a capped
 * screen height by the previous zoom (which makes the result state-dependent). */
export function measureBranchCard(card: HTMLElement, resizeEditor: (editor: HTMLTextAreaElement) => void): { width: number; height: number } {
  const column = card.closest<HTMLElement>(".arbor-column");
  if (!column) return { width: card.offsetWidth, height: card.offsetHeight };
  const zoom = column.style.getPropertyValue("--bw-zoom");
  const contentZoom = column.style.getPropertyValue("--bw-content-zoom");
  const editor = card.querySelector<HTMLTextAreaElement>("textarea.arbor-editor");
  const editorHeight = editor?.style.getPropertyValue("--arbor-editor-height") ?? "";
  const scroller = editor ?? card.querySelector<HTMLElement>(".arbor-card-content");
  const scroll = { left: scroller?.scrollLeft ?? 0, top: scroller?.scrollTop ?? 0 };
  try {
    column.setCssProps({ "--bw-zoom": "1", "--bw-content-zoom": "1" });
    if (editor) resizeEditor(editor);
    return { width: card.offsetWidth, height: card.offsetHeight };
  } finally {
    column.setCssProps({ "--bw-zoom": zoom, "--bw-content-zoom": contentZoom });
    editor?.setCssProps({ "--arbor-editor-height": editorHeight });
    if (scroller) { scroller.scrollLeft = scroll.left; scroller.scrollTop = scroll.top; }
  }
}
