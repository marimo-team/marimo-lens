---
name: marimo-lens
description: >-
  Use Lens to turn a user's point, region, or note on a rendered notebook or
  configured DOM target into a bounded task against producing cells or host source. Work through a live marimo
  code-mode environment, installing and using the marimo-pair skill first when
  the current agent is not connected to one. Inspect the selected cell,
  upstream context, and available images, then show activity, verify the
  notebook or host result, reveal it, and resolve the addressed selection to History.
  Use when the user refers to "this" output, asks to address Lens selections,
  requests an overview or walkthrough, or invokes `$marimo-lens address` for
  every open selection. Treat the human's mark and note as the request, and
  return notebook evidence for their review.
---

# Work with marimo Lens

## Execution environment

Run this skill in a live marimo code-mode environment. If the current agent can
already execute code in the notebook kernel, continue with the Lens workflow.

Otherwise, install the
[marimo Pair skill](https://github.com/marimo-team/marimo-pair/tree/main/skills/marimo-pair):

```console
npx skills add https://github.com/marimo-team/marimo-pair --skill marimo-pair
```

Use `$marimo-pair` to connect to or start the notebook. Resume `$marimo-lens`
after code-mode execution is available.

Notebook discovery, connection, scratchpad execution, and general notebook
inspection and mutation belong to the active code-mode integration, such as
Pair. This skill owns Lens grounding, images, activity, reveals, and resolution.

Activate this workflow after the request identifies Lens work through a
selection, output reference, overview, or walkthrough.

Use [reference/workflow.md](reference/workflow.md) for Lens-specific kernel-call
recipes, image-byte handling, and focused operation recovery. `SKILL.md` owns
the workflow and decision policy.

## Modes

Read the word that follows the skill invocation as the mode. `$marimo-lens`
alone routes from the request and `snapshot.current`.

`$marimo-lens address` inspects every outstanding selection in
`snapshot.references["selections"]`, including its note and cell or image
evidence. Address each actionable request, verify the result, then resolve its
selection. Keep ambiguous, blocked, or unverified selections open and report
why.

## Choose the mounted target scope

Read the notebook and current browser surface before creating a Lens cell.

- Use `Lens()` for an ordinary marimo notebook. Notebook outputs are selectable
  by default.
- A host integration may supply `dom_selector` for additional rendered roots.
  Read that host's skill or public API and reuse its selector policy. Do not
  copy host element names into this workflow. Choose light-DOM roots and let
  Lens follow interactions into their open shadow trees.
- Compose task-specific page regions into the host selector when feedback can
  target structure, copy, spacing, or styling. Avoid `*` and selectors that
  turn every nested wrapper into a target.

For an ordinary notebook, `lens_agent.add_lens_cell(ctx)` mounts the default
Lens. A host document may require an authored Lens cell so it can pass and
render the host-owned selector. Follow the host skill for that mount.

```python
from marimo_lens import Lens

lens = Lens()
lens
```

## Connect and read the request

Connect to Lens and take one detached context snapshot in the same
kernel call:

```python
import json

import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

ctx = cm.get_context()
mounted = lens_agent.connect(ctx)
snapshot = mounted.context()
selection = snapshot.current
available_cell = (
    next(
        (cell for cell in selection["cells"] if cell["status"] == "available"),
        None,
    )
    if selection is not None
    else None
)
if (
    selection is not None
    and selection["target"]["kind"] == "notebook"
    and available_cell is not None
):
    mounted.start_activity(
        available_cell["id"],
        label="Inspecting selected output",
        message="Reading the marked view and its producing cell.",
    )
print(
    json.dumps(
        {
            "identity": mounted.identity,
            "revision": snapshot.revision,
            "current": snapshot.current,
            "selections": [
                {
                    "id": selection["id"],
                    "target": selection["target"],
                    "cells": selection["cells"],
                }
                for selection in snapshot.references["selections"]
            ],
            "selectionCount": len(snapshot.references["selections"]),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
)
```

Use `ctx` for notebook cells, graph relationships, globals, and runtime status.
Use `snapshot` for Lens targets, bounded context, and captured evidence.

Keep `mounted.identity` and `snapshot.revision` together. Reconnect in later
kernel calls with `connect(cm.get_context(), identity=identity)`. Retry without
the saved identity when that Lens becomes unavailable.

Passing `ctx` lets `connect()` reuse an existing Lens object from notebook
globals before considering a new Lens cell. When the first `connect(ctx)` call
without an identity reports `lens_unavailable`, use the
[mount recipe](reference/workflow.md#mount-lens-when-unavailable) for a notebook
or follow the host integration's mount workflow. Connect again in a fresh
kernel call after the target document renders Lens.

Keep the first read compact. Print the identity, revision, current selection,
and selection count. Do not print `snapshot.text`, every cell body, or the full
notebook graph during connection. Read the selected cell and the bounded graph
ancestors needed for the request, then expand only when a concrete uncertainty
requires another cell.

In selection-address mode, do not iterate over `ctx.cells` or print a notebook
inventory. Notebook-order enumeration belongs to explicit overview and
walkthrough requests.

When `connect(ctx)` reports `lens_ambiguous`, reconnect with a saved identity.
Without an identity, ask the user to close or remove extra Lens instances.
Report Lens as unavailable when adding or rendering the Lens cell fails.

`snapshot.current` is the likely referent for "this", "here", or "the selected
target". The explicit request takes priority over an older selection note. An
empty selection list describes the current attention state. Continue an
explicit overview or walkthrough through the notebook's ordered cells and
graph.

## Start meaningful activity

Call `start_activity()` as soon as the primary work cell is known. Start it in
the initial context call when the current selection already identifies that
cell. For a visual or deictic request, begin with a neutral cell-grounded label
such as `Inspecting selected output`. Update the activity after image inspection
when a more specific label is supported. Do this before extended context
loading, planning, mutation, or verification.

Use the selected or edited cell as the activity target for notebook work. For a
DOM target, use the host integration's status surface while editing its source.
For an overview, use the first inspected cell whose ID is present in
`ctx.graph.cells`. Start activity again when the primary target changes. A
direct result can proceed to `reveal()`.

Leave `duration_ms` unset for work spanning context, edits, execution, and
verification, then call `stop_activity(cell_id)` when that work finishes. Pass
`duration_ms` for a bounded status that should clear itself after its hold.

## Inspect the required evidence

Route work from `selection["target"]["kind"]` before planning a mutation:

- `notebook`: Inspect the producing cell and its required graph neighbors.
- `dom`: Use `documentPath` and `domSelector` to locate the authored view region.
  Treat `cells` as related provenance. A DOM target can have no producing cell.

Use the host integration's skill and source tools for authored view changes and
browser handoff. The exact selector locates the rendered element.
`domHint.path`, labels, and text provide a shorter readable description.
Inspect computed styles and nearby elements fresh in the browser when the
request needs them.

Read selected cells and required graph neighbors before changing notebook
logic. `snapshot.text` contains bounded standalone context. For an aggregate
mark, identify the plotted measure and its entity key. When an upstream join
can multiply entities, compare the row count with the distinct entity count and
name the plotted unit precisely.

For an overview, use `ctx.cells` for notebook order and `ctx.graph.cells` for
executable graph membership. Read non-graph cells when they clarify the
narrative, but do not use them as activity or reveal targets. Choose a short
graph-member route through setup, inputs, transformations, and results, and
reveal that route in notebook order when the selection list is empty too.

Selection PNGs are annotated capture-time evidence. Read the selection PNG
when it supplies the required visual context. Start a fresh cell capture when
the task depends on the current full-cell rendering, such as after a mutation.
Do not start a full-cell capture as an optional side effect.

For a point or region request about a visible mark, open the selection PNG
before naming the mark, chart interval, trend, color, layout, or activity task.
A DOM hint locates nearby rendered content. Treat its text and path as supporting
evidence, not visual truth. Make visual claims only after the image reader
returns visible pixels.

```python
selection = snapshot.current
selection_png = snapshot.images.get(selection["id"]) if selection is not None else None
selection_status = selection["snapshot"]["status"] if selection is not None else None
cell_png = None
```

A `selection_status` of `outdated` means the marker moved after
`selection_png` was captured.

### Address every open selection

In address mode, build one workset from every open selection and its annotated
capture-time image:

```python
address_workset = [
    {
        "selection": selection,
        "selection_png": snapshot.images.get(selection["id"]),
    }
    for selection in snapshot.references["selections"]
]
```

Inspect each workset item's note, target, producing cell statuses, and snapshot status.
Open each available `selection_png` before making a visual claim about that
selection. Several selections can point to one target while marking
different evidence, so inspect each annotated image. Keep blocked or ambiguous
items in the workset until they can be reported as open.

Request a fresh cell PNG after confirming that a notebook cell is available.
Follow the [cell-image recipe](reference/workflow.md#capture-a-current-cell-image)
across kernel calls. Finish the current capture before requesting another cell.

When the image reader requires a path, use the
[image-byte recipe](reference/workflow.md#write-image-bytes-for-inspection).
Delete the private path after the image reader returns. Make visual claims only
after it returns visible pixels.

When the reader reports that the current model or session cannot display
images, treat visual inspection as unavailable for the rest of that session.
Delete the temporary path and skip later image-reader calls unless the reader
capability changes. Verify through code, data, cell status, and errors. State
the visual coverage limit in the final response, and attribute appearance
claims supplied by the user or a source to that observer.

## Apply, verify, and present

Keep activity visible through context gathering, edits, execution, and fresh
verification for notebook work. Start activity on a new result cell as soon as
its returned cell ID is available. Verify changed cells in a fresh kernel call.
Each claimed result must be idle and free of relevant errors. Inspect a fresh
cell image for notebook visual work.

For host view work, inspect the saved source, activate the exact view, and
collect fresh browser evidence at desktop and narrow widths. Compare the result
with the selection PNG. A notebook cell capture does not prove page layout,
CSS, or authored DOM behavior.

Give each activity and reveal a contextual `label`. Name the notebook object
and action or result, such as `Joining artist records`, `Checking image
coverage`, `Source tables`, or `Updated chart`. Use `message` for one concise
supporting sentence. Vary labels across a walkthrough.

Keep labels within 40 UTF-16 code units. Activity messages accept 240 UTF-16
code units, reveal messages accept 1,000, and resolution summaries accept 240.
Prefer short text that leaves detailed evidence in the notebook cell.

When the request asks for the next view, add the smallest view that answers the
immediate uncertainty. Verify and return that result before pursuing analyses
that belong to likely follow-up questions.

Create output-facing result cells with `hide_code=True` unless the user asks to
inspect the implementation. This keeps the result cell compact enough for
activity and reveal framing.

When an existing verified cell already answers the request, take the no-change
path. Read that cell, confirm its status and relevant errors, inspect a fresh
cell image when the claim is visual, then reveal and resolve. Do not enumerate
the full notebook or create a duplicate cell.

After verification succeeds, call `stop_activity(cell_id)` for persistent
activity. Timed activity may be stopped early or allowed to finish its hold.
Reveal verified results in reading order. Set each `duration_ms` long enough for
the user to orient to the cell and read its message comfortably. Use one kernel
call per reveal, print the hold, and wait for it before sending the next.

Reveal the primary result before resolving its selections. Start with
`revision = snapshot.revision`. Resolve selections together when they share one
verified result. When results or rationales differ, assign the revision returned
by each call and carry it into the next call. Follow the
[presentation recipe](reference/workflow.md#present-and-resolve-across-calls)
for the kernel-call sequence.

The addressed receipt is the final presentation. Keep its summary to one short
sentence of at most 240 UTF-16 code units. Put detailed evidence in notebook
cells and reveal messages. On `revision_conflict`, leave selections open,
reconnect, and reassess a fresh context.

Finish after the walkthrough when no selection was addressed. Keep selections
open when verification fails or the next step needs user input. Leave activity
visible with a concrete label and message that describe that state.

Delete every temporary image path after its final image-reader call.
