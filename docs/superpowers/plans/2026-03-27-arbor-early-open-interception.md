# Arbor Early-Open Interception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Arbor-managed notes into Arbor before markdown renders, using a lightweight loading view and a narrow `WorkspaceLeaf.setViewState` interception.

**Architecture:** Add a dedicated `arbor-loading` view, centralize managed-note open decisions, and intercept markdown leaf opens only for strongly identified managed notes. Keep the registry as a speed hint while metadata and visible markers remain the correctness layer.

**Tech Stack:** Obsidian plugin API, TypeScript, existing Arbor storage/document pipeline, Vitest-style test suite.

---

## File Map

- Modify: `C:\Users\ACER\OneDrive\Документы\Obsidian\Obsidian\.obsidian\plugins\arbor\src\constants.ts`
  - Add the loading view type constant.
- Modify: `C:\Users\ACER\OneDrive\Документы\Obsidian\Obsidian\.obsidian\plugins\arbor\src\main.ts`
  - Register the loading view, add the narrow `setViewState` interception, and centralize managed-note routing decisions.
- Create: `C:\Users\ACER\OneDrive\Документы\Obsidian\Obsidian\.obsidian\plugins\arbor\src\view\ArborLoadingView.ts`
  - Minimal loading shell and handoff logic.
- Modify: `C:\Users\ACER\OneDrive\Документы\Obsidian\Obsidian\.obsidian\plugins\arbor\src\view\ArborView.ts`
  - Reuse shared loading/preparation boundaries where needed and keep bounce-back behavior coherent.
- Modify: `C:\Users\ACER\OneDrive\Документы\Obsidian\Obsidian\.obsidian\plugins\arbor\styles.css`
  - Style the loading shell.
- Modify: `C:\Users\ACER\OneDrive\Документы\Obsidian\Obsidian\.obsidian\plugins\arbor\tests\storage.test.ts`
  - Extend any managed-note detection assertions if they belong there.
- Create or modify: `C:\Users\ACER\OneDrive\Документы\Obsidian\Obsidian\.obsidian\plugins\arbor\tests\main.test.ts`
  - Cover managed routing decisions and plain-note fallback.

## Task 1: Add the loading view type and shell

- [ ] Add a new `VIEW_TYPE_ARBOR_LOADING` constant next to the main Arbor view constant.
- [ ] Create `ArborLoadingView.ts` with a lightweight `FileView` that renders a loading shell and can hand off to Arbor or markdown.
- [ ] Add loading-shell CSS in `styles.css` with minimal layout and no heavy animation.

## Task 2: Centralize managed-note open decisions

- [ ] Add a helper in `main.ts` that resolves Arbor-open decisions from explicit open intent, managed registry, hidden metadata, and visible markers.
- [ ] Make the helper return a strong yes/no decision plus whether the fast path came from the registry.
- [ ] Keep false positives impossible: uncertain notes stay markdown.

## Task 3: Intercept markdown leaf opens narrowly

- [ ] Patch `WorkspaceLeaf.setViewState` in `main.ts`.
- [ ] Intercept only markdown opens that include a real file path.
- [ ] If the helper says the note is Arbor-managed, rewrite the target type to `arbor-loading` before markdown renders.
- [ ] Preserve all other calls untouched.

## Task 4: Implement loading handoff

- [ ] In `ArborLoadingView`, resolve the current file once and choose Arbor vs markdown.
- [ ] Send managed notes to the real Arbor view.
- [ ] Send plain notes back to markdown without loops.
- [ ] Reuse existing suppression and explicit-open bookkeeping instead of inventing a second system.

## Task 5: Keep ArborView coherent with the new path

- [ ] Adjust ArborView loading/preparation entry points so they cooperate with `arbor-loading` instead of duplicating work.
- [ ] Keep the existing plain-note bounce-back behavior safe if a plain file somehow lands in Arbor.
- [ ] Preserve migration overlay behavior for old notes.

## Task 6: Test routing behavior

- [ ] Add or update tests for strongly managed notes entering the loading path.
- [ ] Add or update tests for plain markdown notes staying in markdown.
- [ ] Add or update tests for stale registry entries not forcing Arbor.
- [ ] Add or update tests for explicit Arbor-open intent overriding the default path.

## Task 7: Verify and document

- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Update `docs/manual-qa.md` if the opening flow changed in a user-visible way.
