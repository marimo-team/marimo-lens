<p align="center">
  <a href="https://marimo-team.github.io/marimo-lens/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://marimo-team.github.io/marimo-lens/brand/marimo-lens-lockup-horizontal-dark.svg">
      <img alt="marimo-lens" src="https://marimo-team.github.io/marimo-lens/brand/marimo-lens-lockup-horizontal-light.svg" width="620">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://pypi.org/project/marimo-lens/"><img alt="PyPI" src="https://img.shields.io/pypi/v/marimo-lens.svg"></a>
  <a href="https://spdx.org/licenses/Apache-2.0.html"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
</p>

**Let Pair see what you see.**

Point at a notebook result and ask [marimo Pair](https://marimo.io/pair) about
“this” without copying cell IDs, code, or screenshots. Pair starts with the
selected cell and related notebook structure, then loads an image of your
selection when needed.

[Read the user guide](https://marimo-team.github.io/marimo-lens/) for the
notebook and Pair workflow.

## Install

`marimo-lens` supports Python 3.11 through 3.14.

```sh
uv pip install marimo-lens
```

## Add Lens to a notebook

Create or open a marimo notebook. Add this cell to render a small revenue
summary:

```python
import marimo as mo
from marimo_lens import Lens

revenue = {"January": 42, "February": 58, "March": 39}
mo.md("\n".join(f"- {month}: **{value}**" for month, value in revenue.items()))
```

Mount one Lens in another cell:

```python
lens = mo.ui.anywidget(Lens())
lens
```

Keep the Lens cell mounted while calling its methods from other cells. Lens
needs a live marimo kernel to create selections and read notebook context.

Press **Select**, then click a point or drag a region inside any rendered
output. Pointer release creates the selection and makes it current. Add a note
when the request needs more detail.

## Work with Pair

Connect Pair to the same running notebook. Pair starts from the current
selection, reads the selected cell and related notebook context as needed, and
can request visual evidence when pixels affect the task.

Pair follows the user’s request. A selection identifies the output, while its
note adds context. Pair can mark its primary working cell, reveal one result
after verification, and mark the completed selection **Addressed**.

Addressed selections move to the **History** tab with Pair's completion
summary. Select **Reopen** to restore the original cell, note, and point or
region as the current selection. Lens starts a fresh marked PNG capture from
the current output. The prior completion summary remains available to Pair for
the next pass.

Agent integrations use the Python API to implement the same workflow.

## API reference

The package exports `Lens`, `LensContext`, `LensError`, and `SelectionImage`.

### `lens.context() -> LensContext`

Captures the current selection revision and one bounded marimo runtime snapshot,
then returns a detached `LensContext`.

A `LensContext` does not update after creation. Call `lens.context()` again
after the notebook or its selections change. Compact references are built
immediately. Standalone text is rendered and cached on first access from the
same captured runtime snapshot.

`context()` raises `LensError(code="lens_closed")` after Lens closes. Contexts
created before closing remain readable.

### `LensContext`

| Property     | Value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `revision`   | Selection revision used for guarded `resolve()` calls                 |
| `current`    | Current compact selection reference, or `None`                        |
| `references` | JSON-safe selection references for a live notebook integration        |
| `text`       | Bounded text for the selected cells and their relevant upstream cells |
| `images`     | Tuple of successful marked `SelectionImage` values in selection order |

#### Compact references

`references` contains `revision`, `generatedAt`, `notebook`,
`currentSelectionId`, and `selections`.

Each selection contains its stable ID and `S<n>` label, note, exact
`outputCellId`, normalized anchor, bounded DOM hint when available, snapshot
status, and runtime `cellStatus`.

When the current selection was reopened from History, it also contains
`previousResolution` with the addressed timestamp and optional summary.
Noncurrent selection references omit this receipt. Addressed History items do
not appear in `context.references`.

`cellStatus` is:

- `available` when the current graph contains the exact output cell ID
- `missing` when the runtime is available but the cell ID is absent
- `unavailable` when Lens cannot inspect the current marimo runtime

A selection whose output cell is missing remains readable and resolvable. Lens
reconnects it to notebook lineage and browser targeting when the same cell ID
returns.

Compact references contain identifiers and current status. Source, control
values, and PNG bytes stay in their dedicated context surfaces.

#### Standalone text

`context.text` renders each selection and its bounded upstream cell context. It
contains source, definitions, references, direct parent IDs, notes, DOM hints,
and safely displayable values from relevant native marimo controls.

Lens reads at most 16 relevant controls per selected output. The text
projection includes at most 16 controls across the captured runtime snapshot.
Shared controls are read once. Passwords, file payloads, sensitive composite
controls, custom controls, AnyWidgets, and opaque state render as `[redacted]`
or `[unavailable]`.

The text preserves every selection when notes are empty or PNG capture is
unavailable. It materializes at most 64 cells from the selected outputs and
their upstream closure. When cells are omitted, the text reports the exact
count and up to 16 omitted cell IDs.

### `SelectionImage`

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

Moving or resizing a selection marks its stored image as outdated until a
replacement capture succeeds. A failed replacement preserves the prior pixels
with `outdated=True`.

Cross-origin images and external iframes can block browser rasterization. The
cell reference, note, and standalone text remain available when marked PNG
capture fails.

### `lens.activity(cell_id, *, label=None, message=None) -> None`

Validates that `cell_id` belongs to the current marimo graph, then sends a
best-effort browser event. When the displayed Lens receives it, the cell is
marked as active without scrolling or moving keyboard focus. The mark remains
until another activity call, a reveal, or Lens teardown. When the graph cell
has no rendered target, the Lens dock shows the activity state.

For a current, available selection:

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

Calling `activity()` again updates the displayed label and message or moves the
mark to another cell. `label` defaults to **Working**, is trimmed, treats empty
text as `None`, and accepts at most 40 UTF-16 code units. Activity preserves
selections and their revision.

`cell_id` must be a nonblank valid Unicode string with at most 128 UTF-16 code
units. `message` is trimmed, treats empty text as `None`, and accepts at most
240 UTF-16 code units.

Invalid arguments raise `TypeError` or `ValueError`. Expected `LensError.code`
values are `runtime_unavailable`, `cell_not_found`, and `lens_closed`.

### `lens.reveal(cell_id, *, message=None) -> None`

Validates that `cell_id` belongs to the current marimo graph, then sends a
best-effort browser event. When the displayed Lens receives it, the notebook
scrolls to the rendered cell, preserves keyboard focus, and highlights the
cell for about two seconds.

For a current, available selection:

```python
context = lens.context()
selection = context.current

if selection is not None and selection["cellStatus"] == "available":
    lens.reveal(
        str(selection["outputCellId"]),
        message="Updated the aggregation and verified the chart.",
    )
```

A second reveal replaces the current highlight. A graph cell with no
rendered target produces a transient notice. Reveal preserves selections and
their revision.

`cell_id` and `message` use the same validation as `activity()`. Invalid
arguments raise `TypeError` or `ValueError`. Expected `LensError.code` values
are `runtime_unavailable`, `cell_not_found`, and `lens_closed`.

### `lens.resolve(selection_ids, *, expected_revision, summary=None) -> int`

Moves one or more selections to the **History** tab against a captured
revision, releases their marked PNGs, then returns the resulting revision.

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

Pass one selection ID as a string or several IDs as a sequence. Lens validates
the full batch before changing state. Every selection in the batch receives the
same resulting revision and summary. If any ID is missing, the whole operation
fails and every selection remains open.

Resolving the current selection promotes the most recently active surviving
selection. Resolving other selections preserves the current selection. Stable
`S<n>` labels are never reallocated.

The History receipt keeps the selection label, cell ID, note, point or region,
creation time, addressed time, resulting revision, and optional summary.
History retains up to 64 of the newest receipts within its 64,000-byte state
budget. Users can clear History from the selection sheet. Clearing History also
removes prior resolution metadata from open selections while preserving their
human-authored attention and marked PNG.

Selecting **Reopen** in History restores that receipt as the current selection
and starts a fresh marked PNG capture. The History receipt remains available.
Reopen is a browser interaction.
History lives with the Lens instance and clears when that instance closes.

The state commit happens before Lens sends the best-effort **Addressed**
presentation event. Browser delivery does not affect the committed resolution
or History receipt.

Each selection ID must be a nonblank valid Unicode string with at most 128
UTF-16 code units. One batch accepts 1 through 64 unique IDs.
`expected_revision` must be a nonnegative integer within JSON’s safe integer
range. `summary` uses the same validation as the activity and reveal messages.

Invalid arguments raise `TypeError` or `ValueError`. For valid arguments, the
method checks lifecycle, revision, and selection identity in that order.
Expected `LensError.code` values are `lens_closed`, `revision_conflict`, and
`selection_not_found`. The error carries the current revision, and the
selection state remains unchanged.

### `lens.close() -> None`

Closes Lens, cancels its pending full-cell capture, and releases Lens-owned
selection images. Calling `close()` more than once has no effect.

Later calls to `context()`, `activity()`, `reveal()`, and `resolve()` raise
`LensError(code="lens_closed")`. A detached `LensContext` created before close
remains readable.

### `LensError`

Expected Lens operation failures raise `LensError`.

- `code` is the stable machine-readable failure code.
- `revision` is the current Lens selection revision when the error is created.

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
| Addressed history                    | 64 receipts and 64,000 UTF-8 bytes         |
| Compact references                   | 45,000 UTF-8 bytes                         |
| Standalone text                      | 64,000 characters                          |
| Relevant runtime cells               | 64                                         |
| Reported omitted cell IDs            | 16 plus the exact omitted count            |
| Controls included in standalone text | 16                                         |
| One PNG                              | 8 MiB, 2,048 pixels per edge, 4 megapixels |
| Stored selection PNG bytes per Lens  | 64 MiB                                     |

History keeps the newest receipts within both limits and evicts older receipts
first. A mutation that cannot fit active state, one completion receipt, or
required reference fields fails with `selection_context_limit` before state
changes.

## Browser behavior

The first displayed Lens view in a document owns interaction. Additional views
show **Lens is already active** until ownership becomes available. A Lens in
another same-origin document has an independent owner.

Keyboard users can move between eligible outputs and press Enter to create a
centered point. Escape cancels an armed gesture. Lens follows reduced-motion
preferences for scrolling and transitions.

Standard notebook outputs and `marimo-island[data-cell-id]` elements are
eligible automatically. A custom host can expose another rendered output by
putting its exact marimo cell ID on the visible output element:

```html
<section data-marimo-lens-output-cell-id="MJUe">...</section>
```

The cell ID must exist in the active marimo graph for runtime context, activity,
reveal, and resolution.

## Project

- [Documentation](https://marimo-team.github.io/marimo-lens/)
- [Source](https://github.com/marimo-team/marimo-lens)
- [Example notebook](https://github.com/marimo-team/marimo-lens/blob/main/examples/lens.py)
- [Issue tracker](https://github.com/marimo-team/marimo-lens/issues)
- [Security policy](https://github.com/marimo-team/marimo-lens/security/policy)
- [Apache License 2.0](https://github.com/marimo-team/marimo-lens/blob/main/LICENSE)
