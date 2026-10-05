import { BlockEditorController } from "../../src/view/editor/BlockEditorController";
import { NavigationController } from "../../src/view/navigation/NavigationController";
import { ViewWorkScope } from "../../src/view/runtime/ViewWorkScope";
import { fixtureLoaded, fixtureSettings } from "../helpers/arborFixtures";

/** Real browser timer realms; no actual vault edits or save operations. */
export async function checkWindowOwnershipHost(): Promise<number> {
  const iframe = document.body.createEl("iframe", { attr: { hidden: true } });
  const childWindow = iframe.contentWindow!;
  let owner = childWindow;
  let checks = 0;
  const check = (value: unknown, label: string) => { if (!value) throw Error(label); checks += 1; };
  const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
  const state = fixtureLoaded();
  const saves: string[] = [];
  const editor = new BlockEditorController({
    getState: () => state, getWindow: () => owner, usesTouchControls: () => false, getViewportHeight: () => 600,
    onBegin: () => {}, onCancel: () => {}, onUnchanged: async () => {}, saveEdit: async session => { saves.push(session.value); },
    onInput: () => {}, handleSearchShortcut: () => false, paste: async () => {}, drop: async () => {}
  });
  const noop = async () => {};
  const navigation = new NavigationController({ getState: () => state, getSettings: fixtureSettings, getMode: () => "editor", getFilePath: () => "QA.md" },
    { selectBlock: id => { state.selectedBlockId = id; } },
    { beginEditingBlock: () => {}, createChild: noop, createSiblingAbove: noop, createSiblingBelow: noop, createParentLevelBlock: noop,
      createRootBlock: noop, deleteSelectedBlock: noop, undo: noop, redo: noop, openSearchOverlay: () => {}, closeSearchOverlay: () => {},
      isSearchOpen: () => false, setKeyboardSelection: () => {}, openBlockMenu: () => {}, tryHandleCardLink: () => false },
    () => "horizontal", () => owner);
  const scope = new ViewWorkScope();
  try {
    editor.beginEditingBlock("first");
    const session = editor.getSession()!;
    session.value = "Changed";
    editor.scheduleEditingSessionCommit(session);
    owner = window;
    editor.clearBlurCommitTimer();
    await wait(110);
    check(saves.length === 0, "Migrated blur cancellation saved a draft");
    editor.scheduleEditingSessionCommit(session);
    await wait(110);
    check(saves.join() === "Changed", "New window did not save exactly once");
    owner = childWindow;
    const event = { key: "2", ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => {} } as KeyboardEvent;
    navigation.tryHandleNumericChildNavigation(event, "root");
    owner = window;
    navigation.clearNumericNavigation();
    await wait(300);
    check(state.selectedBlockId === "first", "Cancelled popout numeric timer moved selection");
    navigation.tryHandleNumericChildNavigation(event, "root");
    await wait(300);
    check(state.selectedBlockId === "second", "Numeric navigation did not resume in the new window");
    const effects: string[] = [];
    scope.timeout(() => effects.push("stale"), 30, childWindow);
    window.setTimeout(() => effects.push("unrelated"), 30);
    scope.reset();
    await wait(80);
    check(effects.join() === "unrelated", "Scope cancellation affected unrelated window work");
    return checks;
  } finally { editor.reset(); navigation.clearNumericNavigation(); scope.dispose(); iframe.remove(); }
}
