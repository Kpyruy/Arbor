# Manual QA Checklist

## Core Rendering

- Open a note with an Arbor structure footer.
- Run `Open view for current note`.
- Confirm root blocks appear in the left column.
- Click a root card and confirm its children open in the next column.
- Click a child card and confirm only the active path is expanded.
- Confirm breadcrumb path matches the selected path.
- Close the Arbor view, open the same managed note normally from the file explorer, and confirm it auto-opens back into Arbor view.

## Editing

- Double click a card and confirm inline edit mode starts.
- Press `Esc` and confirm the edit is canceled.
- Edit again and press `Enter`; confirm content saves and edit mode closes.
- Paste an image from clipboard while editing and confirm it is saved into the vault and inserted as an embed.
- Drag an image file onto the textarea and confirm it is inserted into the block.
- Run `Create new note` and confirm a new `.md` note is created next to the active note and opens in Arbor view.
- Run `Create new note in Markdown editor` and confirm the new note opens as a normal Markdown note.
- Create a new root block and confirm the new card autofocuses.
- Create sibling above, below, and child-right and confirm correct placement.

## Reordering

- Drag a card within the same column and confirm sibling order updates.
- Drag a card to another column and confirm the parent changes.
- Move a parent block with children and confirm descendants stay attached.
- Run move up/down/left/right commands and confirm structure updates.
- Confirm the active path columns visually align around the selected branch instead of feeling top-stacked.

## Deletion / Duplication

- Delete a block and confirm its children are lifted.
- Delete a subtree and confirm the whole branch disappears.
- Duplicate a single block and confirm only the selected block is copied.
- Duplicate a subtree and confirm descendants are copied too.

## Linear Markdown Safety

- Open the same note in normal markdown view.
- Confirm the note body reads like normal markdown.
- Confirm each block starts with an `<!-- arbor:block:v1 ... -->` marker in source mode.
- Confirm YAML frontmatter remains untouched.
- Confirm the terminal `%% arbor:structure` footer is readable JSON with only block ID, parent, and order.
- Disable the plugin and confirm the note is still readable as markdown.

## Output Profiles

- Open an existing Arbor note without output metadata and confirm the active profile is `Full tree` and every card is included.
- Open the profile pill, choose `Manage output profiles…`, and create, duplicate, rename, activate, and delete a custom profile.
- Confirm names cannot be empty, duplicate names are rejected without regard to letter case, and `Full tree` cannot be renamed or deleted.
- Switch profiles and reload Obsidian; confirm the active profile and its rules persist. Confirm switching alone does not add an Arbor undo step.
- In a custom profile, right-click a card and test `Include block only`, `Exclude block only`, `Include subtree`, and `Exclude subtree`.
- Exclude a parent, include one nested child, and confirm direct versus inherited exclusions have distinct non-color indicators, tooltips, and screen-reader labels.
- Run `Include all`, `Exclude all`, `Invert selection`, `Include only selected branch`, `Root blocks only`, and `Reset profile`; confirm the result matches each label and reset asks for confirmation.
- Duplicate, reorder, and reparent included and excluded branches; delete a parent while lifting its children; undo and redo each change. Confirm effective output stays stable for surviving blocks.

## Output Preview

- Open `Output preview` for a custom profile and confirm only included blocks render, in depth-first order, with headings, tasks, callouts, code, links, embeds, comments, tables, footnotes, and Unicode text intact.
- Edit the tree or profile, reopen/refresh the preview, and confirm it updates without creating a temporary Markdown file or changing the source note.
- Use `Open in Markdown` and confirm it still opens the complete original Arbor note, including blocks excluded by the active profile.
- Return to the editor and confirm the same selected block remains usable.
- Repeat the preview flow on desktop and mobile, in both `Left to right` and `Right to left` layouts; verify controls stay reachable and long rendered blocks do not overflow.

## Clean Export Copy

- Open a saved Arbor note with YAML, nested blocks, code, tasks, and embeds.
- Activate a custom profile with an excluded parent and an explicitly included descendant.
- Choose Export clean copy…, choose Keep YAML and Omit excluded blocks, and create the export.
- Confirm <source> — export.md opens in a normal Markdown tab; it has no ARBOR badge, visible block markers, or structure footer.
- Confirm the export matches Output Preview exactly: the excluded parent is absent, its included descendant remains in depth-first order, and the original Arbor note stays open and unchanged.
- Repeat with Keep excluded blocks as comments. Confirm excluded block IDs and content are inside valid HTML comments and Markdown containing `--` cannot close a comment early.
- Repeat with Export body only and confirm the YAML frontmatter is absent.
- Export again and confirm — export 2.md is created without overwriting the first copy.
- Cancel the modal and confirm no file is created.

## Output Metadata Recovery

- Copy an Arbor note, then deliberately make its terminal `%% arbor:output` JSON invalid while leaving `%% arbor:structure` intact.
- Open the copy and confirm Arbor falls back to `Full tree`, displays a warning, and still recovers the complete visible tree.
- Make and save an unrelated tree edit; confirm the malformed output footer remains byte-for-byte unchanged.
- Choose `Reset output profiles`, confirm it, and verify the malformed footer is removed only then.

## Rich Markdown Round-Trip

- Use a note containing headings, paragraphs, tasks, callouts, code fences, tables, wiki links, embeds, and footnotes.
- Open and save it through Arbor.
- Confirm none of those constructs are broken in normal markdown view.

## Plain Markdown Reconcile

- Open a managed note in normal markdown view.
- Edit the body directly.
- Reopen Arbor.
- Confirm the plugin does not silently lose content.
- Confirm exact block recovery uses visible block markers when available.
- Confirm the reconcile banner appears when fallback rebuild was used.
- Run `Rebuild tree from metadata` and confirm the last saved branch structure can be restored.

## Legacy Migration

- Open an older Arbor note that still uses hidden metadata without visible block markers.
- Confirm Arbor shows a short upgrade overlay.
- Confirm the note is rewritten with visible `arbor:block:v1` markers.
- Reopen the same note and confirm it no longer triggers another migration.

## File Explorer Labels

- Put a legacy v1 Arbor note, a current v2 Arbor note, a normal `.md` note, and a Canvas note in the same folder.
- Confirm only the two Arbor Markdown notes show the `ARBOR` File Explorer label.
- Open the legacy v1 note in Arbor and confirm its migration preserves the label.
- Delete an Arbor note's structure footer, refresh the File Explorer, and confirm its label disappears.

## Undo / Redo

- Add a block, move a block, edit a block, and delete a block.
- Undo each action.
- Redo each action.
- Confirm saved markdown follows the restored state.

## Context Menu And Commands

- Right click a card and confirm the block actions menu opens.
- Right click a note in the File Explorer and confirm `New arbor note` is absent.
- Right click a folder and confirm `New arbor note` appears in the top creation section, then creates the note inside that folder.
- Right click empty File Explorer space and confirm `New arbor note` appears in the top creation section, then creates the note in the vault root.
- With Auto-open managed notes enabled, edit a block and click the file-text “Open in Markdown” header control.
- Confirm the same tab becomes a normal Markdown view, the edit is saved, and Arbor does not immediately reopen.
- Confirm no Arbor loading screen remains after the Markdown view opens.
- Repeat from the Arbor view menu and verify Obsidian keeps the mode it already chose (Source, Live Preview, or Reading View).
- Use the menu to create a child block to continue the branch.
- Focus a card and confirm `ArrowUp/ArrowDown/ArrowLeft/ArrowRight` move through siblings, parent, and first child.
- Confirm `Home` jumps to the first sibling and `End` jumps to the last sibling.
- Use command palette entries for:
  - open block actions menu
  - select parent
  - select previous sibling
  - select next sibling
  - select first child
  - select first sibling
  - select last sibling
