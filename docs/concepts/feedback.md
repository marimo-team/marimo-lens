---
title: Feedback and History
description: Understand activity, reveal, resolve, History entries, resolution receipts, and reopen.
---

# Feedback and History

Lens gives an agent three ways to return visible state to the notebook. Each
serves a different stage of the work and has a different lifetime.

| Stage      | Operation          | Visible result                                                 | State change                            |
| ---------- | ------------------ | -------------------------------------------------------------- | --------------------------------------- |
| Work       | `start_activity()` | Marks the cell or selected target where the agent is working.  | None                                    |
| Review     | `reveal()`         | Brings the cell or selected target into view for a timed hold. | None                                    |
| Resolution | `resolve()`        | Shows a resolution receipt with **Addressed** status.          | Open selections become History entries. |

## Activity marks ongoing work

**Activity** is a transient indication of where the agent is working. The agent
can address an Open selection or a graph-member cell. Selection-addressed
activity stays attached to the selected target, including configured DOM
targets with zero or several producing cells. Cell-addressed activity supports
notebook walkthroughs with no selection.

`start_activity()` returns an `ActivityHandle`. That opaque string owns the
presentation. `stop_activity(handle)` clears it only when the handle still owns
the current activity, so a delayed stop cannot clear newer work.

Activity lasts until one of these events occurs:

- The matching handle stops it.
- Its optional duration expires.
- A later activity or reveal replaces it.
- The Lens view tears down.

A visible target keeps the current scroll position. An offscreen or near-top
target moves toward the center of the viewport. When Lens cannot frame the
target, the dock shows a bounded status instead.

## Reveal brings a result into view

**Reveal** is a timed presentation after verification. It brings the Open
selection or cell into view once, follows later layout changes during its hold,
and preserves the person's keyboard focus.

The agent supplies `duration_ms`, a short label, and an optional message. A
later attention event replaces the reveal. The public call validates the
attention address before sending the browser event, but browser delivery is
best effort. Agents should also report verification evidence in the notebook or
their response.

When a reveal precedes resolution, wait for its full hold before calling
`resolve()`. Lens keeps the resolution receipt behind the reveal so the person
first sees the result and then its final acknowledgement.

## Resolve moves selections into History

**Resolve** is the revision-checked state change that marks work on one or more
Open selections as addressed. It validates the complete batch before changing
state, releases each selection image, appends one History entry per selection,
and returns the new selection-state revision.

Selections resolved in one call share the resulting revision and optional
resolution summary. One missing selection or a stale expected revision leaves
the whole batch Open.

The state change commits before the browser notification is sent. A delivery
failure can suppress the temporary receipt, while the History entries remain
committed.

## History entries and resolution receipts are different

A **History entry** is retained metadata for one resolved selection. It keeps
the selection label, target, point or region, note, creation time, addressed
time, resolution revision, and optional summary. It carries no selection-image
bytes.

A **resolution receipt** is the temporary browser acknowledgement for one
atomic `resolve()` call. Each browser document shows the resolved selections
whose targets belong to that document. One call spanning several documents can
therefore produce a document-scoped receipt in each owner. Every receipt opens
the matching History revision.

Activity and reveal share the same presentation slot with the receipt. Reveal
keeps a queued receipt for presentation after the reveal hold. Activity clears
a receipt that already appeared. Hover or focus pauses receipt dismissal. When
interaction ends, the receipt receives a fresh six-second display interval.

History is bounded to the newest 64 entries within 64,000 UTF-8 bytes. Lens
evicts oldest entries to remain inside both limits. History lasts for the live
Lens instance and is released when the instance closes.

## Reopen restores attention

Press **Reopen** on a History entry while its target is available to restore
that selection as current in **Open**. Lens keeps the original History entry
and starts a fresh selection-image capture against the current target.

When the target is unavailable, Reopen leaves the History entry unchanged.
Restore the target in the same browser document, then try again.

The current reopened selection can expose `previousResolution` through
`LensContext.references`. It records the prior addressed time and optional
summary. Clearing History removes that prior-resolution metadata from Open
selections while preserving the selections themselves.

Read [Selections](../selections) for the human controls. Read
[Connect an agent](../agents) for the verified activity, reveal, and resolve
sequence. The [Python API reference](../api) defines exact method contracts.
