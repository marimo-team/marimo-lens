---
name: marimo-lens
description: >-
  Ground work in a user's point or region selections, or guide the user through
  existing outputs in a live marimo notebook. Inspect relevant cells and
  optional images, show agent activity, reveal results in reading order, and
  move addressed selections to Lens History. Use with a live marimo kernel
  executor. The `address` mode, written `marimo-lens address`, sweeps every
  outstanding selection. Use this skill when the user mentions a Lens selection,
  asks to resolve a Lens request, points to "this" notebook output, requests a
  notebook overview, or asks for a guided walkthrough across notebook cells.
---

# Work with marimo Lens

Run this skill alongside a live marimo kernel executor such as `marimo-pair`.
The executor supplies kernel calls, code-mode mutation, and runtime
verification. This skill owns Lens grounding, images, activity, reveals, and
resolution.

Activate this workflow after the request identifies Lens work through a
selection, output reference, overview, or walkthrough. A generic kernel
connection or toast remains with the executor.

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
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx)
    snapshot = mounted.context()
    selection = snapshot.current
    if selection is not None and selection["cellStatus"] == "available":
        mounted.start_activity(
            selection["outputCellId"],
            label="Tracing selected result",
            message="Reading its producing cell and relevant inputs.",
        )
    print(mounted.identity)
    print(snapshot.revision)
    print(snapshot.current)
```

Keep `mounted.identity` and `snapshot.revision` together. Reconnect in later
kernel calls with `connect(ctx, identity=identity)`. Read a fresh context when
`connect()` reports `lens_unavailable`.

Ask the user to leave one Lens mounted when `connect()` reports
`lens_ambiguous`. Report Lens as unavailable when the request explicitly
depends on it and `connect()` reports `lens_unavailable` without an identity.

`snapshot.current` is the likely referent for "this", "here", or "the selected
output". The explicit request takes priority over an older selection note. An
empty selection list describes the current attention state. Continue an
explicit overview or walkthrough through the notebook's ordered cells and
graph.

## Start meaningful activity

Call `start_activity()` as soon as the primary work cell and a meaningful label
are known. Start it in the initial context call when the current selection
already identifies that cell. Do this before extended context loading, image
inspection, planning, mutation, or verification.

Use the selected or edited cell as the activity target. For an overview, use
the first inspected cell whose ID is present in `ctx.graph.cells`. Start
activity again when the primary target changes. A direct result can proceed to
`reveal()`.

Leave `duration_ms` unset for work spanning context, edits, execution, and
verification, then call `stop_activity()` when that work finishes. Pass
`duration_ms` for a bounded status that should clear itself after its hold.

When the result needs a new cell, first create a visible comment-only
placeholder such as `# Preparing the requested chart`. Start activity on its
returned cell ID in the next kernel call, then replace and run that same cell.

## Inspect the required evidence

Read the selected cell and its required graph neighbors before planning a
mutation. `snapshot.text` contains bounded standalone context. For an aggregate
mark, identify the plotted measure and its entity key. When an upstream join
can multiply entities, compare the row count with the distinct entity count and
name the plotted unit precisely.

For an overview, inspect ordered cells and graph edges through the executor.
Choose a short route through setup, inputs, transformations, and results.
Reveal those cells in notebook order when the selection list is empty too.

Selection PNGs are annotated capture-time evidence. Read the selection PNG
when it supplies the required visual context. Start a fresh cell capture when
the task depends on the current full-cell rendering, such as after a mutation.
Do not start a full-cell capture as an optional side effect.

```python
selection = snapshot.current
selection_png = snapshot.images.get(selection["id"]) if selection is not None else None
selection_status = selection["snapshot"]["status"] if selection is not None else None
cell_png = None
```

A `selection_status` of `outdated` means the marker moved after
`selection_png` was captured.

Request a fresh cell PNG after confirming that the output cell is available:

```python
cell_id = selection["outputCellId"]
cell_png = mounted.cell_image(
    cell_id,
    expected_revision=snapshot.revision,
)
```

The first call starts capture and returns `None`. Save the Lens identity, cell
ID, and revision, then repeat the same call in later kernel executions until it
returns bytes or raises a terminal `LensError`. A pending capture owns Lens's
single full-cell capture slot. Finish it before requesting another cell, even
when the task no longer needs the bytes. A different cell while capture is
pending raises `LensError(code="capture_busy")`.

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

Keep activity visible through context gathering, edits, cell creation,
execution, and fresh verification. Verify changed cells in a fresh kernel call.
Each claimed result must be idle and free of relevant errors. Inspect a fresh
cell image for visual work.

Give each activity and reveal a contextual `label`. Name the notebook object
and action or result, such as `Joining artist records`, `Checking image
coverage`, `Source tables`, or `Updated chart`. Use `message` for one concise
supporting sentence. Vary labels across a walkthrough.

After verification succeeds, call `stop_activity(cell_id)` for persistent
activity. Timed activity may be stopped early or allowed to finish its hold.
Reveal verified results in reading order. Set each `duration_ms` long enough for
the user to orient to the cell and read its message comfortably. Use one kernel
call per reveal, print the hold, and wait for it before sending the next.

Reveal the primary result before resolving its selections. After the final
hold, call `resolve()` with the revision captured before the work. The addressed
receipt is the final presentation. Keep its summary to one short sentence of at
most 240 UTF-16 code units. Put detailed evidence in notebook cells and reveal
messages. On `revision_conflict`, leave selections open, reconnect, and reassess
a fresh context.

Finish after the walkthrough when no selection was addressed. Keep selections
open when verification fails or the next step needs user input. Leave activity
visible with a concrete label and message that describe that state.

Delete every temporary image path after its final image-reader call.
