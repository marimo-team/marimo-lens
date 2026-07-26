---
title: Python API reference
description: Python API contracts for reading Lens requests and returning agent work for review.
---

# Python API reference

The Python API lets notebook agents read the current selection, show their work
in the notebook, reveal a result, and complete a request.

The package exports `Lens`, `LensContext`, `SelectionImage`, and `LensError`.

```marimo-config
requires-python = ">=3.11"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

## Try the methods

Create one or more selections on the chart, then run the methods in order. Each
control calls the same Lens API that a notebook agent uses.

<div class="lens-doc-demo">

<div class="lens-doc-demo-steps" aria-label="Try the Lens API in four steps">
  <span><strong>1</strong> Press Select</span>
  <span><strong>2</strong> Mark the chart</span>
  <span><strong>3</strong> Read and mark activity</span>
  <span><strong>4</strong> Complete the request</span>
</div>

```python marimo output=false
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
        "line-height:1.25rem'>activity()</span>"
    ),
)
api_complete_button = mo.ui.run_button(
    label=(
        "<span style='display:block;padding:0.3rem 0.75rem;"
        "line-height:1.25rem'>resolve() + reveal()</span>"
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
                "imageStatus": str(
                    _context_snapshot.get("status", "pending")
                ),
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
        api_demo_lens.activity(
            _activity_cell_id,
            label="Working on it…",
            message="Reviewing the selected result",
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
                "Completed the API walkthrough and returned the "
                "result for review."
                if _complete_count == 1
                else (
                    f"Completed {_complete_count} requests in the API "
                    "walkthrough and returned the result for review."
                )
            )
            _complete_revision = api_demo_lens.resolve(
                _complete_ids,
                expected_revision=_complete_context.revision,
                summary=_complete_summary,
            )
            api_demo_lens.reveal(
                _complete_cell_id,
                message=_complete_summary,
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
_api_demo_open_count = len(
    _api_demo_context.references.get("selections", [])
)
_api_demo_kind = (
    str(_api_demo_result["kind"])
    if _api_demo_result is not None
    else ("ready" if _api_demo_current is not None else "empty")
)

if _api_demo_kind == "empty":
    _api_demo_title = "Select part of the chart"
    _api_demo_body = (
        "Press Select in the Lens dock, then click a bar or drag a region."
    )
elif _api_demo_kind == "missing":
    _api_demo_title = "Create a selection first"
    _api_demo_body = (
        "Mark part of the chart before calling a method on the request."
    )
elif _api_demo_kind == "ready":
    _api_demo_label = escape(
        str(_api_demo_current.get("label", "Selection"))
    )
    _api_demo_noun = (
        "request" if _api_demo_open_count == 1 else "requests"
    )
    _api_demo_title = f"{_api_demo_label} is ready"
    _api_demo_body = (
        f"Lens has {_api_demo_open_count} open {_api_demo_noun}. "
        "Call context() to inspect what the agent can read."
    )
elif _api_demo_kind == "context":
    _api_demo_label = escape(str(_api_demo_result["label"]))
    _api_demo_note = (
        escape(str(_api_demo_result["note"]))
        or "No note added"
    )
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
    _api_demo_title = "activity() marked the cell"
    _api_demo_body = (
        f"Cell <code>{_api_demo_cell}</code> now shows "
        "<strong>Working on it…</strong>."
    )
else:
    _api_demo_count = int(_api_demo_result["count"])
    _api_demo_noun = (
        "request" if _api_demo_count == 1 else "requests"
    )
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
selection.

Expected `LensError.code` values are `lens_closed`, `revision_conflict`, and
`selection_not_found`.

### `lens.close() -> None`

Closes Lens, cancels pending full-cell capture, and releases Lens-owned
annotated images. Calling `close()` more than once has no effect.

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
`outputCellId`, point or region, annotated image status, and runtime
`cellStatus`.

`cellStatus` is:

- `available` when the current graph contains the exact output cell ID
- `missing` when the runtime is available and the cell ID is absent
- `unavailable` when Lens cannot inspect the current marimo runtime

Standalone text includes selected cell source, relevant upstream cell source,
definitions, references, direct parent IDs, notes, and safely displayable native
marimo control values. Passwords, file payloads, custom controls, AnyWidgets,
and opaque state render as `[redacted]` or `[unavailable]`.

## `SelectionImage`

`context.images` contains successful annotated PNG captures. Match an image to
a selection with `SelectionImage.selection_id`.

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
| One annotated PNG                    | 8 MiB, 2,048 pixels per edge, 4 megapixels |
| Stored annotated PNG bytes per Lens  | 64 MiB                                     |

A mutation that cannot fit the synchronized selection state or required
reference fields raises `LensError(code="selection_context_limit")` before the
state changes.
