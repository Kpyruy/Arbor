# Arbor Early-Open Interception Design

## Problem

Arbor-managed notes still show a brief markdown-frame flash when they are opened from the file explorer or other standard note-opening flows. The current approach swaps a markdown leaf into Arbor after Obsidian has already started opening the file, so even an aggressive mask still leaves a visible micro-flash.

## Goal

Open Arbor-managed notes without exposing the intermediate markdown view. If the note is Arbor-managed, the user should see either the final Arbor view or a native Arbor loading shell. Plain markdown notes must continue opening in markdown without regressions.

## Constraints

- Arbor-managed notes remain normal `.md` files.
- Hidden `arbor:metadata:v1` metadata stays in the file.
- Visible `<!-- arbor:block:v1 ... -->` markers stay the source of truth for precise visible-body reconstruction.
- Unsupported DOM click interception should be avoided.
- The solution must degrade safely if Obsidian internals change.

## Current State

Arbor currently:
- listens to `file-open` and `active-leaf-change`
- uses a managed-note path registry as a fast hint
- validates managed status by reading hidden metadata
- swaps leaves from markdown into Arbor after the file is already opening
- masks the leaf during auto-open, which reduces but does not eliminate the flash

This means the markdown leaf still wins the first frame.

## Recommended Design

### 1. Add a dedicated `arbor-loading` view

Introduce a lightweight intermediate view type whose only job is to:
- render a minimal Arbor-branded loading shell
- hold the target file path
- resolve whether the file should continue to Arbor or bounce back to markdown
- hand off to the full Arbor view once the file is ready

This gives Arbor a native-looking first frame instead of a markdown flash.

### 2. Intercept `WorkspaceLeaf.setViewState`

Monkeypatch `WorkspaceLeaf.setViewState` narrowly:
- only inspect calls where `type === "markdown"`
- only inspect states that include a concrete markdown file path
- only redirect when Arbor can strongly conclude the file is Arbor-managed

If the note is strongly identified as Arbor-managed, replace the requested target view with `arbor-loading` before markdown renders.

If not, leave the original call untouched.

### 3. Introduce a shared managed-note decision helper

Add a single helper that answers:
- is this file explicitly being opened in Arbor?
- is it strongly Arbor-managed?
- should we route it through loading?
- should we leave it as markdown?

The helper should combine:
- explicit Arbor-open intent
- fast managed-note registry
- hidden metadata presence
- visible Arbor block markers

The managed-note registry remains a speed optimization, not the source of truth.

### 4. Keep fast registry but tighten validation

The registry should still accelerate opening, but it must never alone cause a plain note to open in Arbor.

Required lifecycle behavior:
- startup prune against real files
- refresh on modify for known managed notes
- drop on delete
- move on rename
- explicit Arbor note creation immediately registers the new note

### 5. Arbor loading handoff behavior

The loading view should:
- show immediately
- resolve the file decision once
- open the full Arbor view if the note is managed
- send the leaf back to markdown if the note is plain
- avoid repeated loops by respecting suppression markers

The loading view should not duplicate ArborView parsing logic. It should call a shared preparation helper where practical.

## Fallback Strategy

If the interception path is uncertain or fails:
- do not force Arbor
- allow the markdown open to continue

Arbor should prefer a missed optimization over a false-positive managed open.

## Risks

### Monkeypatch fragility

`WorkspaceLeaf.setViewState` interception is more fragile than event-based routing. To reduce risk:
- keep the patch narrow
- do not rewrite unrelated view transitions
- fall back to original behavior on uncertainty

### Infinite routing loops

Loading view and markdown bounce-back can loop if suppression bookkeeping is sloppy. The design must keep explicit one-shot suppression and explicit open intent separate.

### Double parsing

If both loading view and ArborView fully parse the same note, opening latency can increase. Shared helper boundaries should minimize duplicated I/O.

## Success Criteria

- Opening an Arbor-managed note from the file explorer does not show a markdown body frame.
- At worst, the user sees a native Arbor loading shell.
- Plain markdown notes do not open in Arbor by accident.
- Existing migration and marker-based reconstruction still work.
- Existing create/open commands still behave correctly.
