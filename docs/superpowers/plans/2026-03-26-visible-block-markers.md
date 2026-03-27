# Visible Block Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a precise visible block-marker note format to Arbor, migrate old metadata-only notes to the new format on open, and keep recovery exact even when hidden metadata is stale.

**Architecture:** Arbor will render each visible block with a machine comment marker ahead of its markdown content while still keeping hidden metadata at the end of the file. Loading will prefer exact visible markers over heuristic imports, auto-upgrade legacy notes once, and show a lightweight loading overlay only during migration.

**Tech Stack:** TypeScript, Obsidian plugin API, Vitest

---

### Task 1: Add marker-format tests first

**Files:**
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/tests/storage.test.ts`

- [ ] **Step 1: Add a failing serializer test for visible markers**

Add a test that expects the linearized body to contain a marker before each block and still preserve depth-first order.

- [ ] **Step 2: Run the storage tests to verify the new test fails**

Run: `npm test -- tests/storage.test.ts`

Expected: failure because the current serializer does not emit visible block markers.

- [ ] **Step 3: Add failing parser/recovery tests**

Add tests that cover:
- exact reconstruction from visible markers alone
- visible markers winning over stale hidden metadata
- metadata-only legacy notes being recognized as legacy and preserved for migration

- [ ] **Step 4: Re-run the storage tests**

Run: `npm test -- tests/storage.test.ts`

Expected: failures in the new marker parsing and legacy migration cases.

### Task 2: Implement visible marker serialization and parsing

**Files:**
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/src/constants.ts`
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/src/storage/serializer.ts`
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/src/storage/document.ts`
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/src/storage/reconcile.ts`
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/src/types.ts`

- [ ] **Step 1: Define the visible marker format**

Introduce a versioned visible marker constant such as `arbor:block:v1` and keep the metadata marker untouched.

- [ ] **Step 2: Update the serializer to emit markers in the visible body**

Render each block as:

```md
<!-- arbor:block:v1 id="..." parent="..." order="..." -->
<block markdown>
```

while preserving the current `after` spacing rules.

- [ ] **Step 3: Add exact parsing for visible markers**

Parse marker-bearing bodies back into blocks with:
- `id`
- `parentId`
- `order`
- `content`
- `after`

and reject malformed marker bodies cleanly instead of half-importing them.

- [ ] **Step 4: Update reconcile precedence**

Implement this order:
1. hidden metadata + matching visible markers -> metadata
2. valid visible markers + stale hidden metadata -> visible markers
3. metadata-only legacy note -> metadata with `legacy` upgrade flag
4. no exact structures -> old heuristic import

- [ ] **Step 5: Re-run the focused storage tests**

Run: `npm test -- tests/storage.test.ts`

Expected: the new parser/serializer tests pass.

### Task 3: Add legacy migration and loading UI

**Files:**
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/src/view/ArborView.ts`
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/styles.css`

- [ ] **Step 1: Add a lightweight migration loading state**

Create a small overlay inside the Arbor view with copy similar to:
- `Upgrading note structure...`
- `Rewriting this note to Arbor's precise block format.`

- [ ] **Step 2: Auto-migrate legacy metadata-only notes on open**

When a note loads as legacy metadata-only:
- show the loading state
- rewrite the note once into the new visible marker format
- preserve frontmatter and hidden metadata
- reload from disk after the write completes

- [ ] **Step 3: Keep user-facing notices specific**

Do not show the scary plain-markdown rebuild notice for successful exact recovery from visible markers.
Reserve that notice only for the old heuristic fallback path.

- [ ] **Step 4: Re-run build and storage tests**

Run:
- `npm run build`
- `npm test -- tests/storage.test.ts`

Expected: build succeeds and storage tests stay green.

### Task 4: Full verification and cleanup

**Files:**
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/tests/storage.test.ts`
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/tests/tree.test.ts` (only if needed)
- Modify: `C:/Users/ACER/OneDrive/Документы/Obsidian/Obsidian/.obsidian/plugins/arbor/README.md` (only if note format docs need updating)

- [ ] **Step 1: Add regression coverage for migration id stability**

Verify that a migrated legacy note keeps the same block ids and parent relationships after conversion.

- [ ] **Step 2: Run the full local verification set**

Run:
- `npm run lint`
- `npm run build`
- `npm test`

Expected:
- lint passes with 0 errors
- build exits 0
- all Vitest tests pass

- [ ] **Step 3: Sanity-check demo notes in the vault**

Open an Arbor-managed note and ensure:
- no rebuild banner for a marker-formatted note
- exact legacy upgrade path works once
- selected block structure is preserved

- [ ] **Step 4: Document the new exact note format if needed**

If README needs it, add one short section that Arbor stores visible block markers plus hidden metadata for exact recovery.
