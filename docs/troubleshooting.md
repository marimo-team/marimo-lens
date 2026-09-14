---
title: Troubleshooting
description: Recover unavailable targets, failed image capture, stale revisions, code-mode connection failures, and browser capture errors.
---

# Troubleshooting

Start from the visible symptom or `LensError.code`. Each recovery names the
action to take and the result that confirms Lens is ready again.

The [error reference](/reference/errors) lists every public error code. The
[Target model](/concepts/targets) and [Evidence model](/concepts/evidence)
explain the identities and lifecycle states used in these recoveries.

## Target is unavailable

**Symptom:** An Open row says **Target unavailable**, its marker is absent, or
activity appears as a dock notice while no ring surrounds the target.

**Action:** Check the target kind in the current selection reference.

- For a notebook target, run the same cell and make sure its output is visible.
- For a configured DOM target, restore its stable element ID. Confirm that it
  still matches `dom_selector` and carries the same producing cells and notebook
  source identities. Reselect an unkeyed element after replacing it.
- After a page reload, remove the older selection and make a new one in the new
  document.

**Result:** The marker reappears on the same target and **Target unavailable**
disappears from the Open row.

Keep the target unavailable when the page now represents a different object.
The selection retains its note and any image whose capture previously succeeded,
so you can inspect or remove it.

## Image is unavailable or outdated

**Symptom:** The image action says **Preparing image**, **Image unavailable**, or
**View previous image**. The selection reference reports `pending`, `failed`, or
`outdated`.

**Action:** Match the recovery to the status.

| Status     | Action                                                                                                                          | Expected result                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pending`  | Keep the target rendered while capture completes.                                                                               | Status becomes `available` and **View image** opens the preview.       |
| `failed`   | Restore a stable target and accessible resources, then move the marker or make a new selection.                                 | A new capture becomes `available`.                                     |
| `outdated` | Keep the target visible while replacement capture runs. Move the marker again or reselect when the previous replacement failed. | A fresh image replaces the prior image and status becomes `available`. |

Text, target, producing-cell, and note evidence remain available when image capture
fails. An agent can continue from that evidence when the task does not require a
visual claim.

## Selector is invalid

**Symptom:** Lens reports `Lens dom_selector is invalid` while mounting, or no
configured DOM targets appear.

**Action:** Test the same selector in the Lens document and keep it within 1,024
UTF-16 code units.

```js
document.querySelectorAll("#app-shell :is(header, section, article)");
```

Use a non-empty selector that matches authored roots in the document's light
DOM. Elements inside another document or inside a shadow root cannot be matched
directly by `dom_selector`. Select their light-DOM host root when that host should
own the selection.

**Result:** Lens mounts. In selection mode, Lens highlights an eligible root as
the person hovers it or cycles through targets with the keyboard.

When a selector is valid but one root is missing, give that root a stable unique
ID and check its producing-cell metadata against the [host contract](/concepts/targets#host-contract).

## Iframe or resource content blocks image capture

**Symptom:** The selection exists, but its image reports a capture failure. The
target contains an external iframe, a cross-origin image, or another
browser-protected resource.

**Action:** Keep the selection Open and choose one of these paths:

1. Continue from the selection note, DOM hint, producing cells, and graph context
   when they are enough to complete the task.
2. Make the iframe or resource same-origin when you own its delivery.
3. Select a target outside the inaccessible content.

**Result:** The text-grounded workflow can proceed immediately, or a new capture
reaches `available` after the target contains accessible content.

Same-origin iframe documents can receive pointer and keyboard selection events.
Image capture still requires every nested iframe document to remain accessible
throughout rasterization.

## Lens is already active

**Symptom:** A mounted value shows **Lens is already active**.

**Action:** Use the first displayed Lens in that browser document. Close or
remove the duplicate view after its work is complete.

**Result:** One dock owns selection gestures, target attention, and cell-output image
capture in that document. Ownership passes to the next displayed view when the
current owner closes.

This browser message is separate from `lens_ambiguous`. A code-mode connection
can find several Python Lens instances even when one browser view owns the dock.

## Code mode reports `lens_ambiguous`

**Symptom:** `marimo_lens.agent.connect()` raises
`LensError(code="lens_ambiguous")`.

**Action:** Reconnect with the `MountedLens.identity` saved from the intended
Lens. If you have no saved identity, use `lens_agent.discover(ctx)` to inspect
available handles and their current selections. See [Find an existing instance](./agents#find-an-existing-instance).

```python
mounted = lens_agent.connect(ctx, identity=saved_identity)
```

**Result:** `mounted.identity` matches the saved identity and subsequent calls
address the same Lens instance.

## A selection revision is stale

**Symptom:** Activity, reveal, cell-output capture, or resolution raises
`LensError(code="revision_conflict")`.

**Action:** Read a fresh context, find the intended selection again by ID, and
reassess the request against its current note, target, and evidence. Pass the
fresh `context.revision` to the next guarded call.

```python
context = mounted.context()
selection = next(
    item for item in context.references["selections"] if item["id"] == selection_id
)
```

**Result:** The guarded call succeeds against the current selection state.

A selection-state revision changes when selections are created, activated,
edited, moved, removed, resolved, reopened, or cleared. It tracks selection
state independently from notebook cell revisions.

## Code mode cannot find Lens

**Symptom:** `connect()` raises `LensError(code="lens_unavailable")`, or the
active agent has no advertised `lens` capability.

**Action:** Confirm that `marimo-lens` is installed in the active notebook
environment and import its agent adapter there.

```python
import marimo_lens.agent as lens_agent

print(lens_agent.agent_skill() / "SKILL.md")
```

Lens registers `marimo_lens.agent` in marimo's `marimo.agent.capability`
entry-point group. Restart the notebook runtime after installing the package so
marimo can discover the new capability.

If the package is installed and no Lens exists, follow [Add Lens when the
notebook has none](/agents#add-lens-when-the-notebook-has-none). End the kernel
call after `add_lens_cell(ctx)` so the browser can render and register the new
Lens before calling `connect()` again.

**Result:** `lens_agent.connect(ctx)` returns a `MountedLens` and
`mounted.context()` returns the current detached context.

Use [marimo Pair](https://github.com/marimo-team/marimo-pair/tree/main/skills/marimo-pair)
when the agent still needs a live marimo code-mode connection.

## Cell-output image returns `None`

**Symptom:** `mounted.cell_image()` returns `None` on its first call.

**Action:** Save the Lens identity, cell ID, and selection revision. End the
current kernel call so the browser can respond. Reconnect and call `cell_image()`
again with the same cell ID and revision.

**Result:** The completed call returns and consumes the current unannotated PNG.

`None` means capture is pending. A terminal failure raises `LensError`.

## Cell or capture operation raises an error

Use the code to choose the recovery:

| Error code            | Action                                                                                                              | Expected result                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `browser_unavailable` | Display one Lens and wait for its browser view to register.                                                         | A new cell-output image request starts.               |
| `runtime_unavailable` | Run the call inside the active marimo code-mode kernel. Keep the selection Open.                                    | `mounted.context()` can inspect the live graph.       |
| `cell_not_found`      | Read fresh context and use a cell ID that still belongs to the graph.                                               | The target cell validates.                            |
| `output_unavailable`  | Run the cell and keep its rendered output visible.                                                                  | The browser finds the canonical output.               |
| `capture_busy`        | Poll the active cell with the same cell ID and revision until it returns bytes or a terminal error.                 | The capture slot becomes available for the next cell. |
| `capture_timeout`     | Stabilize the rendered output and request the cell-output image again.                                              | The new capture completes within its deadline.        |
| `capture_failed`      | Remove inaccessible iframe or resource content, keep the output stable, and retry when current pixels are required. | The new capture returns PNG bytes.                    |
| `lens_closed`         | Reconnect to another mounted Lens or render a new Lens.                                                             | The new handle accepts context and feedback calls.    |

Read [Inspect current cell-output pixels](/agents#inspect-current-cell-output-pixels) for the
polling workflow and [Errors](/reference/errors) for argument validation,
revision fields, and the complete error catalog.
