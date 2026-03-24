# Contributing to Arbor

Thanks for contributing.

## Development Setup

1. Clone or copy the repository into:

```text
<vault>/.obsidian/plugins/arbor
```

2. Install dependencies:

```bash
npm install
```

3. Start the development build:

```bash
npm run dev
```

4. Reload Obsidian and enable `Arbor`.

## Before Opening a PR

Run:

```bash
npm run build
npm test
```

Then run the relevant checks from:

- `docs/manual-qa.md`

## Contribution Standards

- Keep changes scoped and purposeful.
- Prefer preserving Markdown integrity over adding clever behavior.
- Avoid breaking the one-note source-of-truth model.
- Keep the UI fast, restrained, and native to Obsidian.
- Document new commands, shortcuts, or settings in `README.md`.

## Areas That Need Good Regression Testing

- plain Markdown reconcile
- drag-and-drop moves
- inline editing save/cancel behavior
- selected-block preview behavior
- auto-open of managed notes
- zoom, breadcrumbs, and search overlay

## Visual Changes

If a change affects the interface, include screenshots or a short GIF when possible.
