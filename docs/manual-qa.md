# Manual QA Checklist

## Core Rendering

- Open a note with hidden Arbor metadata.
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
- Confirm hidden metadata sits at the end of the note.
- Disable the plugin and confirm the note is still readable as markdown.

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

## Undo / Redo

- Add a block, move a block, edit a block, and delete a block.
- Undo each action.
- Redo each action.
- Confirm saved markdown follows the restored state.

## Context Menu And Commands

- Right click a card and confirm the block actions menu opens.
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
