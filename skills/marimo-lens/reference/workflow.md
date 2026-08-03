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

Reconnect to the same Lens in later calls:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
```

Route the request from the context and the user's instruction:

| Request and context                                     | Continue with                    |
| ------------------------------------------------------- | -------------------------------- |
| Overview or walkthrough with any selection count        | Ordered notebook cells and graph |
| Request referring to "this" or the selected output      | `snapshot.current` and its cell  |
| Explicit task with an unrelated older current selection | Explicit task                    |

Leave an unrelated selection open.

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
returns visible pixels. When the reader cannot display the image, use code,
data, cell status, and errors as nonvisual evidence and report that visual
inspection was unavailable.

## Inspect a fresh cell image

`cell_image()` captures the current rendered cell without Lens markers. Start
capture after taking the context snapshot:

```python
png = mounted.cell_image(
    selection["outputCellId"],
    expected_revision=snapshot.revision,
)
print("ready" if png is not None else "pending")
```

The first call starts capture and returns `None`. Repeat the call in later
kernel executions:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
    png = mounted.cell_image("BYtC", expected_revision=8)
    if png is not None:
        from tempfile import NamedTemporaryFile

        with NamedTemporaryFile(
            prefix="marimo-lens-", suffix=".png", delete=False
        ) as image_file:
            image_file.write(png)
            print(image_file.name)
```

Pending calls share the same browser capture. Lens has one full-cell capture
slot. Finish the current cell with bytes or a terminal `LensError` before
starting another cell. A different cell while capture is pending raises
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

Start it in the initial connection call when `snapshot.current` identifies the
work cell. Keep it visible through extended context, images, planning, edits,
execution, and verification. Start activity again when the primary target
changes.

Persistent activity leaves `duration_ms` unset and ends with
`stop_activity(cell_id)`. A bounded status can pass `duration_ms=8_000` and
clear itself after that hold. Starting timed activity again on the same cell
restarts its hold.

For a new result cell, create a visible comment-only placeholder in its own
kernel call:

```python
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    cell_id = ctx.create_cell(
        "# Preparing the requested chart",
        hide_code=False,
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
    ctx.edit_cell(cell_id, "chart = build_chart(source_df)\nchart")
    ctx.run_cell(cell_id)
```

Read each current cell body before replacing it. Submit the full new body and
queue affected cells to run in one code-mode block.

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

Wait for `hold_ms`, then resolve through a fresh kernel call using the revision
captured before the work:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity="F3n...")
    mounted.resolve(
        ["243110...", "8b20f4..."],
        expected_revision=8,
        summary="Updated the aggregation and verified the chart.",
    )
```

Resolve selections together when they share one verified result. Use separate
calls when changes or rationales differ. Resolve after the final reveal hold so
the receipt is the final presentation. Keep `summary` to one short sentence of
at most 240 UTF-16 code units. Put detailed evidence in notebook cells and
reveal messages.

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
- Pending cell PNG: repeat `cell_image()` with the same cell and revision.
- Cell-image `LensError`: continue from nonvisual evidence or retry after the
  output settles.
- Image-reader failure: continue from nonvisual evidence and report the visual
  coverage limit.

Delete every temporary image path after its final image-reader call.
