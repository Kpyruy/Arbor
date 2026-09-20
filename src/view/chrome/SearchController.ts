import type { BranchBlockId } from "../../types";
import type { BranchViewContext, SelectionOptions } from "../state/viewTypes";

export interface SearchPort {
  getFrame(): HTMLElement | null;
  getContext(): BranchViewContext | null;
  selectBlock(id: BranchBlockId, options?: SelectionOptions): void;
  handleSearchShortcut(event: KeyboardEvent): boolean;
  requestRender(): void;
}

export class SearchController {
  private searchOverlayEl: HTMLElement | null = null;
  private searchDialogEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchMetaEl: HTMLElement | null = null;
  private searchClearEl: HTMLButtonElement | null = null;
  private query = "";
  private searchOpen = false;
  private shouldFocusSearchInput = false;

  constructor(private readonly port: SearchPort) {}

  getQuery(): string {
    return this.query;
  }

  isOpen(): boolean {
    return this.searchOpen;
  }

  openSearchOverlay(): void {
    if (this.searchOpen) {
      this.searchInputEl?.focus();
      this.searchInputEl?.select();
      return;
    }
    this.searchOpen = true;
    this.shouldFocusSearchInput = true;
    this.port.requestRender();
  }

  closeSearchOverlay(): void {
    this.searchOpen = false;
    this.shouldFocusSearchInput = false;
    this.query = "";
    this.port.requestRender();
  }

  syncSearchOverlay(context: BranchViewContext): void {
    const frame = this.port.getFrame();
    if (!frame) {
      return;
    }
    if (!this.searchOpen) {
      this.searchOverlayEl?.remove();
      this.searchOverlayEl = null;
      this.searchDialogEl = null;
      this.searchInputEl = null;
      this.searchMetaEl = null;
      this.searchClearEl = null;
      return;
    }
    if (!this.searchOverlayEl) {
      this.searchOverlayEl = frame.createDiv({ cls: "arbor-search-overlay" });
      this.searchOverlayEl.addEventListener("mousedown", (event) => {
        if (event.target === this.searchOverlayEl) {
          this.closeSearchOverlay();
        }
      });
      this.searchDialogEl = this.searchOverlayEl.createDiv({ cls: "arbor-search-dialog" });
      this.searchInputEl = this.searchDialogEl.createEl("input", {
        cls: "arbor-search-input",
        attr: { type: "search", placeholder: "Search blocks and path" }
      });
      this.searchInputEl.addEventListener("input", () => {
        this.query = this.searchInputEl?.value ?? "";
        this.port.requestRender();
      });
      this.searchInputEl.addEventListener("keydown", (event) => {
        if (this.handleSearchShortcut(event)) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeSearchOverlay();
          return;
        }

        if (event.key === "Enter") {
          const firstMatch = this.port.getContext()?.overviewNodes.find((node) => node.isSearchMatch);
          if (firstMatch) {
            event.preventDefault();
            this.port.selectBlock(firstMatch.id, { focus: true });
          }
        }
      });
      const footerEl = this.searchDialogEl.createDiv({ cls: "arbor-search-footer" });
      this.searchMetaEl = footerEl.createDiv({ cls: "arbor-search-meta", text: "Search blocks and path" });
      this.searchClearEl = footerEl.createEl("button", {
        cls: "arbor-search-clear",
        text: "Clear",
        attr: { type: "button", "aria-label": "Clear search" }
      });
      this.searchClearEl.addEventListener("click", () => {
        this.query = "";
        this.port.requestRender();
        this.searchInputEl?.focus();
      });
      const go = footerEl.createEl("button", { text: "Go to match", attr: { type: "button" } });
      go.addEventListener("click", () => {
        const firstMatch = this.port.getContext()?.overviewNodes.find((node) => node.isSearchMatch);
        if (firstMatch) {
          this.port.selectBlock(firstMatch.id, { focus: true });
          this.closeSearchOverlay();
        }
      });
      const close = footerEl.createEl("button", { text: "Close", attr: { type: "button", "aria-label": "Close search" } });
      close.addEventListener("click", () => this.closeSearchOverlay());
    }
    if (this.searchInputEl && this.searchInputEl.value !== this.query) {
      this.searchInputEl.value = this.query;
    }
    if (this.searchMetaEl && this.searchClearEl) {
      const matchCount = context.searchMatchedIds.size;
      this.searchMetaEl.setText(context.searchQuery.length > 0 ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : "Search blocks and path");
      this.searchClearEl.toggleClass("is-visible", context.searchQuery.length > 0);
      this.searchClearEl.toggleAttribute("disabled", context.searchQuery.length === 0);
    }
    if (this.shouldFocusSearchInput) {
      this.shouldFocusSearchInput = false;
      window.requestAnimationFrame(() => {
        this.searchInputEl?.focus();
        this.searchInputEl?.select();
      });
    }
  }

  handleSearchShortcut(event: KeyboardEvent): boolean {
    return this.port.handleSearchShortcut(event);
  }

  reset(): void {
    this.searchOpen = false;
    this.shouldFocusSearchInput = false;
    this.query = "";
    this.searchOverlayEl?.remove();
    this.searchOverlayEl = null;
    this.searchDialogEl = null;
    this.searchInputEl = null;
    this.searchMetaEl = null;
    this.searchClearEl = null;
  }
}
