---
name: arbor-tasknotes-progress
description: Use when implementing, fixing, reviewing, verifying, or handing off Arbor development tasks in this repository, including work tracked by GitHub issues. Not for other projects or read-only questions without task progress.
---

# Arbor TaskNotes progress

Keep the user's TaskNotes dashboard accurate **during work**, not just at the final report.
This skill belongs only to Arbor. It grants no release, push, issue-closure, plugin-installation, or app-launch authority.

## Locate the task

- Repository: `/home/kpyr/Projects/Arbor`; also applies when explicitly working on Arbor from its vault project hub.
- Main vault: `/home/kpyr/Obsidian/Main/Obsidian`, project `[[30 Projects/Arbor/Arbor Hub]]`.
- Tasks live under `20 Life/Daily/YYYY/MM/DD`, identified by `task` + `Arbor` and one work-type tag: `feature`, `fix`, `chore`, or `docs`.
- Search existing tasks across **all dates** by issue, project and scope; reuse the exact path. A matching short title alone is insufficient. Create a small task only when the authorized development work has no corresponding task. Inspect current TaskNotes settings and use its creation workflow; don't guess metadata or duplicate tasks.
- Niiga is not the progress vault. Do not reopen it or use it as fallback.

## Required lifecycle

| Event | Status/action |
| --- | --- |
| Before implementing the scoped step | Persist `in-progress`, then read it back. |
| Tests/review pending or active work continuing | Keep `in-progress`; note what remains at handoff. |
| Explicitly paused or waiting for a decision/acceptance | `planned`, with a short reason and next action in the body. |
| Scoped acceptance and required checks passed | Persist `done`; verify status and completion date. |

Update at step boundaries, verification/review outcomes and context handoff. Don't wait until all issue work is finished. No timer polling or background monitoring is needed.

The work-type **tag is not progress**; change it only if the task's nature changes. Use configured status values, not invented `in-work`/`blocked` values. Implementation, device QA, release and GitHub closure are separate outcomes: finishing one doesn't finish the others. Don't claim physical-mobile acceptance from desktop tests.

## Persist and verify

Use `obsidian-cli` to verify the exact main-vault path and TaskNotes installed/enabled/**loaded** state. Inspect the current API/settings before mutation. Prefer TaskNotes API so dates, caches and events update together. Preserve unrelated properties and task body.

With the API currently exposing `tasks.get` and `tasks.setStatus`, run through Obsidian evaluation with the resolved task path:

```js
if (app.vault.adapter.basePath !== '/home/kpyr/Obsidian/Main/Obsidian') throw Error('Wrong vault');
const api = app.plugins.plugins.tasknotes?.api;
const before = await api.tasks.get(taskPath);
// Confirm before belongs to Arbor and this scoped step before changing it.
await api.tasks.setStatus(taskPath, nextStatus);
const after = await api.tasks.get(taskPath);
if (after?.status !== nextStatus) throw Error('Task status not persisted');
```

If the normal launcher fails (previously exit 133), check for an available official CLI socket route; don't assume a temporary bridge still exists. If the app/API is unavailable, record the exact pending update in the local handoff and report tracking as unavailable. Continue safe authorized code work; don't pretend the dashboard updated, silently edit plugin configuration, or launch a closed vault. Reconcile pending updates after access returns.

At handoff include the task path, last **verified persisted** status, verification still needed, and any unapplied tracking changes.
