/** Run against the real stylesheet in a browser/Obsidian, not a layout-less DOM. */
export function checkTouchHeaderSpacingHost(root: HTMLElement): Array<{ rtl: boolean; zoom: string; gap: number; width: number }> {
  const zoom = root.querySelector<HTMLElement>(".arbor-zoom-indicator");
  const profile = root.querySelector<HTMLElement>(".arbor-output-profile-button");
  if (!zoom || !profile || !root.classList.contains("has-touch-controls")) throw new Error("Touch header fixture missing");
  const originalText = zoom.textContent;
  const wasRtl = root.classList.contains("is-rtl");
  const receipts: Array<{ rtl: boolean; zoom: string; gap: number; width: number }> = [];
  try {
    for (const rtl of [false, true]) {
      root.classList.toggle("is-rtl", rtl);
      for (const value of ["25%", "100%", "500%"]) {
        zoom.textContent = value;
        const z = zoom.getBoundingClientRect();
        const p = profile.getBoundingClientRect();
        const gap = rtl ? p.left - z.right : z.left - p.right;
        if (z.width <= 0 || p.width <= 0 || gap < 7.5) throw new Error(`Touch profile/zoom overlap: ${rtl ? "RTL" : "LTR"} ${value}, gap=${gap}`);
        for (const button of [profile, zoom]) {
          const rect = button.getBoundingClientRect();
          const hit = root.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (hit?.closest("button") !== button) throw new Error("Touch header button is covered");
        }
        receipts.push({ rtl, zoom: value, gap, width: z.width });
      }
    }
    return receipts;
  } finally {
    zoom.textContent = originalText;
    root.classList.toggle("is-rtl", wasRtl);
  }
}
