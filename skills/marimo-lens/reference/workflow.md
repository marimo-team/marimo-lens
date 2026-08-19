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

After the first `connect(cm.get_context())` call without an identity raises
`LensError(code="lens_unavailable")`, queue one collapsed Lens cell:

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

Retry once without the saved identity when that Lens is unavailable. Read a
fresh context before continuing with a different Lens.

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

## Present and resolve across calls

After fresh verification succeeds, stop persistent activity and reveal the
primary result:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity="F3n...")
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

Honor the printed hold before resolving the addressed selections in a fresh
kernel call:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity="F3n...")
revision = mounted.resolve(
    ["243110...", "8b20f4..."],
    expected_revision=8,
    summary="Updated the aggregation and verified the chart.",
)
print(revision)
```

For separate resolution groups, pass the revision returned by one call into
the next call.

## Operation recovery

| Error code            | Next action                                                          |
| --------------------- | -------------------------------------------------------------------- |
| `lens_unavailable`    | Retry without identity, then mount Lens when none is available.      |
| `lens_ambiguous`      | Reconnect with an identity, or close or remove extra Lens instances. |
| `revision_conflict`   | Reconnect and read a fresh Lens context.                             |
| `selection_not_found` | Reconnect and inspect the current selections.                        |
| `capture_busy`        | Finish the pending cell capture before requesting another.           |
| `runtime_unavailable` | Keep the request open and report that verification is unavailable.   |

Keep selections open when recovery cannot restore current evidence and fresh
verification.
