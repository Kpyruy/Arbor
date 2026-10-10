# Contributing to Arbor

Keep changes focused, preserve the Markdown source, and verify the affected workflow before opening a pull request.

## Development Setup

1. Clone the repository into a dedicated **test vault**, not your everyday vault:

```text
<vault>/.obsidian/plugins/arbor
```

2. Install dependencies:

```bash
npm ci
```

3. Start the development build:

```bash
npm run dev
```

4. Reload Obsidian and enable `Arbor`.

## Before Opening a PR

Run:

```bash
npm run lint
npm run build
npm test
```

Include the commands and results in your PR. Explain any checks you could not run.

### Manual checks

Check the paths your change affects in both Branch Editor and Tree Overview:

- Open an existing note; edit, save, cancel, close and reopen it. Confirm its text and structure remain intact.
- Navigate and create blocks with the keyboard; try both LTR and RTL, plus vertical Overview where relevant.
- Test links, Output Profiles, preview and export when affected.
- For layout or interaction changes, check desktop and mobile. Test popout windows if your change involves focus, timers or document ownership.

For content ingestion changes, use real source panes and disposable notes:

- Drop rendered Markdown and source links onto cards in Branch Editor (LTR and RTL) and Tree Overview. Open generated references and confirm they still point to the source after save/reopen; plain text should not acquire a citation.
- While editing, place the caret and select text, then drop or paste. Confirm insertion/replacement at the right location, native Undo where the host edit-history API supports it, and an explicit ordinary save.
- Check a clean card and dirty drafts in the same and another card. Exercise unavailable clipboard access and confirm system Paste opens the original editor without discarding its draft.
- Confirm drops on background, Output Preview and Arbor's own card drags do not import content; verify image attachment handling and unsupported binary/HTML-only/full-document payloads.
- Repeat with slow source/file reads and mode/popout switches. Check that conflicts or failed saves/imports preserve the draft and incoming content for the available in-session recovery actions.
- Compare the exact source bytes, note body, other cards, colors and Output Profiles before and after. Record which checks used native Obsidian and which used physical devices; desktop emulation does not establish mobile acceptance.

List the devices or environments you actually checked. Desktop emulation is not a physical-device test.

## Contribution Standards

- Keep changes scoped and purposeful.
- Prefer preserving Markdown integrity over adding clever behavior.
- Avoid breaking the one-note source-of-truth model.
- Keep the UI fast, restrained, and native to Obsidian.
- Document new commands, shortcuts, or settings in `README.md`.

## Areas That Need Good Regression Testing

- plain Markdown reconcile
- preserving text and drafts across failed saves, external edits and rebuilds
- drag-and-drop moves
- inline editing save/cancel behavior
- selected-block preview behavior
- auto-open of managed notes
- zoom, breadcrumbs, and search overlay

## Visual Changes

For visible interface changes, include a concise before/after screenshot pair or a short GIF. Use demo content and avoid private vault information.
