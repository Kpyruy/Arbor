import type { BranchBlockId } from "../../types";
import type { BranchViewContext, SelectionOptions } from "../state/viewTypes";
import { ViewWorkScope } from "../runtime/ViewWorkScope";

export interface SearchPort {
  getFrame(): HTMLElement | null;
  getContext(): BranchViewContext | null;
  selectBlock(id: BranchBlockId, options?: SelectionOptions): void;
  handleSearchShortcut(event: KeyboardEvent): boolean;
  requestRender(): void;
}

export class SearchController {
  private static nextId = 0;
  private readonly listId = `arbor-search-results-${SearchController.nextId++}`;
  private searchOverlayEl: HTMLElement | null = null;
  private searchDialogEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchResultsEl: HTMLElement | null = null;
  private searchMetaEl: HTMLElement | null = null;
  private searchClearEl: HTMLButtonElement | null = null;
  private query = "";
  private selectedResultIndex = 0;
  private searchOpen = false;
  private shouldFocusSearchInput = false;
  private readonly work = new ViewWorkScope();

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
    this.selectedResultIndex = 0;
    this.shouldFocusSearchInput = true;
    this.port.requestRender();
  }

  closeSearchOverlay(): void {
    this.searchOpen = false;
    this.shouldFocusSearchInput = false;
    this.query = "";
    this.selectedResultIndex = 0;
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
      this.searchResultsEl = null;
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
      this.searchDialogEl.setAttribute("role", "dialog");
      this.searchDialogEl.setAttribute("aria-label", "Search blocks");
      this.searchInputEl = this.searchDialogEl.createEl("input", {
        cls: "arbor-search-input",
        attr: { type: "search", placeholder: "Search blocks and path", role: "combobox", "aria-label": "Search blocks and path", "aria-controls": this.listId, "aria-expanded": "true", "aria-autocomplete": "list" }
      });
      this.searchInputEl.addEventListener("input", () => {
        this.query = this.searchInputEl?.value ?? "";
        this.selectedResultIndex = 0;
        this.port.requestRender();
      });
      this.searchDialogEl.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.isComposing) return;
        if (this.handleSearchShortcut(event)) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeSearchOverlay();
          return;
        }

        if (event.target !== this.searchInputEl) return;
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;

        const currentContext = this.port.getContext();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          if (currentContext?.searchResults.length) {
            event.preventDefault();
            this.moveResultSelection(event.key === "ArrowDown" ? 1 : -1, currentContext);
          }
          return;
        }

        if (event.key === "Enter") {
          const selectedResult = currentContext?.searchResults[this.selectedResultIndex];
          if (selectedResult) {
            event.preventDefault();
            this.activateResult(selectedResult.id);
          }
        }
      });
      this.searchResultsEl = this.searchDialogEl.createDiv({
        cls: "arbor-search-results",
        attr: { id: this.listId, role: "listbox", "aria-label": "Search results" }
      });
      const footerEl = this.searchDialogEl.createDiv({ cls: "arbor-search-footer" });
      this.searchMetaEl = footerEl.createDiv({ cls: "arbor-search-meta", text: "Search blocks and path" });
      this.searchMetaEl.setAttribute("role", "status");
      this.searchClearEl = footerEl.createEl("button", {
        cls: "arbor-search-clear",
        text: "Clear",
        attr: { type: "button", "aria-label": "Clear search" }
      });
      this.searchClearEl.addEventListener("click", () => {
        this.query = "";
        this.selectedResultIndex = 0;
        this.port.requestRender();
        this.searchInputEl?.focus();
      });
      const close = footerEl.createEl("button", { text: "Close", attr: { type: "button", "aria-label": "Close search" } });
      close.addEventListener("click", () => this.closeSearchOverlay());
    }
    if (this.searchInputEl && this.searchInputEl.value !== this.query) {
      this.searchInputEl.value = this.query;
    }
    this.syncSearchResults(context);
    if (this.searchMetaEl && this.searchClearEl) {
      const matchCount = context.searchMatchedIds.size;
      this.searchMetaEl.setText(context.searchQuery.length > 0 ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : "Search blocks and path");
      this.searchClearEl.toggleClass("is-visible", context.searchQuery.length > 0);
      this.searchClearEl.toggleAttribute("disabled", context.searchQuery.length === 0);
    }
    if (this.shouldFocusSearchInput) {
      this.shouldFocusSearchInput = false;
      const input = this.searchInputEl;
      this.work.frame(window, () => {
        if (this.searchInputEl !== input || !input?.isConnected) return;
        this.searchInputEl?.focus();
        this.searchInputEl?.select();
      });
    }
  }

  handleSearchShortcut(event: KeyboardEvent): boolean {
    return this.port.handleSearchShortcut(event);
  }

  private moveResultSelection(direction: 1 | -1, context: BranchViewContext): void {
    const lastIndex = context.searchResults.length - 1;
    this.selectedResultIndex = Math.max(0, Math.min(lastIndex, this.selectedResultIndex + direction));
    this.syncResultSelection(true);
  }

  private activateResult(id: BranchBlockId): void {
    if (!this.port.getContext()?.searchResults.some((result) => result.id === id)) return;
    this.closeSearchOverlay();
    this.port.selectBlock(id, { focus: true, reveal: true });
  }

  private syncSearchResults(context: BranchViewContext): void {
    const resultsEl = this.searchResultsEl;
    if (!resultsEl) return;
    resultsEl.empty();
    this.searchInputEl?.removeAttribute("aria-activedescendant");
    if (context.searchQuery.length === 0) return;

    if (context.searchResults.length === 0) {
      resultsEl.createDiv({ cls: "arbor-search-empty", text: "No matching blocks." });
      return;
    }

    this.selectedResultIndex = Math.min(this.selectedResultIndex, context.searchResults.length - 1);
    context.searchResults.forEach((result, index) => {
      const button = resultsEl.createEl("button", {
        cls: "arbor-search-result",
        attr: { id: `${this.listId}-${index}`, type: "button", role: "option", tabindex: "-1", "aria-selected": String(index === this.selectedResultIndex) }
      });
      button.toggleClass("is-selected", index === this.selectedResultIndex);
      const title = button.createDiv({ cls: "arbor-search-result-title" });
      this.appendHighlightedText(title, result.title, context.searchQuery);
      const snippet = button.createDiv({ cls: "arbor-search-result-snippet" });
      this.appendHighlightedText(snippet, result.snippet, context.searchQuery);
      const path = button.createDiv({ cls: "arbor-search-result-path" });
      this.appendHighlightedText(path, result.path, context.searchQuery);
      button.addEventListener("click", () => this.activateResult(result.id));
    });
    this.syncResultSelection(false);
  }

  private syncResultSelection(reveal: boolean): void {
    this.searchResultsEl?.querySelectorAll<HTMLElement>(".arbor-search-result").forEach((row, index) => {
      const selected = index === this.selectedResultIndex;
      row.toggleClass("is-selected", selected);
      row.setAttribute("aria-selected", String(selected));
      if (selected) {
        this.searchInputEl?.setAttribute("aria-activedescendant", row.id);
        if (reveal) row.scrollIntoView({ block: "nearest" });
      }
    });
  }

  private appendHighlightedText(parent: HTMLElement, text: string, query: string): void {
    const normalizedText = text.toLocaleLowerCase();
    let cursor = 0;
    let matchIndex = normalizedText.indexOf(query, cursor);
    while (matchIndex >= 0) {
      if (matchIndex > cursor) parent.createSpan({ text: text.slice(cursor, matchIndex) });
      parent.createSpan({ cls: "arbor-search-match", text: text.slice(matchIndex, matchIndex + query.length) });
      cursor = matchIndex + query.length;
      matchIndex = normalizedText.indexOf(query, cursor);
    }
    if (cursor < text.length || text.length === 0) parent.createSpan({ text: text.slice(cursor) });
  }

  reset(): void {
    this.work.reset();
    this.searchOpen = false;
    this.shouldFocusSearchInput = false;
    this.query = "";
    this.selectedResultIndex = 0;
    this.searchOverlayEl?.remove();
    this.searchOverlayEl = null;
    this.searchDialogEl = null;
    this.searchInputEl = null;
    this.searchResultsEl = null;
    this.searchMetaEl = null;
    this.searchClearEl = null;
  }
}
