# marimo Lens agent workflow

Use these snippets through a live marimo kernel executor. With `marimo-pair`,
resolve `PAIR_EXECUTE` to its `scripts/execute-code.sh` and target the notebook
with its URL, port, or session arguments.

Each kernel call has a fresh scratchpad namespace. Import
`marimo_lens.agent` in every snippet that uses it.

Enter this workflow after the request identifies Lens work through a selection,
output reference, overview, or walkthrough. Leave a generic kernel connection
or toast to the executor.

## Connect and take a context snapshot

Connect and read the current Lens state in one kernel call:

```python
import json

import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx)
    snapshot = mounted.context()
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
                "imageSelectionIds": list(snapshot.images),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
```

Keep the returned identity and revision. When a current selection exists, also
keep its `id` and `outputCellId`.

Keep this connection payload compact. Do not print `snapshot.text`, every cell
body, or the complete graph. Read the selected cell and required bounded
ancestors after routing the request.

In selection-address mode, do not iterate over `ctx.cells` or print a notebook
inventory. Reserve notebook-order enumeration for explicit overview and
walkthrough requests.

Reconnect to the same Lens in later calls:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
```

Route the request from the context and the user's instruction:

| Request and context                                     | Continue with                             |
| ------------------------------------------------------- | ----------------------------------------- |
| `address` mode                                          | Every entry in `references["selections"]` |
| Overview or walkthrough with any selection count        | Ordered notebook cells and graph          |
| Request referring to "this" or the selected output      | `snapshot.current` and its cell           |
| Explicit task with an unrelated older current selection | Explicit task                             |

Outside `address` mode, leave an unrelated selection open.

## Inspect selection evidence

`snapshot.text` contains bounded standalone text. Read selected cell code and
graph neighbors through the executor's code-mode API. For an aggregate mark,
identify the plotted measure and its entity key. When an upstream join can
multiply entities, compare row count with distinct entity count before naming
the plotted unit.

Get the current selection's annotated capture-time PNG in the same call that
created the context:

```python
selection = snapshot.current
selection_png = snapshot.images.get(selection["id"]) if selection is not None else None
selection_status = selection["snapshot"]["status"] if selection is not None else None
```

A `selection_status` of `outdated` means the marker moved after
`selection_png` was captured.

### Address every open selection

In address mode, pair every open selection with its annotated capture-time
image:

```python
address_workset = [
    {
        "selection": selection,
        "selection_png": snapshot.images.get(selection["id"]),
    }
    for selection in snapshot.references["selections"]
]
```

Inspect each item's note, output cell, cell status, and snapshot status. Open
each available `selection_png` before making a visual claim about that
selection. Multiple selections on one cell can mark different evidence. Keep
blocked or ambiguous items open and report why.

For a point or region request about visible content, open `selection_png`
before naming the mark, interval, trend, layout, or task. DOM-hint text locates
nearby rendered content and does not establish a visual claim by itself.

Write available bytes to a private temporary PNG:

```python
from tempfile import NamedTemporaryFile

if selection_png is not None:
    with NamedTemporaryFile(
        prefix="marimo-lens-", suffix=".png", delete=False
    ) as image_file:
        image_file.write(selection_png)
        print(image_file.name)
```

Open the printed path with the image reader, then delete it. The kernel and
image reader must share a filesystem. Make visual claims after the reader
returns visible pixels.

When the reader reports that the current model or session cannot display
images, treat visual inspection as unavailable for the rest of that session.
Delete the temporary path and skip later image-reader calls unless the reader
capability changes. Use code, data, cell status, and errors as nonvisual
evidence. State the visual coverage limit in the final response, and attribute
appearance claims supplied by the user or a source to that observer.

## Inspect a fresh cell image

`cell_image()` captures the current rendered cell without Lens markers. Start
capture after taking the context snapshot when the task requires the current
full-cell rendering. Do not start a full-cell capture as an optional side
effect:

```python
png = mounted.cell_image(
    selection["outputCellId"],
    expected_revision=snapshot.revision,
)
print("ready" if png is not None else "capture_pending")
```

The first call starts capture and returns `None`. End that kernel execution so
marimo can dispatch the browser response. Reconnect in a fresh execution with
the saved Lens identity, then repeat the same call:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
    png = mounted.cell_image("BYtC", expected_revision=8)
    print("ready" if png is not None else "capture_pending")
```

Let `ready`, `capture_pending`, or a terminal `LensError` drive each next step.
Do not sleep inside a kernel execution. A pending capture owns Lens's single
full-cell capture slot. Finish that cell before requesting another one. A
different cell while capture is pending raises
`LensError(code="capture_busy")`. Capture several cells sequentially.

## Start activity on the work cell

Start activity as soon as the primary target and a contextual label are known:

```python
mounted.start_activity(
    "BYtC",
    label="Applying bar colors",
    message="Applying the requested color to the selected chart.",
)
```

For visual or deictic requests, begin with a neutral label such as `Inspecting
selected output`. Update it after opening the selection PNG when the visible
evidence supports a more specific task name. Labels accept at most 40 UTF-16
code units. Activity messages accept 240.

Start it in the initial connection call when `snapshot.current` identifies the
work cell. Keep it visible through extended context, images, planning, edits,
execution, and verification. Start activity again when the primary target
changes.

Persistent activity leaves `duration_ms` unset and ends with
`stop_activity(cell_id)`. A bounded status can pass `duration_ms=8_000` and
clear itself after that hold. Starting timed activity again on the same cell
restarts its hold.

For a new result cell, create a rendered placeholder with hidden code in its
own kernel call:

```python
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    cell_id = ctx.create_cell(
        '"Preparing the requested chart"',
        hide_code=True,
    )
    print(cell_id)
```

Start activity on that cell in the next call, then replace and run it:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
    cell_id = "new-cell-id"
    mounted.start_activity(
        cell_id,
        label="Building requested chart",
        message="Replacing the placeholder with the chart implementation.",
    )
    ctx.edit_cell(
        cell_id,
        "chart = build_chart(source_df)\nchart",
        hide_code=True,
    )
    ctx.run_cell(cell_id)
```

Read each current cell body before replacing it. Submit the full new body and
queue affected cells to run in one code-mode block.

Keep output-facing result code hidden unless the user asks to inspect the
implementation. A compact cell lets activity and reveal framing show the full
result when its rendered height fits in the viewport.

When the user asks for the next view, add the smallest view that resolves the
current uncertainty. Return it before pursuing likely follow-up analyses.

When a verified cell already answers the request, inspect that cell and its
status, capture it when the claim is visual, then reveal and resolve. Skip full
notebook enumeration and duplicate cell creation.

## Walk through an existing notebook

For an overview, inspect `ctx.cells` in notebook order and use `ctx.graph` to
identify setup, inputs, transformations, and results. Start activity on the
first inspected cell whose ID is present in `ctx.graph.cells`. A walkthrough
can target existing cells when `snapshot.current` is `None`.

Reveal one cell per kernel call and wait for its hold before continuing:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
    hold_ms = 8_000
    mounted.reveal(
        "setup-cell",
        duration_ms=hold_ms,
        label="Source tables",
        message="Loads the tables used by the analysis.",
    )
    print(hold_ms)
```

Set the hold long enough for the user to orient to the cell and read the
message comfortably. Allow more time for longer or denser messages.

## Verify, reveal, and resolve

Verify mutations in a fresh kernel call. Check the target and every cell needed
to support the result. Each claimed cell must be idle and free of relevant
errors. Capture a fresh cell image for visual work.

After verification succeeds, stop activity and reveal the result:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
    mounted.stop_activity("BYtC")
    hold_ms = 8_000
    mounted.reveal(
        "BYtC",
        duration_ms=hold_ms,
        label="Updated aggregation",
        message="Updated the aggregation and verified the output.",
    )
    print(hold_ms)
```

Reveal labels accept at most 40 UTF-16 code units and reveal messages accept
1,000. Resolution summaries accept 240.

Wait for `hold_ms`, then resolve through a fresh kernel call using the revision
captured before the work:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
    revision = mounted.resolve(
        ["243110...", "8b20f4..."],
        expected_revision=8,
        summary="Updated the aggregation and verified the chart.",
    )
    print(revision)
```

Resolve selections together when they share one verified result. Use separate
calls when changes or rationales differ. For each separate group, pass the
revision returned by the previous `resolve()` call. Resolve after the final
reveal hold so the receipt is the final presentation. Keep `summary` to one
short sentence of at most 240 UTF-16 code units. Put detailed evidence in
notebook cells and reveal messages.

On `revision_conflict`, leave selections open, reconnect, and take a fresh
context. Keep selections open and activity visible when verification fails or
user input is required. Update the activity label and message to describe that
state.

## Operation failures

- `lens_unavailable`: connect again without an identity, or report that Lens is
  unavailable when no instance is mounted.
- `lens_ambiguous`: ask the user to leave one Lens mounted.
- `revision_conflict`: reconnect and reassess a fresh context.
- `selection_not_found`: reconnect and inspect the current selection.
- `capture_busy`: finish polling the current cell before requesting another.
- Missing selection PNG: continue from text and graph evidence.
- Pending cell PNG: end the current execution and repeat `cell_image()` with
  the same cell and revision in a fresh execution.
- Cell-image `LensError`: continue from nonvisual evidence or retry after the
  output settles.
- Image-reader capability failure: delete the temporary path, skip later calls
  to the same reader, continue from nonvisual evidence, and report the visual
  coverage limit.

Delete every temporary image path after its final image-reader call.
