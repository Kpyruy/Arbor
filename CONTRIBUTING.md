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
