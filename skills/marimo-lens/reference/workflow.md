# marimo Lens agent workflow

Use these snippets through a live marimo kernel executor. With
`marimo-pair`, resolve `PAIR_EXECUTE` to its `scripts/execute-code.sh`, resolve
`LENS_MATERIALIZE` to this skill's `scripts/materialize-image.sh`, and target
the notebook with its URL, port, or session arguments.

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
current.id
current.outputCellId
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

## Materialize a selection image

`AgentImage.transfer()` emits a marked record for direct piping. The client
script returns image metadata and a private local path:

```bash
(
bash "$PAIR_EXECUTE" --url "$NOTEBOOK_URL" <<'PY'
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
    print(image.transfer())
PY
) | bash "$LENS_MATERIALIZE"
```

Open the returned `path` with the client application's local-image reader
before making a claim about color, position, spacing, overlap, alignment,
legibility, or chart marks.

## Materialize a current cell image

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

Read the request in a later kernel call and pipe it to the materializer:

```bash
(
bash "$PAIR_EXECUTE" --url "$NOTEBOOK_URL" <<'PY'
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    result = mounted.read_cell_image("request-id")
    print(result.transfer())
PY
) | bash "$LENS_MATERIALIZE"
```

The materializer returns `status: pending` while the browser is still
capturing. Retry with the same request ID. An available result includes
`path`, `imageDir`, dimensions, digest, cell ID, and the selection IDs drawn on
the image. A failed result includes its error code and exits unsuccessfully.

A selection image preserves capture-time pixels. When it reports
`outdated: true`, inspect a current cell image before changing or verifying
the current output.

## Show activity and mutate

Start activity after grounding and before the first mutation:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    mounted.activity(
        "BYtC",
        label="Fixing those bars...",
        message="Applying the requested color to the selected chart",
    )
```

Submit the activity call and the executor's code-mode mutation as one shell
command joined by `&&`. A failed activity call stops the mutation. Keep the
label stable through the request.

Apply related cell edits and runs in one code-mode block. Read each current
cell body before replacing it, submit the full new body, and queue affected
cells to run.

## Verify, resolve, and reveal

Use a fresh kernel call after mutation. Check the target and every cell needed
to support the final claim. Each claimed cell must be idle with no relevant
errors. Run a stale downstream cell when the notebook uses lazy execution.

For visual work, capture and open a fresh current cell image after runtime
verification.

Resolve the selections and reveal the primary result:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx, identity="F3n...")[0]
    mounted.resolve(
        ["243110...", "8b20f4..."],
        expected_revision=8,
        summary="Updated the aggregation and verified the chart.",
    )
    mounted.reveal(
        "BYtC",
        message="Updated the aggregation and verified the output",
        duration_ms=8_000,
    )
```

One resolve call commits selections that share one verified result. Use
separate calls when the changes or rationales differ. Reveal ends activity and
scrolls once to the primary result.

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

Remove every returned `imageDir` after its final image read, including failure
paths after local materialization:

```bash
bash "$LENS_MATERIALIZE" cleanup \
  '/tmp/marimo-lens.A1b2c3' \
  '/tmp/marimo-lens.D4e5f6'
```
