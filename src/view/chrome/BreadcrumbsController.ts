import type { BranchBlock, BranchBlockId } from "../../types";
import { getActivePath } from "../../model/tree";
import { getEnteringBreadcrumbIds } from "../../breadcrumbAnimation";
import { getBreadcrumbScrollInsets, getVisualBreadcrumbOrder } from "../../layoutDirection";
import { extractPathLabel } from "../../utils";
import type { SelectionPort, ViewReadPort } from "../state/viewTypes";

interface BreadcrumbElements {
  frame: HTMLElement | null;
  breadcrumbs: HTMLElement | null;
  exitLayer: HTMLElement | null;
}

export class BreadcrumbsController {
  private breadcrumbScrollFrame: number | null = null;

  constructor(
    private readonly read: ViewReadPort,
    private readonly selection: SelectionPort,
    private readonly getElements: () => BreadcrumbElements,
    private readonly getFileBasename: () => string
  ) {}

  syncBreadcrumbs(): void {
    const { breadcrumbs } = this.getElements();
    const state = this.read.getState();
    if (!breadcrumbs || !state) {
      return;
    }
    const settings = this.read.getSettings();
    const hideBreadcrumbContent = !settings.showBreadcrumb || this.read.getMode() === "output";
    breadcrumbs.toggleClass("is-reserved-hidden", hideBreadcrumbContent);
    breadcrumbs.setAttr("aria-hidden", hideBreadcrumbContent ? "true" : "false");
    if (hideBreadcrumbContent) {
      return;
    }
    const path = getActivePath(state.metadata, state.selectedBlockId);
    const previousPathIds = Array.from(
      breadcrumbs.querySelectorAll<HTMLElement>("[data-block-id]")
    ).map((element) => element.dataset.blockId ?? "");
    const enteringBlockIds = getEnteringBreadcrumbIds(previousPathIds, path.map((block) => block.id));
    this.animateRemovedBreadcrumbs(path);
    breadcrumbs.empty();
    if (path.length === 0) {
      breadcrumbs.createSpan({
        cls: "arbor-breadcrumb-empty",
        text: this.getFileBasename() || "Arbor"
      });
      return;
    }
    this.renderBreadcrumbItems(breadcrumbs, path, enteringBlockIds);
    this.syncBreadcrumbScroll();
  }

  clearBreadcrumbScrollFrame(): void {
    if (this.breadcrumbScrollFrame !== null) {
      window.cancelAnimationFrame(this.breadcrumbScrollFrame);
      this.breadcrumbScrollFrame = null;
    }
  }

  reset(): void {
    this.clearBreadcrumbScrollFrame();
  }

  private getBreadcrumbLabel(markdown: string): string {
    const settings = this.read.getSettings();
    return extractPathLabel(markdown, {
      preferredPrefix: settings.breadcrumbLabelPreferredPrefix,
      fallback: settings.breadcrumbLabelFallback,
      maxWords: 4,
      maxLength: 34
    });
  }

  private renderBreadcrumbItems(
    container: HTMLElement,
    path: BranchBlock[],
    enteringBlockIds: ReadonlySet<BranchBlockId> = new Set<BranchBlockId>()
  ): void {
    const state = this.read.getState();
    const settings = this.read.getSettings();
    const visualPath = getVisualBreadcrumbOrder(path, settings.layoutDirection);
    visualPath.forEach((block, index) => {
      const button = container.createEl("button", {
        cls: block.id === state?.selectedBlockId ? "is-active" : "",
        text: this.getBreadcrumbLabel(block.content),
        attr: { "data-block-id": block.id }
      });
      button.toggleClass("is-entering", enteringBlockIds.has(block.id));
      button.setCssProps({ "--bw-crumb-index": String(index) });
      button.addEventListener("click", () => {
        this.selection.selectBlock(block.id, { focus: true });
      });
      if (settings.showBreadcrumbFlow && index < visualPath.length - 1) {
        const connector = container.createSpan({ cls: "arbor-breadcrumb-connector" });
        connector.setCssProps({ "--bw-crumb-index": String(index + 0.45) });
      }
    });
  }

  private animateRemovedBreadcrumbs(nextPath: BranchBlock[]): void {
    const { breadcrumbs: breadcrumbsEl, exitLayer: exitLayerEl, frame: frameEl } = this.getElements();
    if (!breadcrumbsEl || !exitLayerEl || !frameEl) {
      return;
    }
    exitLayerEl.empty();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const nextPathIds = new Set(nextPath.map((block) => block.id));
    const frameRect = frameEl.getBoundingClientRect();
    breadcrumbsEl.querySelectorAll<HTMLButtonElement>("button[data-block-id]").forEach((button) => {
      if (nextPathIds.has(button.dataset.blockId ?? "")) {
        return;
      }
      const buttonRect = button.getBoundingClientRect();
      const exitButton = exitLayerEl.createEl("button", {
        cls: "arbor-breadcrumb-exiting",
        text: button.textContent ?? ""
      });
      exitButton.toggleClass("is-active", button.hasClass("is-active"));
      exitButton.setCssProps({
        left: `${buttonRect.left - frameRect.left}px`,
        top: `${buttonRect.top - frameRect.top}px`,
        width: `${buttonRect.width}px`,
        height: `${buttonRect.height}px`
      });
      exitButton.addEventListener("animationend", () => exitButton.remove(), { once: true });
    });
  }

  private syncBreadcrumbScroll(): void {
    const breadcrumbs = this.getElements().breadcrumbs;
    if (!breadcrumbs) {
      return;
    }
    this.clearBreadcrumbScrollFrame();
    this.breadcrumbScrollFrame = window.requestAnimationFrame(() => {
      this.breadcrumbScrollFrame = null;
      const breadcrumbsEl = this.getElements().breadcrumbs;
      if (!breadcrumbsEl || breadcrumbsEl.scrollWidth <= breadcrumbsEl.clientWidth + 1) {
        return;
      }
      const activeButton =
        breadcrumbsEl.querySelector<HTMLElement>("button.is-active") ??
        breadcrumbsEl.querySelector<HTMLElement>("button:last-of-type");
      if (!activeButton) {
        return;
      }
      const breadcrumbsRect = breadcrumbsEl.getBoundingClientRect();
      const activeRect = activeButton.getBoundingClientRect();
      const { left: leftInset, right: rightInset } = getBreadcrumbScrollInsets(this.read.getSettings().layoutDirection);
      const isFullyVisible =
        activeRect.left >= breadcrumbsRect.left + leftInset &&
        activeRect.right <= breadcrumbsRect.right - rightInset;
      if (isFullyVisible) {
        return;
      }
      const maxScrollLeft = Math.max(0, breadcrumbsEl.scrollWidth - breadcrumbsEl.clientWidth);
      const activeCenter =
        breadcrumbsEl.scrollLeft +
        (activeRect.left - breadcrumbsRect.left) +
        activeRect.width / 2;
      const targetLeft = Math.max(
        0,
        Math.min(
          activeCenter - (breadcrumbsEl.clientWidth - rightInset - leftInset) / 2 - leftInset,
          maxScrollLeft
        )
      );
      breadcrumbsEl.scrollTo({
        left: targetLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
  }
}
