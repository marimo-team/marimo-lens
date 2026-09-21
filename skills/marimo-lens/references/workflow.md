# marimo Lens code-mode recipes

The [core skill](../SKILL.md) routes requests and covers walkthroughs.
[Selection work](selections.md) owns evidence, verification, presentation, and
resolution policy. Use these recipes in the live marimo kernel.

Notebook discovery, connection, scratchpad execution, and general notebook
mutation belong to the active code-mode integration, such as marimo Pair. This
reference covers the Lens calls that cross kernel executions.

Each kernel call has a fresh scratchpad namespace. Reimport the modules and
select the saved Lens identity in each call, as the examples do. Substitute
your captured identity, cell IDs, and revision for the example values.

Use the [core skill](../SKILL.md) for ordinary mounting and Trails. Read this
reference when a task needs image transfer, completion across calls, or recovery.

## Capture a current cell image

When the image reader uses filesystem paths, substitute the saved identity,
cell ID, and revision in this complete kernel call:

```python
from tempfile import NamedTemporaryFile

import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity="F3n...")
cell_png = mounted.cell_image("BYtC", expected_revision=8)
if cell_png is None:
    print("capture_pending")
else:
    with NamedTemporaryFile(
        prefix="marimo-lens-", suffix=".png", delete=False
    ) as image_file:
        image_file.write(cell_png)
        print(image_file.name)
```

When the call prints `capture_pending`, end that execution so the browser can
respond. Repeat the call in a fresh execution with the same identity, cell ID,
and revision. When it prints a path, open the image and delete the file after
inspection. The kernel and image reader must share a filesystem. For an image
reader that accepts bytes directly, deliver `cell_png` in that same call.
Scratchpad bindings from the previous call will have been discarded.

Continue until the call returns PNG bytes or raises a terminal `LensError`. A
pending capture owns Lens's single full-cell capture slot, so finish it before
requesting another cell.

## Write image bytes for inspection

Append this block to the kernel call that retrieves the image when the image
reader requires a path. Set `image_bytes` to the returned `cell_png` or the
chosen selection's bytes from `snapshot.images` before this block:

```python
from tempfile import NamedTemporaryFile

if image_bytes is not None:
    with NamedTemporaryFile(
        prefix="marimo-lens-", suffix=".png", delete=False
    ) as image_file:
        image_file.write(image_bytes)
        print(image_file.name)
```

Open the printed path, then delete it after the image reader returns. The
kernel and image reader must share a filesystem.

## Inspect browser feedback

Lens controls and messages live in a shadow root. Use the browser tool's
accessibility snapshot or shadow-aware locators to find them, and screenshots
to verify their visible presentation. Plain body text can omit that content.

## Present and resolve across calls

After fresh verification succeeds, substitute the saved Lens identity and
verified selection ID into one completion call. Reveal replaces activity:

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
    [selection["id"]],
    expected_revision=snapshot.revision,
    summary="Counted distinct artists per region and checked chart totals against the source.",
)
print({"hold_ms": hold_ms, "revision": revision})
```

The summary appears beside the original request in History. Batch selections
on the same verified surface when they share an outcome. Reveal each distinct
surface before resolving its selections. For different outcomes, resolve with
separate summaries and pass the returned revision into the next call.

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

| Error code            | Next action                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `lens_unavailable`    | Retry a saved identity once without it. Wait only for a pending mount, otherwise use the core mounting workflow. |
| `lens_ambiguous`      | Inspect `discover()` handles and reconnect with the intended identity.                                           |
| `revision_conflict`   | Stop saved activity, reconnect, and reassess fresh Lens context.                                                 |
| `selection_not_found` | Reconnect and inspect the current selections.                                                                    |
| `capture_busy`        | Finish the pending cell capture before requesting another.                                                       |
| `runtime_unavailable` | Keep the request open and report that verification is unavailable.                                               |

Keep selections open when recovery cannot restore current evidence and fresh
verification.
