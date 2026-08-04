---
title: Python API reference
description: Python API contracts for reading Lens requests and returning agent work for review.
---

# Python API reference

The Python API lets notebook agents read the current selection, show their work
in the notebook, reveal a result, and complete a request.

The package exports `Lens`, `LensContext`, `LensError`, `LensReferences`,
`NotebookReference`, `SelectionReference`, and `__version__`. The version string
comes from the installed `marimo-lens` distribution metadata.

```marimo-config
requires-python = ">=3.11"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

## Agent handoff adapter

`marimo_lens.agent` is the handoff interface for notebook agents such as
[marimo Pair](https://github.com/marimo-team/marimo-pair). Pair connects to a
running notebook and executes adapter calls inside its live kernel through
marimo code mode.

Notebook users select an output and ask their agent to act. The agent owns the
code-mode connection, connects to the mounted Lens, reads the request, reports
activity on the work cell, changes and runs cells, verifies the result, stops
activity, reveals the result for its full hold, then resolves the addressed
selections.
`marimo._code_mode` stays inside the agent integration. Notebook cells mount Lens through the
[public `Lens` API](#lens).

A compatible agent performs the handoff inside its live-kernel execution path:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx)
    snapshot = mounted.context()
```

### `connect(context, *, identity=None) -> MountedLens`

Returns the mounted Lens found in a live `marimo._code_mode.get_context()`
context. Pass an earlier handle's `identity` to reconnect to that exact Lens in
a later kernel call.

`connect()` raises `LensError(code="lens_unavailable")` when the requested Lens
cannot be found. It raises `LensError(code="lens_ambiguous")` when several Lens
widgets are mounted and no identity selects one.

### `MountedLens`

The handle exposes context reads, cell feedback, and revision-checked actions:

| Method                                                                   | Behavior                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `context()`                                                              | Returns the current detached `LensContext`                   |
| `cell_image(cell_id, *, expected_revision)`                              | Returns fresh cell PNG bytes after browser capture completes |
| `start_activity(cell_id, *, duration_ms=None, label=None, message=None)` | Shows the current agent work target                          |
| `stop_activity(cell_id)`                                                 | Stops activity attached to that exact cell                   |
| `reveal(cell_id, *, duration_ms, label=None, message=None)`              | Brings the primary result into view                          |
| `resolve(selection_ids, *, expected_revision, summary=None)`             | Moves verified selections to History                         |

`context.images` maps selection IDs to annotated capture-time PNG bytes. The
matching selection reports `selection["snapshot"]["status"] == "outdated"`
when its marker changed after those bytes were captured. `cell_image()`
captures the current rendered output without Lens markers.

The first `cell_image()` call starts a fresh browser capture and returns `None`.
End that kernel execution so marimo can dispatch the browser response, then
repeat the same call in a fresh execution. Pending calls share one in-flight
capture. Complete that capture before requesting another cell. A completed call
returns the bytes, while a failed or stalled capture raises `LensError`.

Write PNG bytes to a private temporary path in the active kernel before opening
them with an agent image reader. The kernel and image reader must share a
filesystem. Remove the path after its final read.

### `mounted.cell_image(cell_id, *, expected_revision) -> bytes | None`

Returns a fresh, unannotated PNG of `cell_id`. The first call starts browser
capture and returns `None`. Repeat the call with the same cell and revision in
later kernel executions. The completed call returns and consumes the PNG bytes.

```python
png = mounted.cell_image("BYtC", expected_revision=revision)
```

A call for another cell during capture raises `LensError(code="capture_busy")`.
Poll the first cell until it returns bytes or a terminal error, then request the
next cell. Other failures use `revision_conflict`, `runtime_unavailable`,
`cell_not_found`, `browser_unavailable`, `capture_timeout`,
`output_unavailable`, `capture_failed`, or `lens_closed`.

## Try the methods

Create one or more selections on the chart, then run the methods in order. Each
control calls the same Lens API that a notebook agent uses.

<div class="lens-doc-demo">

<div class="lens-doc-demo-steps" aria-label="Try the Lens API in four steps">
  <span><strong>1</strong> Press <strong>Select</strong></span>
  <span><strong>2</strong> Mark the chart</span>
  <span><strong>3</strong> Read and start activity</span>
  <span><strong>4</strong> Complete the request</span>
</div>

```python marimo output=false
import asyncio
from html import escape

import marimo as mo
from marimo_lens import Lens

get_api_demo_revision, set_api_demo_revision = mo.state(0)
get_api_demo_result, set_api_demo_result = mo.state(None)

api_context_button = mo.ui.run_button(
    label=(
        "<span style='display:block;padding:0.3rem 0.75rem;"
        "line-height:1.25rem'>context()</span>"
    ),
)
api_activity_button = mo.ui.run_button(
    label=(
        "<span style='display:block;padding:0.3rem 0.75rem;"
        "line-height:1.25rem'>start_activity()</span>"
    ),
)
api_complete_button = mo.ui.run_button(
    label=(
        "<span style='display:block;padding:0.3rem 0.75rem;"
        "line-height:1.25rem'>Reveal, then resolve</span>"
    ),
)
```

<div class="lens-doc-demo-mount">

```python marimo
api_demo_lens = Lens()


def _sync_api_demo_revision(change):
    set_api_demo_revision(int(change["new"]["revision"]))


api_demo_lens.observe(_sync_api_demo_revision, names="_state")
api_demo_lens
```

</div>

<div class="lens-doc-demo-output lens-api-demo-chart">

```python marimo
_api_demo_values = [
    ("Q1", 36),
    ("Q2", 52),
    ("Q3", 71),
    ("Q4", 63),
]
_api_demo_rows = "".join(
    f"""
    <div
      role="listitem"
      aria-label="{_quarter}, {_value} thousand orders"
      style="display:grid;grid-template-columns:2.25rem minmax(4rem,1fr) 2.5rem;align-items:center;gap:0.75rem"
    >
      <span style="font-size:0.875rem;font-weight:500">{_quarter}</span>
      <span
        aria-hidden="true"
        style="display:block;height:1.125rem;overflow:hidden;border-radius:2px;background:color-mix(in srgb,currentColor 8%,transparent)"
      >
        <span
          data-api-demo-bar
          style="display:block;width:{_value / 80 * 100:.1f}%;height:100%;background:light-dark(#1d7363,#cad996)"
        ></span>
      </span>
      <span style="font-family:'Fira Mono',monospace;font-size:0.75rem;text-align:right">{_value}</span>
    </div>
    """
    for _quarter, _value in _api_demo_values
)
mo.Html(
    f"""
    <figure
      aria-labelledby="lens-api-demo-chart-title"
      style="margin:0;border:1px solid var(--marimo-island-border,#e2e8f0);border-radius:8px;background:var(--marimo-island-surface,#fff);color:var(--marimo-island-foreground,#0f172a);font-family:'PT Sans',sans-serif"
    >
      <figcaption style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.125rem 1.125rem 0.875rem">
        <span>
          <strong id="lens-api-demo-chart-title" style="display:block;font-size:1rem">Quarterly orders</strong>
          <span style="display:block;margin-top:0.125rem;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">Thousands</span>
        </span>
        <span style="color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">2026</span>
      </figcaption>
      <div role="list" style="display:grid;gap:0.75rem;padding:0 1.125rem 1.125rem">
        {_api_demo_rows}
      </div>
    </figure>
    """
)
```

</div>

```python marimo
mo.md(
    f"""
    <div
      class="lens-api-demo-actions"
      role="group"
      aria-label="Lens API controls"
    >
      <span class="lens-api-demo-button">{api_context_button}</span>
      <span class="lens-api-demo-button">{api_activity_button}</span>
      <span class="lens-api-demo-button">{api_complete_button}</span>
    </div>
    """
)
```

```python marimo output=false
if api_context_button.value:
    _context_result = api_demo_lens.context()
    _context_current = _context_result.current
    if _context_current is None:
        set_api_demo_result(
            {
                "kind": "missing",
                "revision": _context_result.revision,
            }
        )
    else:
        _context_snapshot = _context_current.get("snapshot", {})
        set_api_demo_result(
            {
                "kind": "context",
                "revision": _context_result.revision,
                "label": str(_context_current.get("label", "Selection")),
                "note": str(_context_current.get("note", "")).strip(),
                "cellId": str(_context_current["outputCellId"]),
                "imageStatus": str(_context_snapshot.get("status", "pending")),
                "textLength": len(_context_result.text),
            }
        )
```

```python marimo output=false
if api_activity_button.value:
    _activity_context = api_demo_lens.context()
    _activity_current = _activity_context.current
    if _activity_current is None:
        set_api_demo_result(
            {
                "kind": "missing",
                "revision": _activity_context.revision,
            }
        )
    elif _activity_current["cellStatus"] == "available":
        _activity_cell_id = str(_activity_current["outputCellId"])
        api_demo_lens.start_activity(
            _activity_cell_id,
            label="Reviewing selected chart",
            message="Checking the selected result before updating it",
        )
        set_api_demo_result(
            {
                "kind": "activity",
                "revision": _activity_context.revision,
                "cellId": _activity_cell_id,
            }
        )
```

```python marimo output=false
if api_complete_button.value:
    _complete_context = api_demo_lens.context()
    _complete_current = _complete_context.current
    if _complete_current is None:
        set_api_demo_result(
            {
                "kind": "missing",
                "revision": _complete_context.revision,
            }
        )
    elif _complete_current["cellStatus"] == "available":
        _complete_cell_id = str(_complete_current["outputCellId"])
        _complete_ids = [
            str(_selection["id"])
            for _selection in _complete_context.references.get(
                "selections",
                [],
            )
            if str(_selection["outputCellId"]) == _complete_cell_id
        ]
        if _complete_ids:
            _complete_count = len(_complete_ids)
            _complete_summary = (
                "Completed the API walkthrough and returned the result for review."
                if _complete_count == 1
                else (
                    f"Completed {_complete_count} requests in the API "
                    "walkthrough and returned the result for review."
                )
            )
            api_demo_lens.stop_activity(_complete_cell_id)
            _complete_hold_ms = 10_000
            api_demo_lens.reveal(
                _complete_cell_id,
                duration_ms=_complete_hold_ms,
                label="API walkthrough",
                message=_complete_summary,
            )
            await asyncio.sleep(_complete_hold_ms / 1_000)
            _complete_revision = api_demo_lens.resolve(
                _complete_ids,
                expected_revision=_complete_context.revision,
                summary=_complete_summary,
            )
            set_api_demo_result(
                {
                    "kind": "complete",
                    "revision": _complete_revision,
                    "count": _complete_count,
                }
            )
```

<div class="lens-doc-demo-status">

```python marimo
_api_demo_revision = get_api_demo_revision()
_api_demo_context = api_demo_lens.context()
_api_demo_result = get_api_demo_result()
if (
    _api_demo_result is not None
    and int(_api_demo_result["revision"]) != _api_demo_context.revision
):
    _api_demo_result = None

_api_demo_current = _api_demo_context.current
_api_demo_open_count = len(_api_demo_context.references.get("selections", []))
_api_demo_kind = (
    str(_api_demo_result["kind"])
    if _api_demo_result is not None
    else ("ready" if _api_demo_current is not None else "empty")
)

if _api_demo_kind == "empty":
    _api_demo_title = "Select part of the chart"
    _api_demo_body = (
        "Press <strong>Select</strong> in the Lens dock, "
        "then click a bar or drag a region."
    )
elif _api_demo_kind == "missing":
    _api_demo_title = "Create a selection first"
    _api_demo_body = "Mark part of the chart before calling a method on the request."
elif _api_demo_kind == "ready":
    _api_demo_label = escape(str(_api_demo_current.get("label", "Selection")))
    _api_demo_noun = "request" if _api_demo_open_count == 1 else "requests"
    _api_demo_title = f"{_api_demo_label} is ready"
    _api_demo_body = (
        f"Lens has {_api_demo_open_count} open {_api_demo_noun}. "
        "Call context() to inspect what the agent can read."
    )
elif _api_demo_kind == "context":
    _api_demo_label = escape(str(_api_demo_result["label"]))
    _api_demo_note = escape(str(_api_demo_result["note"])) or "No note added"
    _api_demo_cell = escape(str(_api_demo_result["cellId"]))
    _api_demo_image_status = escape(
        str(_api_demo_result["imageStatus"]).replace("_", " ").title()
    )
    _api_demo_title = f"context() read {_api_demo_label}"
    _api_demo_body = f"""
      <dl class="lens-doc-demo-context">
        <div><dt>Requested change</dt><dd>{_api_demo_note}</dd></div>
        <div><dt>Producing cell</dt><dd><code>{_api_demo_cell}</code></dd></div>
        <div><dt>Related notebook context</dt><dd>{int(_api_demo_result["textLength"]):,} characters</dd></div>
        <div><dt>Annotated image</dt><dd>{_api_demo_image_status}</dd></div>
      </dl>
    """
elif _api_demo_kind == "activity":
    _api_demo_cell = escape(str(_api_demo_result["cellId"]))
    _api_demo_title = "start_activity() marked the cell"
    _api_demo_body = f"Cell <code>{_api_demo_cell}</code> now shows the active review."
else:
    _api_demo_count = int(_api_demo_result["count"])
    _api_demo_noun = "request" if _api_demo_count == 1 else "requests"
    _api_demo_title = "Ready for review"
    _api_demo_body = (
        f"resolve() moved {_api_demo_count} {_api_demo_noun} to history. "
        "reveal() returned the chart to view. Reopen a history item "
        "to continue the loop."
    )

mo.Html(
    f"""
    <aside
      data-api-demo-state="{escape(_api_demo_kind)}"
      data-api-demo-open-count="{_api_demo_open_count}"
      aria-live="polite"
    >
      <span class="lens-doc-demo-eyebrow">Live API state</span>
      <strong>{_api_demo_title}</strong>
      <div>{_api_demo_body}</div>
    </aside>
    """
)
```

</div>

</div>

These controls call the feedback methods. An agent integration edits, runs, and
verifies notebook code between `context()` and `resolve()`. See
the [Overview](./overview) for the complete workflow.

## `Lens`

Mount one `Lens` through marimo:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep the mounted value available while calling its methods from other cells.

### `lens.context() -> LensContext`

Captures the current selection revision and one bounded snapshot of the marimo
runtime, then returns a detached `LensContext`.

```python
context = lens.context()
selection = context.current

if selection is not None:
    cell_id = str(selection["outputCellId"])
```

A `LensContext` does not update. Call `lens.context()` again after the notebook
or its selections change.

Compact references and annotated images are ready when `context()` returns.
Standalone text renders and caches when `context.text` is first read from the
captured runtime snapshot.

`context()` raises `LensError(code="lens_closed")` after Lens closes. Contexts
created before closing remain readable.

### `lens.start_activity(cell_id, *, duration_ms=None, label=None, message=None) -> None`

Validates that `cell_id` belongs to the current marimo graph, then sends a
best-effort browser event. When the displayed Lens receives it, the cell is
marked until its optional hold ends, `stop_activity()` targets that cell, or
another activity, reveal, or Lens teardown replaces it.

```python
context = lens.context()
selection = context.current

if selection is not None and selection["cellStatus"] == "available":
    lens.start_activity(
        str(selection["outputCellId"]),
        label="Updating aggregation",
        message="Updating the aggregation",
    )
```

Activity preserves selection state. It keeps the current scroll position when
the work cell has room for the label above it. It frames offscreen and near-top
work cells so the label stays outside the cell. Later target growth triggers a
corrective reframe when it clips the cell.
Another `start_activity()` call updates the label and message or marks a
different cell. Starting timed activity again on the same cell restarts its
hold.

`duration_ms` defaults to `None`, which keeps activity visible until an explicit
stop or replacement. Pass a positive integer up to 300,000 to clear it after
that hold. `stop_activity()` can dismiss timed activity before its hold ends.
`label` defaults to **Working** and accepts at most 40 UTF-16 code units.

Call `stop_activity()` after verification and before `reveal()` or `resolve()`.

Expected `LensError.code` values are `runtime_unavailable`, `cell_not_found`,
and `lens_closed`.

### `lens.stop_activity(cell_id) -> None`

Sends a best-effort browser event that clears persistent or timed activity when
`cell_id` matches the active work cell. Activity on another cell remains
visible.

```python
lens.stop_activity("cell-view")
```

Call `stop_activity()` after the cell edit or creation has run and fresh
verification succeeds. The method accepts the original cell ID after that cell
has been replaced or removed from the current graph.

### `lens.reveal(cell_id, *, duration_ms, label=None, message=None) -> None`

Validates `cell_id`, then sends a best-effort browser event. When the displayed
Lens receives it, the notebook scrolls once to the rendered cell and highlights
it for `duration_ms`.

```python
context = lens.context()
selection = context.current

if selection is not None and selection["cellStatus"] == "available":
    lens.reveal(
        str(selection["outputCellId"]),
        duration_ms=10_000,
        label="Updated chart",
        message="Updated the aggregation and verified the chart.",
    )
```

`duration_ms` accepts a positive integer up to 300,000 milliseconds. Choose a
hold that lets the user orient to the highlighted cell and read the message
comfortably. Longer or denser messages need more time. `label` accepts up to 40
UTF-16 code units and appears as the reveal heading.

Reveal messages accept up to 1,000 UTF-16 code units and wrap below the status
and cell ID. Reveal preserves keyboard focus and selection state. A second
reveal replaces the current highlight. Wait for `duration_ms` before revealing
another cell or resolving the selections addressed by the result.

Expected `LensError.code` values are `runtime_unavailable`, `cell_not_found`,
and `lens_closed`.

### `lens.resolve(selection_ids, *, expected_revision, summary=None) -> int`

Moves one or more selections into addressed History against the revision
captured by `context()`, releases their annotated PNGs, and returns the resulting
revision.

```python
context = lens.context()
selection_ids = [
    str(selection["id"])
    for selection in context.references["selections"]
    if selection["outputCellId"] == "BYtC"
]

if selection_ids:
    revision = lens.resolve(
        selection_ids,
        expected_revision=context.revision,
        summary="Updated the aggregation and verified the chart.",
    )
```

Pass one selection ID as a string or several unique IDs as a sequence. Lens
validates every ID before changing state. The batch receives one resulting
revision and one shared summary. A missing ID leaves the full batch open.

The expected revision prevents an integration from completing a selection
after the user has changed the selection state. Call `lens.context()` again
after `LensError(code="revision_conflict")`.

The state change commits before Lens sends the best-effort **Addressed**
presentation event. A browser delivery failure does not roll back the completed
selection. When a cell reveal is active, the browser holds the receipt until
the reveal exits so the two presentations remain sequential.

Expected `LensError.code` values are `lens_closed`, `revision_conflict`, and
`selection_not_found`.

### `lens.close() -> None`

Closes Lens, cancels pending full-cell capture, and releases Lens-owned
annotated images. Calling `close()` more than once has no effect.

Later calls to `context()`, `start_activity()`, `stop_activity()`, `reveal()`, and
`resolve()` raise `LensError(code="lens_closed")`.

## `LensContext`

`LensContext` is a detached snapshot with five main properties:

| Property     | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| `revision`   | Selection revision for a guarded `resolve()` call                 |
| `current`    | Current compact selection reference, or `None`                    |
| `references` | JSON-safe selection references for a live notebook integration    |
| `text`       | Bounded text for selected cells and their relevant upstream cells |
| `images`     | Read-only mapping from selection IDs to captured PNG bytes        |

Each compact selection reference includes its stable ID and label, note, exact
`outputCellId`, point or region, annotated image status, and runtime
`cellStatus`.

`cellStatus` is:

- `available` when the current graph contains the exact output cell ID
- `missing` when the runtime is available and the cell ID is absent
- `unavailable` when Lens cannot inspect the current marimo runtime

## Typed context references

`LensContext.references` returns a `LensReferences` dictionary.
`LensContext.current` returns its current `SelectionReference`, or `None` when
no selection is current. These `TypedDict` contracts are exported from
`marimo_lens` for type checking and editor completion.

`LensReferences` contains:

| Key                  | Value                               |
| -------------------- | ----------------------------------- |
| `revision`           | Captured selection revision         |
| `generatedAt`        | Context generation timestamp        |
| `notebook`           | `NotebookReference` metadata        |
| `currentSelectionId` | Current selection ID, or `None`     |
| `selections`         | List of `SelectionReference` values |

`SelectionReference` contains `id`, `label`, `note`, `outputCellId`,
`cellStatus`, `anchor`, and `snapshot`. `domHint` and `previousResolution`
appear when that evidence is available for the selection.

`NotebookReference` contains `path` and `available`. It includes `reason` when
the active marimo runtime is unavailable.

Standalone text includes selected cell source, relevant upstream cell source,
definitions, references, direct parent IDs, notes, and safely displayable native
marimo control values. Passwords, file payloads, custom controls, AnyWidgets,
and opaque state render as `[redacted]` or `[unavailable]`.

## Selection PNG bytes

`context.images` contains successful capture-time PNGs indexed by selection ID.
The corresponding selection reference reports
`selection["snapshot"]["status"] == "outdated"` when the marker changed after
capture.

Render one captured image as a marimo output:

```python
import marimo as mo

context = lens.context()
png = context.images.get("selection-1")
mo.image(png, width=640, alt="Selected chart region") if png is not None else None
```

## `LensError`

Expected Lens operation failures raise `LensError`.

- `code` is the stable machine-readable failure code.
- `revision` is the current Lens selection revision, or `None` when connection
  failed before a Lens instance was available.

Invalid argument types and values raise `TypeError` or `ValueError` before a
Lens operation begins.

## Limits

| Resource                             | Limit                                      |
| ------------------------------------ | ------------------------------------------ |
| Open selections                      | 64                                         |
| Selection note                       | 4,000 UTF-16 code units                    |
| Cell ID or selection ID              | 128 UTF-16 code units                      |
| Activity or reveal label             | 40 UTF-16 code units                       |
| Activity message or resolve summary  | 240 UTF-16 code units                      |
| Reveal message                       | 1,000 UTF-16 code units                    |
| Reveal duration                      | 1 to 300,000 milliseconds                  |
| Selections per resolution            | 64 unique IDs                              |
| Active synchronized state            | 40,000 UTF-8 bytes                         |
| Addressed History                    | 64 items and 64,000 UTF-8 bytes            |
| Compact references                   | 45,000 UTF-8 bytes                         |
| Standalone text                      | 64,000 characters                          |
| Relevant runtime cells               | 64                                         |
| Reported omitted cell IDs            | 16 plus the exact omitted count            |
| Controls included in standalone text | 16                                         |
| One annotated PNG                    | 8 MiB, 2,048 pixels per edge, 4 megapixels |
| Stored annotated PNG bytes per Lens  | 64 MiB                                     |

A mutation that cannot fit the synchronized selection state or required
reference fields raises `LensError(code="selection_context_limit")` before the
state changes.
