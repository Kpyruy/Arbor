# Arbor view modules

`src/view/ArborView.ts` is the Obsidian `FileView` adapter and composition root.
It retains the public commands, file-loading policy and ordered render pipeline.
Controllers receive narrow capabilities; they do not import the facade or plugin.

| Directory | Responsibility and state owner |
| --- | --- |
| `state/` | Document state, selection, history and persistence in `DocumentController`; shared types and pure view models |
| `editor/` | Editing session and blur commit in `BlockEditorController`; attachment IO adapter |
| `navigation/` | Keyboard commands and buffered numeric navigation |
| `branch/` | Keyed column/card DOM, branch camera and drag-and-drop |
| `overview/` | Overview surfaces, selection animation, layout application and camera |
| `interaction/` | Zoom scheduling and touch/pinch state |
| `preview/` | Linear preview and staged output preview |
| `chrome/` | Shell DOM, breadcrumbs, menus and search |
| `export/` | Clean/visual export orchestration and overview snapshot |
| `modals/` | Confirmation and export dialogs |
| `output/` | Pure output-profile card/menu presentation |
| `runtime/` | Per-owner cancellable DOM work (`ViewWorkScope`) |

## Lifecycle contracts

- Document, editing session and history have one authoritative owner each.
- `reset()` invalidates pending UI work but permits reuse; the facade scope's
  `dispose()` is terminal when the leaf closes.
- Load generations and captured file identity reject stale load publication.
  An older unload cannot reset a newer document.
- Render requests invalidate older asynchronous pipelines. Renderers check their
  own generation and document/DOM identities after Markdown rendering yields.
- Closing awaits the edit commit before UI cleanup. Document IO and explicit
  exports are not cancelled as DOM work; awaited paint promises still settle.
- Overview selection and zoom keep their incremental paths; changing selection
  does not require a full Markdown render.

## Verification

Run `npm test`, `npm run lint`, `npm run build` and `npm run lint:oxlint`.
`tests/viewModuleBoundaries.test.ts` checks import boundaries, runtime cycles,
document IO ownership and public command type compatibility.

`tests/host/arborViewChecks.ts` provides real-DOM checks for an Obsidian test host.
Compiling that file is **not** evidence that those checks ran. Desktop/mobile
layout, gestures, two-leaf lifecycle and performance acceptance remain manual
gates; see [the checklist](../manual-qa.md#modularization-acceptance).
