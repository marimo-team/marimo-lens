---
name: marimo-lens
description: >-
  Use Lens to turn a user's point, region, or note on rendered notebook output
  into a bounded task against the producing cells. Connect through
  `marimo._code_mode`, inspect the selected cell, upstream context, and
  available images, then show activity, verify the notebook result, reveal it,
  and resolve the addressed selection to History. Use when the user refers to
  "this" output, asks to address Lens selections, requests an overview or
  walkthrough, or invokes `marimo-lens address` for every open selection. Treat
  the human's mark and note as the request, and return notebook evidence for
  their review.
---

# Work with marimo Lens

Run this skill through `marimo._code_mode` in a live marimo kernel. Code mode
supplies notebook inspection, mutation, execution, and runtime verification.
This skill owns Lens grounding, images, activity, reveals, and resolution.

Activate this workflow after the request identifies Lens work through a
selection, output reference, overview, or walkthrough.

Use [reference/workflow.md](reference/workflow.md) for complete mutation
templates, operation failures, and multi-cell walkthroughs. The workflow here
covers inspection and straightforward changes.

## Modes

Read the word that follows the skill name as the mode. `marimo-lens` alone
routes from the request and `snapshot.current`.

`marimo-lens address` inspects every outstanding selection in
`snapshot.references["selections"]`, including its note and cell or image
evidence. Address each actionable request, verify the result, then resolve its
selection. Keep ambiguous, blocked, or unverified selections open and report
why.

## Connect and read the request

Connect to the mounted Lens and take one detached context snapshot in the same
kernel call:

```python
import json

import marimo_lens.agent as lens_agent

mounted = lens_agent.connect()
snapshot = mounted.context()
selection = snapshot.current
if selection is not None and selection["cellStatus"] == "available":
    mounted.start_activity(
        selection["outputCellId"],
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
                    "outputCellId": selection["outputCellId"],
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

Keep `mounted.identity` and `snapshot.revision` together. Reconnect in later
kernel calls with `connect(identity=identity)`. Retry without the saved
identity when that Lens becomes unavailable.

When the first connection without an identity reports `lens_unavailable`, add
one Lens cell and end that kernel call:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    lens_agent.add_lens_cell(ctx)
```

Connect again in a fresh kernel call after the browser renders Lens.

Keep the first read compact. Print the identity, revision, current selection,
and selection count. Do not print `snapshot.text`, every cell body, or the full
notebook graph during connection. Read the selected cell and the bounded graph
ancestors needed for the request, then expand only when a concrete uncertainty
requires another cell.

In selection-address mode, do not iterate over `ctx.cells` or print a notebook
inventory. Notebook-order enumeration belongs to explicit overview and
walkthrough requests.

Ask the user to leave one Lens mounted when `connect()` reports
`lens_ambiguous`. Report Lens as unavailable when adding or rendering the Lens
cell fails.

`snapshot.current` is the likely referent for "this", "here", or "the selected
output". The explicit request takes priority over an older selection note. An
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

Use the selected or edited cell as the activity target. For an overview, use
the first inspected cell whose ID is present in `ctx.graph.cells`. Start
activity again when the primary target changes. A direct result can proceed to
`reveal()`.

Leave `duration_ms` unset for work spanning context, edits, execution, and
verification, then call `stop_activity(cell_id)` when that work finishes. Pass
`duration_ms` for a bounded status that should clear itself after its hold.

## Inspect the required evidence

Read the selected cell and its required graph neighbors before planning a
mutation. `snapshot.text` contains bounded standalone context. For an aggregate
mark, identify the plotted measure and its entity key. When an upstream join
can multiply entities, compare the row count with the distinct entity count and
name the plotted unit precisely.

For an overview, inspect ordered cells and graph edges through code mode.
Choose a short route through setup, inputs, transformations, and results.
Reveal those cells in notebook order when the selection list is empty too.

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

Inspect each workset item's note, output cell, cell status, and snapshot status.
Open each available `selection_png` before making a visual claim about that
selection. Several selections can point to one output cell while marking
different evidence, so inspect each annotated image. Keep blocked or ambiguous
items in the workset until they can be reported as open.

Request a fresh cell PNG after confirming that the output cell is available:

```python
cell_id = selection["outputCellId"]
cell_png = mounted.cell_image(
    cell_id,
    expected_revision=snapshot.revision,
)
print("ready" if cell_png is not None else "capture_pending")
```

When the call prints `capture_pending`, end that kernel execution immediately
so marimo can dispatch the browser response. Repeat the same call with the saved
Lens identity, cell ID, and revision in a fresh execution. Let the returned
state drive the loop. Do not sleep inside a kernel execution. Continue until
the call returns bytes or raises a terminal `LensError`.

A pending capture owns Lens's single full-cell capture slot. Finish the current
cell before requesting another one. A different cell while capture is pending
raises `LensError(code="capture_busy")`.

Write PNG bytes to a private temporary path visible to the image reader:

```python
from tempfile import NamedTemporaryFile

image_bytes = cell_png if cell_png is not None else selection_png
if image_bytes is not None:
    with NamedTemporaryFile(
        prefix="marimo-lens-", suffix=".png", delete=False
    ) as image_file:
        image_file.write(image_bytes)
        print(image_file.name)
```

Open the printed path, then delete it after the image reader returns. The
kernel and image reader must share a filesystem. Make visual claims after the
reader returns visible pixels.

When the reader reports that the current model or session cannot display
images, treat visual inspection as unavailable for the rest of that session.
Delete the temporary path and skip later image-reader calls unless the reader
capability changes. Verify through code, data, cell status, and errors. State
the visual coverage limit in the final response, and attribute appearance
claims supplied by the user or a source to that observer.

## Apply, verify, and present

Keep activity visible through context gathering, edits, execution, and fresh
verification. Start activity on a new result cell as soon as its returned cell
ID is available. Verify changed cells in a fresh kernel call. Each claimed
result must be idle and free of relevant errors. Inspect a fresh cell image for
visual work.

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
by each call and carry it into the next call:

```python
revision = mounted.resolve(
    selection_ids,
    expected_revision=revision,
    summary=summary,
)
print(revision)
```

The addressed receipt is the final presentation. Keep its summary to one short
sentence of at most 240 UTF-16 code units. Put detailed evidence in notebook
cells and reveal messages. On `revision_conflict`, leave selections open,
reconnect, and reassess a fresh context.

Finish after the walkthrough when no selection was addressed. Keep selections
open when verification fails or the next step needs user input. Leave activity
visible with a concrete label and message that describe that state.

Delete every temporary image path after its final image-reader call.
