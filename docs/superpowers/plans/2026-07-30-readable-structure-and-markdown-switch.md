# Readable Arbor Structure and Markdown Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Arbor's tree in a readable Kanban-style footer and add a visible, safe path from Arbor back to the normal Obsidian Markdown view.

**Architecture:** The Markdown body remains the source of truth: existing per-block markers keep arbitrary Markdown boundaries exact. A terminal v2 `%% arbor:structure` comment stores only each block's ID, parent ID, and sibling order; legacy Base64 v1 data stays readable and is migrated on save. The Arbor header gets a current-leaf “Open in Markdown” action that uses the existing one-shot auto-open suppression.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest, esbuild, CSS.

## Global Constraints

- The v2 footer is exactly a terminal `%% arbor:structure` comment containing pretty JSON.
- Its JSON contains `"arbor-plugin": "tree"`, `"version": 2`, and blocks with only `id`, `parent`, and `order`.
- Never write Base64, block contents, a body hash, timestamps, saved state, or collapsed state to v2.
- Keep visible `<!-- arbor:block:v1 ... -->` markers; they preserve block boundaries and Markdown spacing.
- Read legacy compact and multiline `arbor:metadata:v1` footers indefinitely; the next Arbor save rewrites them as v2.
- When markers and a v2 footer disagree, markers win.
- Do not force a Markdown mode: the “Open in Markdown” button respects Obsidian's existing Source/Live Preview/Reading choice.
- Do not add a DOCX exporter or new runtime dependencies.

---

### Task 1: Implement readable v2 footer parsing and serialization

**Files:**
- Modify: `src/constants.ts`
- Modify: `src/types.ts`
- Modify: `src/storage/serializer.ts`
- Modify: `src/storage/document.ts`
- Modify: `src/settings.ts`
- Modify: `src/main.ts`
- Modify: `src/model/tree.ts`
- Modify: `src/view/ArborView.ts`
- Modify: `tests/storage.test.ts`

**Interfaces:**
- Produces `buildStructureBlock(metadata: BranchTreeMetadata): string` and `parseStructureBlock(raw: string): BranchTreeMetadata | null` in `src/storage/serializer.ts`.
- Produces `ParsedBranchDocument.storageFormat: "legacy-v1" | "structure-v2" | null` in `src/types.ts`.
- Changes `buildBranchDocument` to `(frontmatter: string, body: string, metadata: BranchTreeMetadata | null): string`.
- Removes the write-only `applyBodyHash` path and `metadataBlockStyle` setting. `computeBodyHash` may remain only for in-memory legacy-v1 stale-body comparison.

- [ ] **Step 1: Write failing storage tests for the v2 footer**

Add these cases to `tests/storage.test.ts` before changing the production code:

```ts
it("writes a readable v2 structure footer without duplicated content or hashes", () => {
  const footer = buildStructureBlock(metadataFixture());

  expect(footer).toBe([
    "%% arbor:structure",
    "```json",
    "{",
    '  "arbor-plugin": "tree",',
    '  "version": 2,',
    '  "blocks": [',
    "    {",
    '      "id": "root-1",',
    '      "parent": null,',
    '      "order": 0',
    "    },",
    "    {",
    '      "id": "child-1",',
    '      "parent": "root-1",',
    '      "order": 0',
    "    },",
    "    {",
    '      "id": "root-2",',
    '      "parent": null,',
    '      "order": 1',
    "    }",
    "  ]",
    "}",
    "```",
    "%%"
  ].join("\\n"));
  expect(footer).not.toContain("eyJ");
  expect(footer).not.toContain("content");
  expect(footer).not.toContain("lastLinearHash");
});

it("parses a terminal v2 structure footer and keeps the Markdown body separate", () => {
  const metadata = metadataFixture();
  const body = linearizeTree(metadata).body;
  const note = buildBranchDocument("", body, metadata);
  const parsed = parseBranchDocument(note);

  expect(parsed.storageFormat).toBe("structure-v2");
  expect(parsed.body).toBe(body);
  expect(parsed.metadata?.blocks.map(({ id, parentId, order }) => ({ id, parentId, order }))).toEqual([
    { id: "root-1", parentId: null, order: 0 },
    { id: "child-1", parentId: "root-1", order: 0 },
    { id: "root-2", parentId: null, order: 1 }
  ]);
});
```

Change the import to `import { linearizeTree, buildStructureBlock } from "../src/storage/serializer";` and run:

```bash
npm install
npm test -- tests/storage.test.ts
```

Expected: the new tests fail because `buildStructureBlock` and the three-argument `buildBranchDocument` do not exist yet. If Vitest reports a missing Rollup optional dependency, run `npm install` once more; do not remove `package-lock.json` or `node_modules` manually.

- [ ] **Step 2: Add explicit v2 types and marker constants**

In `src/constants.ts`, replace the sole metadata marker with two clear markers:

```ts
export const LEGACY_METADATA_MARKER = "arbor:metadata:v1";
export const STRUCTURE_MARKER = "arbor:structure";
```

In `src/types.ts`, add the storage discriminator and extend the parsed result:

```ts
export type ArborStorageFormat = "legacy-v1" | "structure-v2" | null;

export interface ParsedBranchDocument {
  frontmatter: string;
  body: string;
  metadata: BranchTreeMetadata | null;
  metadataRaw: string;
  storageFormat: ArborStorageFormat;
}
```

Delete `lastLinearHash`, `savedAt`, `ManagedMetadataBlockStyle`, and `metadataBlockStyle` from their corresponding interfaces. Remove the `metadataBlockStyle` default and settings control in `src/settings.ts`; it only configured the retired Base64 comment shape.

- [ ] **Step 3: Implement v2 formatting and dual-format parsing**

In `src/storage/serializer.ts`, make `buildStructureBlock` project the runtime tree to only the three approved values:

```ts
export function buildStructureBlock(metadata: BranchTreeMetadata): string {
  const structure = {
    "arbor-plugin": "tree",
    version: 2,
    blocks: normalizeMetadata(metadata).blocks.map((block) => ({
      id: block.id,
      parent: block.parentId,
      order: block.order
    }))
  };

  return ["%% arbor:structure", "```json", JSON.stringify(structure, null, 2), "```", "%%"].join("\\n");
}
```

Implement `parseStructureBlock` so it accepts only the same comment envelope, parses JSON, checks `arbor-plugin === "tree"`, `version === 2`, an array of unique string IDs, each `parent` as a string or null, and each non-negative integer `order`. Return normalized `BranchTreeMetadata` with empty `prefix`, and blocks shaped as `{ id, parentId: parent, order, content: "", after: "" }`. Return `null` for any invalid input.

Keep the old Base64 decoder as a private `parseLegacyMetadataBlock` helper. It must use `LEGACY_METADATA_MARKER` and retain both legacy compact and multiline regular expressions. Remove `encodeMetadata`, `buildMetadataBlock`, and `applyBodyHash`; `normalizeMetadata` remains the canonical runtime normalizer.

In `src/storage/document.ts`, extract exactly one terminal footer after frontmatter, in this order: a v2 `%% arbor:structure` block, then a legacy compact/multiline HTML comment. Parse the selected footer, set `metadataRaw`, and return `storageFormat` as `"structure-v2"` or `"legacy-v1"`. Do not match arbitrary footer-shaped text unless it is terminal. `buildBranchDocument` must always append `buildStructureBlock(metadata)` when metadata exists.

Update every `buildBranchDocument` call in `src/main.ts` and `src/view/ArborView.ts` to remove the fourth style argument, and replace every `applyBodyHash(tree)` call with `normalizeMetadata(tree)` or the original runtime tree as appropriate. In `src/model/tree.ts`, remove the `savedAt` initialization from `createEmptyTree`.

- [ ] **Step 4: Run the focused tests and type check**

Run:

```bash
npm test -- tests/storage.test.ts
npx tsc --noEmit --skipLibCheck
```

Expected: storage tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit the storage format task**

```bash
git add src/constants.ts src/types.ts src/storage/serializer.ts src/storage/document.ts src/settings.ts src/main.ts src/view/ArborView.ts src/model/tree.ts tests/storage.test.ts
git commit -m "feat: store Arbor structure as readable JSON"
```

### Task 2: Reconcile legacy and v2 notes without losing visible Markdown

**Files:**
- Modify: `src/storage/reconcile.ts`
- Modify: `src/opening.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/opening.test.ts`

**Interfaces:**
- Consumes `ParsedBranchDocument.storageFormat` and marker metadata from `parseVisibleBlockMetadata`.
- Produces `loadImportedBranchDocument(text)` results whose `metadata` always derives content and whitespace from visible markers when those markers exist.

- [ ] **Step 1: Write failing migration and conflict tests**

Add these cases to `tests/storage.test.ts`:

```ts
it("keeps legacy Base64 notes readable and rewrites them as v2 on save", () => {
  const metadata = metadataFixture();
  const legacy = `<!-- arbor:metadata:v1\n${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}\n-->`;
  const note = `${linearizeTree(metadata).body}\n${legacy}`;
  const loaded = loadImportedBranchDocument(note);
  const rewritten = buildBranchDocument("", linearizeTree(loaded.metadata).body, loaded.metadata);

  expect(loaded.metadata.blocks).toHaveLength(3);
  expect(rewritten).toContain("%% arbor:structure");
  expect(rewritten).not.toContain("arbor:metadata:v1");
});

it("uses visible markers when they disagree with a stale v2 footer", () => {
  const metadata = metadataFixture();
  const body = linearizeTree(metadata).body.replace("Child block", "Changed in Markdown");
  const staleFooter = buildStructureBlock({
    ...metadata,
    blocks: [...metadata.blocks].reverse()
  });
  const loaded = loadImportedBranchDocument(`${body}\n${staleFooter}`);

  expect(loaded.metadata.blocks.find((block) => block.id === "child-1")?.content).toBe("Changed in Markdown");
  expect(loaded.metadata.blocks.map((block) => block.id)).toEqual(["root-1", "child-1", "root-2"]);
});

it("does not parse a v2 footer example inside a fenced code block", () => {
  const example = ["```md", buildStructureBlock(metadataFixture()), "```", "", "# Normal note"].join("\\n");
  expect(parseBranchDocument(example).storageFormat).toBeNull();
});
```

Run:

```bash
npm test -- tests/storage.test.ts tests/opening.test.ts
```

Expected: the legacy test fails until reconcile reads the legacy storage discriminator, and the stale-v2 test fails until markers are made authoritative.

- [ ] **Step 2: Make marker content authoritative and retain legacy support**

In `src/storage/reconcile.ts`, retain the current legacy-v1 behavior: when a legacy footer and visible markers coexist, reconstruct marker content and merge only runtime fields that are still valid. For `parsed.storageFormat === "structure-v2"` with visible markers, return the marker reconstruction directly as:

```ts
return {
  metadata: normalizeMetadata(visibleMarkerMetadata),
  origin: "metadata",
  staleMetadata: null,
  needsVisibleMarkerMigration: false
};
```

For a v2 footer with no markers, never use its empty block content. Instead call `importBodyToMetadata(parsed.body)` so the visible Markdown remains intact; that note gets markers and a valid v2 footer on its next save.

Remove `applyBodyHash` from the import and all return paths. Keep `computeBodyHash` only in the legacy-v1 branch where it compares a legacy full metadata snapshot to the visible body. Do not merge or persist `collapsed`, `createdAt`, `updatedAt`, `savedAt`, or hash data into v2.

In `src/opening.ts`, hidden metadata detection continues to rely on `parseBranchDocument(text).metadata`; update the tests so a valid v2 footer remains auto-managed, while marker-only notes retain their existing behavior.

- [ ] **Step 3: Run migration, opening, and lint checks**

Run:

```bash
npm test -- tests/storage.test.ts tests/opening.test.ts
npm run lint
npx tsc --noEmit --skipLibCheck
```

Expected: all focused tests and lint/type checks pass.

- [ ] **Step 4: Commit the migration task**

```bash
git add src/storage/reconcile.ts src/opening.ts tests/storage.test.ts tests/opening.test.ts
git commit -m "fix: migrate legacy Arbor metadata safely"
```

### Task 3: Add a first-class Markdown switch control

**Files:**
- Modify: `src/opening.ts`
- Modify: `src/view/ArborView.ts`
- Modify: `styles.css`
- Modify: `tests/opening.test.ts`
- Modify: `docs/manual-qa.md`
- Modify: `README.md`

**Interfaces:**
- Produces `buildMarkdownViewState(filePath: string): { type: "markdown"; active: true; state: { file: string } }` in `src/opening.ts`.
- `ArborView.openCurrentFileInMarkdown()` commits any active edit, then calls the existing current-leaf switch flow.

- [ ] **Step 1: Write the failing view-state test**

Add this test and import `buildMarkdownViewState` from `src/opening.ts` in `tests/opening.test.ts`:

```ts
it("builds a normal Markdown view state for the current file", () => {
  expect(buildMarkdownViewState("Ideas/Branch.md")).toEqual({
    type: "markdown",
    active: true,
    state: { file: "Ideas/Branch.md" }
  });
});
```

Run:

```bash
npm test -- tests/opening.test.ts
```

Expected: FAIL because `buildMarkdownViewState` is missing.

- [ ] **Step 2: Implement the state builder and current-leaf transition**

In `src/opening.ts`, add:

```ts
export function buildMarkdownViewState(filePath: string): {
  type: "markdown";
  active: true;
  state: { file: string };
} {
  return {
    type: "markdown",
    active: true,
    state: { file: filePath }
  };
}
```

In `src/view/ArborView.ts`, import that helper. Change `openFileInMarkdownView(file)` so it arms `this.plugin.suppressAutoOpenOnce(file.path)` immediately before `await this.leaf.setViewState(buildMarkdownViewState(file.path))`, then reveals `this.leaf`.

Add:

```ts
private async openCurrentFileInMarkdown(): Promise<void> {
  if (!this.file) {
    return;
  }

  await this.commitEditIfNeeded();
  await this.openFileInMarkdownView(this.file);
}
```

This replaces the current Arbor leaf, rather than opening another pane. It must not call undocumented Markdown mode setters or core command IDs.

- [ ] **Step 3: Add the visible button and menu fallback**

Declare `private markdownButtonEl: HTMLButtonElement | null = null;` beside the other header element fields. Include it in the `ensureShell()` completeness guard, then create it before the sliders button:

```ts
this.markdownButtonEl = this.frameEl.createEl("button", {
  cls: "arbor-markdown-button",
  attr: {
    type: "button",
    "aria-label": "Open in Markdown"
  }
});
setIcon(this.markdownButtonEl, "file-text");
this.markdownButtonEl.addEventListener("click", () => void this.openCurrentFileInMarkdown());
this.markdownButtonEl.addEventListener("mousedown", (event) => event.stopPropagation());
```

Make the first item in `openViewMenu()`:

```ts
menu.addItem((item) =>
  item.setTitle("Open in Markdown").setIcon("file-text").onClick(() => void this.openCurrentFileInMarkdown())
);
menu.addSeparator();
```

In `styles.css`, share the existing header-control styles and place the new button between zoom and sliders:

```css
.arbor-zoom-indicator,
.arbor-markdown-button,
.arbor-view-menu-button { /* retain the existing common rules */ }

.arbor-zoom-indicator { right: 84px; }
.arbor-markdown-button { right: 44px; }
.arbor-view-menu-button { right: 4px; }

.arbor-markdown-button,
.arbor-view-menu-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
  padding: 0;
}

.arbor-markdown-button svg,
.arbor-view-menu-button svg { width: 15px; height: 15px; }
```

Extend existing hover/focus selectors with `.arbor-markdown-button`, including the reduced-motion selector when applicable.

- [ ] **Step 4: Document and manually verify the UI behavior**

Add “Open in Markdown” to the README command table and the View Controls/Workflow text. Add this scenario to `docs/manual-qa.md`:

```md
- With Auto-open managed notes enabled, edit a block and click the file-text “Open in Markdown” header control.
- Confirm the same tab becomes a normal Markdown view, the edit is saved, and Arbor does not immediately reopen.
- Repeat from the Arbor view menu.
- Verify manually in Obsidian's Source Mode, Live Preview, and Reading View; Arbor must respect the mode chosen by Obsidian rather than forcing one.
```

- [ ] **Step 5: Run focused automation and perform the QA scenario**

Run:

```bash
npm test -- tests/opening.test.ts
npm run lint
npm run build
```

Expected: all commands pass. Then reload Arbor in Obsidian and complete the three manual QA bullets above.

- [ ] **Step 6: Commit the Markdown switch task**

```bash
git add src/opening.ts src/view/ArborView.ts styles.css tests/opening.test.ts docs/manual-qa.md README.md
git commit -m "feat: add visible Markdown switch"
```

### Task 4: Final regression pass and release-ready documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-qa.md`
- Test: `tests/storage.test.ts`
- Test: `tests/opening.test.ts`
- Test: `tests/tree.test.ts`
- Test: `tests/utils.test.ts`

**Interfaces:**
- Consumes all prior tasks; adds no new runtime interfaces.

- [ ] **Step 1: Write the release-level regression assertions**

Add one final `tests/storage.test.ts` assertion that builds a note with `buildBranchDocument`, then verifies all four release conditions together:

```ts
it("writes a managed note with visible markers and only a readable v2 footer", () => {
  const metadata = metadataFixture();
  const note = buildBranchDocument("", linearizeTree(metadata).body, metadata);

  expect(note).toContain('<!-- arbor:block:v1 id="root-1" parent="" order="0" -->');
  expect(note).toContain("%% arbor:structure");
  expect(note).toContain('"arbor-plugin": "tree"');
  expect(note).not.toContain("arbor:metadata:v1");
  expect(note).not.toContain("lastLinearHash");
});
```

- [ ] **Step 2: Run the assertion and then the complete suite**

Run:

```bash
npm test -- tests/storage.test.ts
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: all tests, lint, and build pass; `git diff --check` has no output; only intentional documentation changes, if any, remain before the final commit.

- [ ] **Step 3: Update the user-facing format explanation**

Replace README wording that promises “hidden in-note metadata” with an explanation that Arbor writes visible block boundary markers plus a readable terminal structure footer. State that the footer is for structure only and ordinary Markdown remains the source text.

- [ ] **Step 4: Commit final regression and documentation changes**

```bash
git add README.md docs/manual-qa.md tests/storage.test.ts
git commit -m "docs: explain readable Arbor note structure"
```
