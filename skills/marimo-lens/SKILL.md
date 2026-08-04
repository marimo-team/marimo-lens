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
            label="Inspecting selected output",
            message="Reading the marked view and its producing cell.",
        )
    print(mounted.identity)
    print(snapshot.revision)
    print(snapshot.current)
```

Keep `mounted.identity` and `snapshot.revision` together. Reconnect in later
kernel calls with `connect(ctx, identity=identity)`. Read a fresh context when
`connect()` reports `lens_unavailable`.

Keep the first read compact. Print the identity, revision, current selection,
and selection count. Do not print `snapshot.text`, every cell body, or the full
notebook graph during connection. Read the selected cell and the bounded graph
ancestors needed for the request, then expand only when a concrete uncertainty
requires another cell.

In selection-address mode, do not iterate over `ctx.cells` or print a notebook
inventory. Notebook-order enumeration belongs to explicit overview and
walkthrough requests.

Ask the user to leave one Lens mounted when `connect()` reports
`lens_ambiguous`. Report Lens as unavailable when the request explicitly
depends on it and `connect()` reports `lens_unavailable` without an identity.

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

Keep activity visible through context gathering, edits, cell creation,
execution, and fresh verification. Verify changed cells in a fresh kernel call.
Each claimed result must be idle and free of relevant errors. Inspect a fresh
cell image for visual work.

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

Create output-facing result cells with `hide_code=True` and a rendered
placeholder. Keep code hidden when replacing the placeholder unless the user
asks to inspect the implementation. This keeps the result cell compact enough
for activity and reveal framing.

When an existing verified cell already answers the request, take the no-change
path. Read that cell, confirm its status and relevant errors, inspect a fresh
cell image when the claim is visual, then reveal and resolve. Do not enumerate
the full notebook or create a duplicate cell.

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
