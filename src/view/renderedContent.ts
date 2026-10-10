const NON_TEXT_RENDERED_CONTENT = [
  "img",
  "video",
  "audio",
  "canvas",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "mjx-container",
  ".internal-embed",
  ".math"
].join(", ");

/** Whether Markdown produced visible text or a meaningful non-text DOM render. */
export function hasMeaningfulRenderedContent(container: HTMLElement): boolean {
  if (container.innerText.trim().length > 0) {
    return true;
  }

  return container.matches(NON_TEXT_RENDERED_CONTENT) || container.querySelector(NON_TEXT_RENDERED_CONTENT) !== null;
}
