import type { BranchColumnModel } from "../../src/types";
import type { BranchRenderer } from "../../src/view/branch/BranchRenderer";
import type { BranchViewContext } from "../../src/view/state/viewTypes";

export function assertHost(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function checkBranchIdentity(
  renderer: BranchRenderer,
  columns: HTMLElement,
  models: BranchColumnModel[],
  context: BranchViewContext,
  getMarkdownRenderCount: () => number
): Promise<void> {
  const before = columns.querySelector('[data-block-id="first"]');
  assertHost(before, "Fixture first card missing");
  const renderCount = getMarkdownRenderCount();
  await renderer.syncColumns(models, context);
  await renderer.syncColumns(models, context);
  assertHost(columns.querySelector('[data-block-id="first"]') === before, "Card identity changed");
  assertHost(getMarkdownRenderCount() === renderCount, "Stable card sync rendered Markdown again");
}

export async function checkTextareaIdentity(
  renderer: BranchRenderer,
  columns: HTMLElement,
  models: BranchColumnModel[],
  context: BranchViewContext,
  beginEditing: () => void,
  expectedValue: string
): Promise<void> {
  beginEditing();
  await renderer.syncColumns(models, context);
  const card = columns.querySelector<HTMLElement>('[data-block-id="first"]');
  const before = card?.querySelector<HTMLTextAreaElement>("textarea.arbor-editor");
  assertHost(before, "Fixture editor textarea missing");
  assertHost(before.value === expectedValue, "Editor textarea value changed");
  await renderer.syncColumns(models, context);
  assertHost(card?.querySelector("textarea.arbor-editor") === before, "Editor textarea identity changed");
  assertHost(before.value === expectedValue, "Editor textarea value changed after stable sync");
}

export async function checkEmptyColumnMenuActionSelection(
  openEmptyColumnMenu: () => void,
  chooseCreateChild: () => Promise<void>,
  selectAnotherBlock: () => void,
  getSelectedBlockId: () => string | null,
  getSelectedBlockParentId: (blockId: string) => string | null,
  parentId: string,
  actionSelectedBlockId: string
): Promise<void> {
  openEmptyColumnMenu();
  assertHost(getSelectedBlockId() === parentId, "Empty-column menu did not select its parent when opened");
  selectAnotherBlock();
  const actionTimeSelectedBlockId = getSelectedBlockId();
  assertHost(actionTimeSelectedBlockId !== null, "Create child action had no selected parent");
  await chooseCreateChild();
  const createdChildId = getSelectedBlockId();
  assertHost(
    createdChildId === actionSelectedBlockId,
    "Create child action did not select the created child"
  );
  assertHost(
    createdChildId !== actionTimeSelectedBlockId,
    "Create child action did not move selection to the created child"
  );
  assertHost(
    getSelectedBlockParentId(createdChildId) === actionTimeSelectedBlockId,
    "Created child parent does not match the action-time selection"
  );
}

export function checkButtonHitTarget(button: HTMLButtonElement): void {
  const rect = button.getBoundingClientRect();
  assertHost(rect.width > 0 && rect.height > 0, "Button has no hit area");
  const hit = button.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  assertHost(hit && (hit === button || button.contains(hit)), "Button is covered by another element");
}
