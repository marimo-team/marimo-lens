# marimo Lens agent workflow

Use these snippets through a live marimo kernel executor. With
`marimo-pair`, resolve `PAIR_EXECUTE` to its `scripts/execute-code.sh` and
target the notebook with its URL, port, or session arguments.

Each kernel call has a fresh scratchpad namespace. Import
`marimo_lens.agent` in every snippet that uses it.

## Scan mounted Lens widgets

Run one bounded scan before the first mutation:

```python
import json

import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    scans = [mounted.scan() for mounted in lens_agent.discover(ctx)]
    print(json.dumps(scans, ensure_ascii=False, sort_keys=True))
```

A scan contains the stable mounted-Lens identity, current revision, bounded
selection notes and DOM hints, and a compact summary of the current output
cell. Load PNG bytes and standalone Lens text through their explicit methods.

Keep these values from the chosen scan:

```text
identity
revision
selectionCount
current.id            # when current is present
current.outputCellId  # when current is present
```

Reconnect to the same Lens in each later call:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    matches = lens_agent.discover(ctx, identity="F3n...")
    if len(matches) != 1:
        raise RuntimeError("The mounted Lens changed. Run a fresh scan.")
    mounted = matches[0]
```

Route the request from the mounted Lens and the user's instruction:

| Request and scan state                                    | Continue with                             |
| --------------------------------------------------------- | ----------------------------------------- |
| Overview or walkthrough at any `selectionCount`           | Ordered notebook cells and graph          |
| Request referring to "this", "here", or a selected output | Current selection and its cell            |
| Explicit task with an unrelated older selection           | Explicit task, leaving the selection open |

`selectionCount: 0` describes selection state. The mounted Lens can still
reveal existing notebook cells.

## Load standalone context

Load standalone text when a relevant note or scan field was truncated:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    snapshot = mounted.context(expected_revision=8)
    print(snapshot.text)
```

Read selected cell code and graph neighbors through the executor's code-mode
API. Group relevant selections by `outputCellId` before loading code or
images.

## Walk through an existing notebook

For an overview, inspect `ctx.cells` in notebook order and use `ctx.graph` to
identify the cells that define inputs, transformations, and results. Choose a
short route that answers the user's request.

Reveal one cell per kernel call. Set `duration_ms` long enough for the user to
orient to the cell and read the message comfortably. Allow more time for longer
or denser messages. Wait for that hold before revealing the next cell because
a new reveal replaces the current one. A walkthrough can target existing cells
and does not require a selection.

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    hold_ms = 8_000
    mounted.reveal(
        "setup-cell",
        duration_ms=hold_ms,
        label="Source tables",
        message="Loads the source tables used by the analysis.",
    )
    print(hold_ms)
```

## Write a selection image

An `AgentImage` returned by Lens contains validated PNG bytes in `data`. Write
them through Python's private temporary-file API inside the active kernel:

```bash
bash "$PAIR_EXECUTE" --url "$NOTEBOOK_URL" <<'PY'
from tempfile import NamedTemporaryFile

import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    image = mounted.selection_image(
        "243110...",
        expected_revision=8,
    )
    if image is None:
        raise RuntimeError("The selection image is unavailable.")
    with NamedTemporaryFile(
        prefix="marimo-lens-",
        suffix=".png",
        delete=False,
    ) as image_file:
        image_file.write(image.data)
        print(image_file.name)
PY
```

Open the printed path with the agent's image reader
before making a claim about color, position, spacing, overlap, alignment,
legibility, or chart marks. The kernel executor and image reader must share a
filesystem. When the printed path is not visible to the image reader, remove
it through the kernel and continue from text and graph evidence.

## Write a current cell image

Start one capture:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    request_id = mounted.start_cell_image(
        "BYtC",
        expected_revision=8,
    )
    print(request_id)
```

Read the request in a later kernel call:

```bash
bash "$PAIR_EXECUTE" --url "$NOTEBOOK_URL" <<'PY'
from tempfile import NamedTemporaryFile

import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    result = mounted.read_cell_image("request-id")
    if result.status == "pending":
        print("pending")
    elif result.status == "failed":
        detail = result.error or "Cell image capture failed."
        raise RuntimeError(
            f"{result.error_code}: {detail}" if result.error_code else detail
        )
    elif result.image is None:
        raise RuntimeError("Lens returned no image.")
    else:
        with NamedTemporaryFile(
            prefix="marimo-lens-",
            suffix=".png",
            delete=False,
        ) as image_file:
            image_file.write(result.image.data)
            print(image_file.name)
PY
```

Retry with the same request ID while the status is `pending`. An available
result includes the image dimensions, digest, cell ID, and selection IDs drawn
on the image. A failed result includes its error code and message. A stalled
capture becomes `failed` with `capture_timeout` after 20 seconds.

A selection image preserves capture-time pixels. When it reports
`outdated: true`, inspect a current cell image before changing or verifying
the current output.

## Show activity for active work

Start activity after grounding and before the first mutation or extended
verification:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    mounted.activity(
        "BYtC",
        label="Applying bar colors",
        message="Applying the requested color to the selected chart",
    )
```

Submit the activity call and the executor's code-mode mutation as one shell
command joined by `&&`. A failed activity call stops the mutation. Keep the
label stable through the request. Skip activity for a read-only overview and
use the walkthrough reveals.

Apply related cell edits and runs in one code-mode block. Read each current
cell body before replacing it, submit the full new body, and queue affected
cells to run.

## Verify, reveal, and resolve

Use a fresh kernel call after mutation. Check the target and every cell needed
to support the final claim. Each claimed cell must be idle with no relevant
errors. Run a stale downstream cell when the notebook uses lazy execution.

For visual work, capture and open a fresh current cell image after runtime
verification.

Reveal the primary result and print its hold:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    hold_ms = 8_000
    mounted.reveal(
        "BYtC",
        duration_ms=hold_ms,
        label="Updated aggregation",
        message="Updated the aggregation and verified the output",
    )
    print(hold_ms)
```

Wait for `hold_ms`, then resolve through a fresh kernel call. Use the revision
captured before the work so a changed request remains open:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    addressed_ids = ["243110...", "8b20f4..."]
    mounted.resolve(
        addressed_ids,
        expected_revision=8,
        summary="Updated the aggregation and verified the chart.",
    )
```

One resolve call commits selections that share one verified result. Use
separate calls when the changes or rationales differ. Reveal ends activity and
scrolls once to the primary result. Resolve runs after the reveal hold, so its
receipt is the final result presentation. The browser also queues a receipt
received during an active reveal. On `revision_conflict`, leave the selections
open, scan again, and reassess the changed request.

For a multi-cell walkthrough, reveal earlier cells through separate kernel
calls. After the final reveal's hold, resolve the selections addressed by the
verified walkthrough. Finish after the final reveal when no selection was
addressed.

Keep selections open when runtime or visual verification fails. If user input
is required, update activity with a `Needs input` label and a concrete message.

## Handle operation results

- Import failure: report that the active notebook environment lacks the Lens
  adapter.
- Empty initial discovery: Lens is unavailable in the active notebook.
- Several mounted handles: ask the user to leave one Lens mounted.
- Empty identity-filtered discovery: scan because the mounted Lens changed.
- `revision_conflict`: scan and confirm the current workset.
- `selection_not_found`: scan and confirm the current selection.
- Missing selection image: continue from text and graph evidence.
- Pending cell image: read the same request again.
- Failed cell image: use its error code, then continue from nonvisual evidence
  or retry once after the output settles.

Remove every temporary image file after its final read:

```bash
unlink '/private/tmp/marimo-lens-ab12cd34.png'
unlink '/private/tmp/marimo-lens-ef56gh78.png'
```
