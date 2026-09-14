# marimo Lens code-mode recipes

[`SKILL.md`](../SKILL.md) owns request routing, evidence requirements,
verification, presentation, and resolution policy. Use these recipes after the
agent can execute code in the live marimo kernel.

Notebook discovery, connection, scratchpad execution, and general notebook
mutation belong to the active code-mode integration, such as marimo Pair. This
reference covers the Lens calls that cross kernel executions.

Each kernel call has a fresh scratchpad namespace. Import
`marimo_lens.agent` in every call that uses Lens.

## Mount Lens when unavailable

Start with `connect(cm.get_context())` to reuse a named or automatically mounted
Lens. If it raises `LensError(code="lens_unavailable")`, allow pending notebook
output to render and retry in a fresh kernel call. When no Lens exists, queue
one collapsed Lens cell:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as ctx:
    cell_id = lens_agent.add_lens_cell(ctx)
    print(cell_id)
```

End that kernel call. The code-mode context creates and runs the cell when it
exits, and the browser then renders Lens. Connect in a fresh call. Host
documents use the authored mount and selector policy described by their own
integration skill.

## Reconnect to Lens

Keep the opaque identity returned by the canonical context read in `SKILL.md`.
Reconnect to that Lens in later kernel calls:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity="F3n...")
```

Retry once without the saved identity when that Lens is unavailable. Use
`lens_agent.discover(cm.get_context())` to inspect available handles if connection
is ambiguous. Select by identity using the request and each handle's current
selection as evidence. Read a fresh context before continuing with a different Lens.

## Capture a current cell image

Use the identity, cell ID, and revision captured by the canonical workflow:

```python
cell_png = mounted.cell_image(
    cell_id,
    expected_revision=revision,
)
print("ready" if cell_png is not None else "capture_pending")
```

When the call prints `capture_pending`, end that kernel execution so the
browser can respond. Reconnect and repeat the same request in a fresh call:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity="F3n...")
cell_png = mounted.cell_image("BYtC", expected_revision=8)
print("ready" if cell_png is not None else "capture_pending")
```

Continue until the call returns PNG bytes or raises a terminal `LensError`. A
pending capture owns Lens's single full-cell capture slot, so finish it before
requesting another cell.

## Write image bytes for inspection

Write available selection or cell PNG bytes to a private temporary path when
the image reader requires one:

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
kernel and image reader must share a filesystem.

## Show a Trail

Choose and verify a short route in notebook order. Replace these example IDs
with IDs from the current `ctx.cells` and `ctx.graph.cells`:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context())
mounted.show_trail(
    [
        {
            "cell_id": "BYtC",
            "label": "What we're checking",
            "message": "Let's check whether current support capacity can cover launch demand.",
        },
        {
            "cell_id": "rAqT",
            "label": "Our baseline",
            "message": "These cleaned records give us average waiting time and its upper tail.",
        },
        {
            "cell_id": "mNwP",
            "label": "A trial we can try",
            "message": "Let's use a reversible trial to see whether extra capacity helps.",
        },
    ],
)
```

The first step opens immediately. The user controls reading time with the
small previous/next stepper in the existing popover header. No separate panel,
saved route, or timing loop is needed. Accepts 1–16 steps, labels up to 40
UTF-16 units, and optional messages up to 1,000.

Changing or rerunning a referenced cell or upstream input ends the walkthrough.
Refresh, dismissal, or new attention also ends its presentation. Showing a Trail
does not change selections, History, or notebook state.

## Present and resolve across calls

After fresh verification succeeds, substitute the saved Lens identity and
verified selection IDs into one completion call. Reveal replaces activity:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity="F3n...")
snapshot = mounted.context()
selection = next(
    selection
    for selection in snapshot.references["selections"]
    if selection["id"] == "243110..."
)
hold_ms = 4_000
mounted.reveal(
    selection,
    expected_revision=snapshot.revision,
    duration_ms=hold_ms,
    label="Updated aggregation",
    message="I updated the aggregation and checked the chart totals against the source.",
)
revision = mounted.resolve(
    ["243110...", "8b20f4..."],
    expected_revision=snapshot.revision,
    summary="Counted distinct artists per region and checked chart totals against the source.",
)
print({"hold_ms": hold_ms, "revision": revision})
```

The summary appears beside each original request in History. Batch requests
that share this outcome. For different outcomes, resolve with separate
summaries and pass the revision returned by one call into the next call.

End the kernel call so the browser can present the result. History retains the
target for a reveal that arrives after resolution. The receipt waits until
the reveal ends. Use the hold for independent reads or planning before
starting the next activity or reveal. Keep revisioned mutations ordered.

Selection activity and reveal resolve the stored target in its owning browser
document. An owning-document **Target unavailable** notice can appear while a
host view rebuilds. Keep the activity handle and verify that the target
reattaches. A full browser-document replacement gives the surface a new opaque
document identity, so reconnect and read fresh Lens context before continuing.

## Operation recovery

| Error code            | Next action                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `lens_unavailable`    | Retry without identity, then mount Lens when none is available.        |
| `lens_ambiguous`      | Inspect `discover()` handles and reconnect with the intended identity. |
| `revision_conflict`   | Stop saved activity, reconnect, and reassess fresh Lens context.       |
| `selection_not_found` | Reconnect and inspect the current selections.                          |
| `capture_busy`        | Finish the pending cell capture before requesting another.             |
| `runtime_unavailable` | Keep the request open and report that verification is unavailable.     |

Keep selections open when recovery cannot restore current evidence and fresh
verification.
