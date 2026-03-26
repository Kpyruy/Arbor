# Changelog

All notable changes to Arbor should be documented in this file.

## 0.1.7 - 2026-03-26

Reviewer-bot Markdown sentence-case follow-up.

### Changed

- normalized the remaining reviewer-visible `Markdown` UI strings in commands, notices, menus, and banners
- aligned README and manual QA command labels with the updated UI wording

## 0.1.6 - 2026-03-26

Review-bot sentence-case cleanup.

### Changed

- rewrote the remaining reviewer-flagged UI strings to sentence case
- removed extra product naming from notices and setting descriptions where it was not needed

## 0.1.5 - 2026-03-25

Submission rescan follow-up.

### Changed

- capitalized `Markdown` in the plugin description for consistency
- published a new patch release to make the updated plugin state explicit during review

## 0.1.4 - 2026-03-25

Reviewer-bot compliance follow-up.

### Changed

- fixed lifecycle and promise handling in `main.ts`
- removed deprecated leaf APIs and updated activation calls
- cleaned sentence case in reviewer-visible UI text
- removed direct `element.style.*` writes flagged by the bot
- removed unnecessary assertions and unused imports

## 0.1.3 - 2026-03-25

Command ID cleanup before review.

### Changed

- removed the plugin name from the command IDs reviewers are likely to inspect

## 0.1.2 - 2026-03-25

Validation follow-up release.

### Changed

- removed `Obsidian` from the public plugin description to match submission rules

## 0.1.1 - 2026-03-24

Submission polish and release fixes.

### Changed

- moved demo note generation into the shipped plugin bundle
- switched note persistence to `Vault.process()`
- separated community-plugin install, manual install, and contributor workflow docs
- removed the single-section settings heading
- cleaned up manual QA command names and editor behavior notes

## 0.1.0 - 2026-03-24

Initial public-ready repository pass.

### Added

- Arbor branding across the plugin
- writing-first branching editor with in-note metadata
- selected block panel, search overlay, zoom, and view menu
- drag-and-drop reordering and reparenting
- block-level undo/redo
- automated tests and manual QA checklist
- repository documentation and scaffolding
