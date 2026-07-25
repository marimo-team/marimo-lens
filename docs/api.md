# Python API

The Python API lets notebook agents read the current selection, show their work
in the notebook, reveal a result, and complete a request.

The package exports `Lens`, `LensContext`, `SelectionImage`, and `LensError`.

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

Compact references and marked images are ready when `context()` returns.
Standalone text renders and caches when `context.text` is first read from the
captured runtime snapshot.

`context()` raises `LensError(code="lens_closed")` after Lens closes. Contexts
created before closing remain readable.

### `lens.activity(cell_id, *, label=None, message=None) -> None`

Validates that `cell_id` belongs to the current marimo graph, then sends a
best-effort browser event. When the displayed Lens receives it, the cell is
marked until another activity call, a reveal, or Lens teardown.

```python
context = lens.context()
selection = context.current

if selection is not None and selection["cellStatus"] == "available":
    lens.activity(
        str(selection["outputCellId"]),
        label="On it",
        message="Updating the aggregation",
    )
```

Activity never scrolls and preserves selection state. Another activity call
updates the label and message or marks a different cell. `label` defaults to
**Working** and accepts at most 40 UTF-16 code units.

Expected `LensError.code` values are `runtime_unavailable`, `cell_not_found`,
and `lens_closed`.

### `lens.reveal(cell_id, *, message=None) -> None`

Validates `cell_id`, then sends a best-effort browser event. When the displayed
Lens receives it, the notebook scrolls once to the rendered cell and highlights
it for about two seconds.

```python
context = lens.context()
selection = context.current

if selection is not None and selection["cellStatus"] == "available":
    lens.reveal(
        str(selection["outputCellId"]),
        message="Updated the aggregation and verified the chart.",
    )
```

Reveal preserves keyboard focus and selection state. A second reveal replaces
the current highlight.

Expected `LensError.code` values are `runtime_unavailable`, `cell_not_found`,
and `lens_closed`.

### `lens.resolve(selection_ids, *, expected_revision, summary=None) -> int`

Moves one or more selections into addressed History against the revision
captured by `context()`, releases their marked PNGs, and returns the resulting
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
selection.

Expected `LensError.code` values are `lens_closed`, `revision_conflict`, and
`selection_not_found`.

### `lens.close() -> None`

Closes Lens, cancels pending full-cell capture, and releases Lens-owned marked
images. Calling `close()` more than once has no effect.

Later calls to `context()`, `activity()`, `reveal()`, and `resolve()` raise
`LensError(code="lens_closed")`.

## `LensContext`

`LensContext` is a detached snapshot with five main properties:

| Property     | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| `revision`   | Selection revision for a guarded `resolve()` call                 |
| `current`    | Current compact selection reference, or `None`                    |
| `references` | JSON-safe selection references for a live notebook integration    |
| `text`       | Bounded text for selected cells and their relevant upstream cells |
| `images`     | Tuple of successful `SelectionImage` values in selection order    |

Each compact selection reference includes its stable ID and label, note, exact
`outputCellId`, point or region, marked image status, and runtime `cellStatus`.

`cellStatus` is:

- `available` when the current graph contains the exact output cell ID
- `missing` when the runtime is available and the cell ID is absent
- `unavailable` when Lens cannot inspect the current marimo runtime

Standalone text includes selected cell source, relevant upstream cell source,
definitions, references, direct parent IDs, notes, and safely displayable native
marimo control values. Passwords, file payloads, custom controls, AnyWidgets,
and opaque state render as `[redacted]` or `[unavailable]`.

## `SelectionImage`

`context.images` contains successful marked PNG captures. Match an image to a
selection with `SelectionImage.selection_id`.

| Attribute      | Value                                          |
| -------------- | ---------------------------------------------- |
| `id`           | Stable image ID                                |
| `selection_id` | Selection that owns the image                  |
| `media_type`   | `"image/png"`                                  |
| `data`         | Immutable PNG bytes                            |
| `width`        | Pixel width                                    |
| `height`       | Pixel height                                   |
| `sha256`       | SHA-256 digest of `data`                       |
| `captured_at`  | Capture timestamp                              |
| `outdated`     | Whether the selection moved after these pixels |

Render the first captured image as a marimo output:

```python
context = lens.context()
image = next(iter(context.images), None)
image.render(width=640, alt="Selected chart region") if image is not None else None
```

`SelectionImage.render(*, alt=None, width=None, height=None)` returns a marimo
image. A `SelectionImage` also renders when it is the final value of a cell.

## `LensError`

Expected Lens operation failures raise `LensError`.

- `code` is the stable machine-readable failure code.
- `revision` is the current Lens selection revision when the error is created.

Invalid argument types and values raise `TypeError` or `ValueError` before a
Lens operation begins.

## Limits

| Resource                             | Limit                                      |
| ------------------------------------ | ------------------------------------------ |
| Open selections                      | 64                                         |
| Selection note                       | 4,000 UTF-16 code units                    |
| Cell ID or selection ID              | 128 UTF-16 code units                      |
| Activity label                       | 40 UTF-16 code units                       |
| Activity, reveal, or resolve message | 240 UTF-16 code units                      |
| Selections per resolution            | 64 unique IDs                              |
| Active synchronized state            | 40,000 UTF-8 bytes                         |
| Addressed History                    | 64 items and 64,000 UTF-8 bytes            |
| Compact references                   | 45,000 UTF-8 bytes                         |
| Standalone text                      | 64,000 characters                          |
| Relevant runtime cells               | 64                                         |
| Reported omitted cell IDs            | 16 plus the exact omitted count            |
| Controls included in standalone text | 16                                         |
| One marked PNG                       | 8 MiB, 2,048 pixels per edge, 4 megapixels |
| Stored marked PNG bytes per Lens     | 64 MiB                                     |

A mutation that cannot fit the synchronized selection state or required
reference fields raises `LensError(code="selection_context_limit")` before the
state changes.

The [package README](https://github.com/marimo-team/marimo-lens/tree/main/packages/marimo-lens)
contains the complete field and lifecycle reference used by integration
authors.
