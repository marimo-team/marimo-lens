---
title: Python API reference
description: Python API contracts for reading Lens requests and returning agent work for review.
---

# Python API reference

The Python API lets code-mode agents read the current selection, show their work
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

`marimo_lens.agent` is the handoff interface for code-mode agents.
The package registers this module as the `lens` capability in the
`marimo.agent.capability` entry-point group.

Notebook cells mount Lens through the [public `Lens` API](#lens). Agent
integrations call the adapter inside their live `marimo._code_mode` context:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

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

An invalid context or non-string identity raises `TypeError`. An empty identity
raises `ValueError`.

### `MountedLens`

The handle's `identity` property is an opaque, read-only string. Pass it to
`connect()` to reconnect to the same mounted Lens in another kernel call. The
identity and Lens target remain fixed for the handle's lifetime.

| Member                                                                   | Behavior                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `identity`                                                               | Reconnects to this mounted Lens across kernel calls           |
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

### `mounted.cell_image(cell_id, *, expected_revision) -> bytes | None`

Returns a fresh, unannotated PNG of `cell_id`. The first call starts browser
capture and returns `None`. End that kernel execution so marimo can deliver the
browser response, then repeat the call with the same cell and revision. The
completed call returns and consumes the PNG bytes.

```python
png = mounted.cell_image("BYtC", expected_revision=revision)
```

A call for another cell during capture raises `LensError(code="capture_busy")`.
Poll the first cell until it returns bytes or a terminal error, then request the
next cell. Other failures use `revision_conflict`, `runtime_unavailable`,
`cell_not_found`, `browser_unavailable`, `capture_timeout`,
`output_unavailable`, `capture_failed`, or `lens_closed`.

Write returned PNG bytes to a private temporary path when the agent image reader
requires one. The kernel and image reader must share a filesystem. Remove the
path after the final read.

The [Agent workflow](./agents) covers the complete handoff. The
[Overview demo](./overview#try-the-collaboration-loop) lets you call each
handoff method on a selectable chart.

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
