# Readable Arbor Structure and Markdown Switch

## Purpose

Replace Arbor's opaque Base64 metadata footer with a readable structure footer, and give every Arbor note an obvious way back to its ordinary Obsidian Markdown view.

## Stored note format

Arbor will continue to keep visible per-block markers in the Markdown body. They delimit arbitrary Markdown blocks exactly, so they remain the source for block content and whitespace.

The terminal footer becomes a Kanban-style Obsidian comment:

````md
%% arbor:structure
```json
{
  "arbor-plugin": "tree",
  "version": 2,
  "blocks": [
    { "id": "story", "parent": null, "order": 0 },
    { "id": "motive", "parent": "story", "order": 0 }
  ]
}
```
%%
````

The footer records only `id`, `parent`, and `order`. It must not contain block content, a body hash, timestamps, saved state, or collapsed-state data. Obsidian hides the footer in Reading View while keeping it clear in Source Mode.

## Compatibility and reconciliation

- Existing Base64 `arbor:metadata:v1` footers remain readable.
- The first successful Arbor save of a legacy note rewrites its footer as the v2 readable structure and removes the Base64 footer.
- Marker-only notes remain supported; their first Arbor save gains the v2 footer.
- If visible markers and a v2 footer disagree after a manual Markdown edit, markers win for structure and content. This protects the visible Markdown source of truth.
- The footer parser recognizes only one terminal, standalone Arbor structure block. Matching text in a fenced code block remains normal user content.

## Markdown switch control

Add an always-visible `file-text` control to the Arbor header, labelled and announced as “Open in Markdown”. It must:

1. Commit an active block edit.
2. Arm the existing one-time auto-open suppression for the current file.
3. Replace the current Arbor leaf with the same file in Obsidian's normal Markdown view.
4. Reveal the same leaf.

The control does not force Live Preview or Reading View: Obsidian's supported public plugin API does not expose a reliable setter for that choice. It uses the user's current/default Markdown mode instead. The same action is also available from Arbor's view menu.

## Acceptance checks

- New notes save readable v2 JSON, never Base64 metadata or `lastLinearHash`.
- v2 parse/save round-trips the full tree's identifiers, parents, and orders.
- Legacy compact and multiline v1 notes still load and convert on save.
- Rich Markdown and original block spacing survive marker-based recovery.
- Manually changing visible markers wins over stale v2 structure.
- A fenced-code example of the footer syntax is not parsed as Arbor metadata.
- “Open in Markdown” preserves the active file, stays in the current tab, commits edits, and does not bounce back to Arbor when auto-open is enabled.

## Out of scope

- Native DOCX generation.
- Removing per-block markers from the Markdown body.
- Persisting collapsed branch state.
- Automatically changing a user's Obsidian Markdown mode.
