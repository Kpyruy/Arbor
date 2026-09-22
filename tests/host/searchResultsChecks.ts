import { SearchController } from "../../src/view/chrome/SearchController";
import { buildViewContext } from "../../src/view/state/viewModel";
import { fixtureTree, fixtureOutput, fixtureSettings } from "../helpers/arborFixtures";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Run with real DOM elements and Obsidian's DOM helpers, not geometry mocks. */
export function checkSearchResultsHost(frame: HTMLElement): void {
  const tree = fixtureTree();
  const chosen: string[] = [];
  const search: SearchController = new SearchController({
    getFrame: () => frame,
    getContext: () => buildViewContext(tree, "root", fixtureOutput(), search.getQuery(), fixtureSettings()),
    selectBlock: (id, options) => {
      check(!search.isOpen(), "Search must close before navigation");
      check(options?.focus && options.reveal, "Search must focus and reveal the result");
      chosen.push(id);
    },
    handleSearchShortcut: () => false,
    requestRender: () => undefined
  });
  const sync = () => search.syncSearchOverlay(buildViewContext(tree, "root", fixtureOutput(), search.getQuery(), fixtureSettings()));
  const input = () => {
    const el = frame.querySelector<HTMLInputElement>(".arbor-search-input");
    check(el, "Missing search input");
    return el;
  };
  const type = (text: string) => { input().value = text; input().dispatchEvent(new Event("input")); sync(); };
  const key = (name: string, composing = false) => input().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, isComposing: composing }));
  try {
    search.openSearchOverlay(); sync(); type("root");
    check(frame.querySelectorAll('[role="option"]').length === 4, "Path matches must list all blocks");
    const firstRow = frame.querySelector('[role="option"]');
    key("ArrowDown");
    check(frame.querySelector('[role="option"]') === firstRow, "Arrow selection must not recreate result rows");
    const selected = frame.querySelector('[aria-selected="true"]');
    check(selected?.id && input().getAttribute("aria-activedescendant") === selected.id, "Input must expose the selected result to assistive technology");
    key("Enter", true);
    check(chosen.length === 0 && search.isOpen(), "IME confirmation must not navigate");
    key("Enter"); sync();
    check(chosen.join() === "first", "ArrowDown and Enter must choose the second tree result");
    check(!frame.querySelector(".arbor-search-overlay"), "Activation must remove the overlay");
    search.openSearchOverlay(); sync(); type("leaf");
    frame.querySelector<HTMLButtonElement>('[role="option"]')?.click(); sync();
    check(chosen.join() === "first,leaf", "Click must navigate to the clicked result");
    search.openSearchOverlay(); sync(); type("no-such-block");
    check(frame.querySelector(".arbor-search-empty"), "No-result searches need a visible explanation");
    key("Enter"); check(chosen.join() === "first,leaf", "Empty results must not navigate");
    frame.querySelector<HTMLButtonElement>(".arbor-search-clear")?.click(); sync();
    check(input().value === "" && !frame.querySelector('[role="option"]'), "Clear must reset query and results");
    type("root"); key("ArrowDown"); key("ArrowUp"); key("Enter"); sync();
    check(chosen.join() === "first,leaf,root", "ArrowUp must return to the previous result");
    search.openSearchOverlay(); sync();
    frame.querySelector<HTMLButtonElement>('[aria-label="Close search"]')?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    check(!search.isOpen(), "Escape must work when a footer button has focus");
  } finally { search.reset(); }
}
