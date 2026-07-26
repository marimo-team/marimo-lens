# Selections

A Lens selection marks one rendered output cell. A point or rectangle narrows
attention within that output, and an optional note records what you want an
agent to inspect or change.

```marimo-config
requires-python = ">=3.11"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

## Try both gestures

Create one point and one region on the same chart. The status updates from the
selections stored by Lens.

<div class="lens-doc-demo">

<div class="lens-doc-demo-steps lens-doc-demo-steps-two" aria-label="Create point and region selections">
  <span><strong>1</strong> Press Select, then click a bar</span>
  <span><strong>2</strong> Press Select, then drag across bars</span>
</div>

```python marimo output=false
import marimo as mo
from marimo_lens import Lens

get_selection_demo_revision, set_selection_demo_revision = mo.state(0)
```

<div class="lens-doc-demo-mount">

```python marimo
selection_demo_lens = Lens()

def _sync_selection_demo_revision(change):
    set_selection_demo_revision(int(change["new"]["revision"]))

selection_demo_lens.observe(
    _sync_selection_demo_revision,
    names="_state",
)
selection_demo_lens
```

</div>

<div class="lens-doc-demo-output">

```python marimo
_selection_demo_values = [
    ("January", 42),
    ("February", 58),
    ("March", 67),
    ("April", 51),
]
_selection_demo_rows = "".join(
    f"""
    <div
      class="lens-selection-demo-row"
      role="listitem"
      aria-label="{_month}, {_value} thousand"
    >
      <span>{_month}</span>
      <span class="lens-selection-demo-track" aria-hidden="true">
        <span
          data-selection-demo-bar
          style="width:{_value / 70 * 100:.1f}%"
        ></span>
      </span>
      <span>{_value}</span>
    </div>
    """
    for _month, _value in _selection_demo_values
)
mo.Html(
    f"""
    <figure
      class="lens-selection-demo-chart"
      aria-labelledby="lens-selection-demo-title"
    >
      <figcaption>
        <span>
          <strong id="lens-selection-demo-title">Monthly revenue</strong>
          <small>USD thousands</small>
        </span>
        <small>Jan–Apr 2026</small>
      </figcaption>
      <div class="lens-selection-demo-rows" role="list">
        {_selection_demo_rows}
      </div>
    </figure>
    """
)
```

</div>

<div class="lens-doc-demo-status">

```python marimo
_selection_demo_revision = get_selection_demo_revision()
_selection_demo_context = selection_demo_lens.context()
_selection_demo_kinds = {
    str(_selection.get("anchor", {}).get("kind", ""))
    for _selection in _selection_demo_context.references.get(
        "selections",
        [],
    )
}
_selection_demo_has_point = "point" in _selection_demo_kinds
_selection_demo_has_region = "rect" in _selection_demo_kinds

if _selection_demo_has_point and _selection_demo_has_region:
    _selection_demo_state = "complete"
    _selection_demo_title = "Point and region added"
    _selection_demo_body = (
        "Open either selection to add a note or change its focus."
    )
elif _selection_demo_has_point:
    _selection_demo_state = "point"
    _selection_demo_title = "Point added. Now create a region."
    _selection_demo_body = (
        "Press Select again, then drag across two or more bars."
    )
elif _selection_demo_has_region:
    _selection_demo_state = "region"
    _selection_demo_title = "Region added. Now create a point."
    _selection_demo_body = (
        "Press Select again, then click one bar."
    )
else:
    _selection_demo_state = "empty"
    _selection_demo_title = "Create a point"
    _selection_demo_body = "Press Select, then click one bar."

_selection_demo_point_status = (
    "Added" if _selection_demo_has_point else "Not yet"
)
_selection_demo_region_status = (
    "Added" if _selection_demo_has_region else "Not yet"
)

mo.Html(
    f"""
    <aside
      data-selection-demo-state="{_selection_demo_state}"
      data-selection-demo-revision="{_selection_demo_revision}"
      aria-live="polite"
    >
      <span class="lens-doc-demo-eyebrow">Gesture progress</span>
      <strong>{_selection_demo_title}</strong>
      <div>{_selection_demo_body}</div>
      <div class="lens-selection-demo-progress">
        <span data-complete="{str(_selection_demo_has_point).lower()}">
          <strong>Point</strong>
          {_selection_demo_point_status}
        </span>
        <span data-complete="{str(_selection_demo_has_region).lower()}">
          <strong>Region</strong>
          {_selection_demo_region_status}
        </span>
      </div>
    </aside>
    """
)
```

</div>

</div>

Releasing the pointer creates the selection and returns Lens to rest. Add an
optional note in the selection sheet. Moving or resizing a selection keeps its
stable `S<n>` label and starts a fresh annotated image capture.

## Selection focus

Lens keeps one open selection current. New selections become current
immediately. Activating a row, editing its note, moving it, or resizing it also
makes it current.

Press **Select** again to add another point or region. Every open selection
keeps its own stable label, note, producing cell, and annotated image.

The current selection is the likely focus when a request refers to "this" or
"here." Select another row to change that focus before asking the agent.

Several selections can describe one change. An agent can resolve them together
after one verified result addresses every supplied selection. When those
selections share an output cell, a current cell image can show all of their
marks together.

When the current selection is deleted or addressed, Lens promotes the most
recently active open selection. Stable labels are never reused.

## Output changes

Each selection stores the exact marimo output cell ID.

When an output rerenders, Lens reconnects the selection to the current output.
When the output temporarily disappears, the selection, note, and annotated image
remain available. Returning the same cell ID reconnects it to the notebook.

## Annotated images

Lens attempts to capture an annotated PNG for each selection. An agent can
inspect the PNG when pixels, layout, or a chart region affects the task.

Moving or resizing a selection marks its current PNG as outdated until the
replacement capture succeeds. A failed replacement keeps the prior image and
labels it outdated.

Cross-origin images and external iframes can block browser capture. The output
cell reference and note remain available when image capture fails.

## History

An agent can mark a selection **Addressed** after completing the request. The
open selection moves to **History** with its cell, note, point or region,
timestamps, and optional completion summary. Lens releases its annotated PNG.

Several selections completed by the same verified change can move to History
together. They share one completion summary and resolution revision.

Reopening a history item restores it as the current selection and starts a
fresh annotated image capture. The History item remains available for the next
pass.

## Keyboard

Keyboard users can move between eligible outputs and press Enter to create a
centered point. Escape cancels an armed gesture. Lens follows the browser's
reduced-motion preference.

## Multiple Lens instances

The first displayed Lens in a document owns interaction. Additional Lens views
show **Lens is already active** until the owner closes. A Lens in another
same-origin document has its own owner.

The [Python API reference](./api) describes the context, activity, reveal, and
resolution methods used by agent integrations.
