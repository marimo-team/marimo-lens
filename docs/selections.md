---
title: Selections
description: Mark points and regions in notebook outputs or configured DOM roots, add notes, and manage open or addressed selections.
---

# Selections

A selection points an agent to one rendered target. Notebook outputs are
available by default. `dom_selector` adds page regions selected by a host-owned
CSS policy. Click to mark a point, drag to mark a region, and add a note when
the mark needs more context. One request can refer to several selections.

```marimo-config
requires-python = ">=3.10"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

## Create a selection

Press **Select**, or use `Option+L` on macOS and `Alt+L` elsewhere. Click once
for a point or drag for a region. Lens exits selection mode after it creates the
selection.

Try both gestures on the chart:

<div class="lens-doc-demo">

<div class="lens-doc-demo-steps lens-doc-demo-steps-two" aria-label="Create point and region selections">
  <span><strong>1</strong> Press <strong>Select</strong>, then click a bar</span>
  <span><strong>2</strong> Press <strong>Select</strong>, then drag across bars</span>
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
    _selection_demo_body = "Open either selection to add a note or change its focus."
elif _selection_demo_has_point:
    _selection_demo_state = "point"
    _selection_demo_title = "Point added. Now create a region."
    _selection_demo_body = (
        "Press <strong>Select</strong> again, then drag across two or more bars."
    )
elif _selection_demo_has_region:
    _selection_demo_state = "region"
    _selection_demo_title = "Region added. Now create a point."
    _selection_demo_body = "Press <strong>Select</strong> again, then click one bar."
else:
    _selection_demo_state = "empty"
    _selection_demo_title = "Create a point"
    _selection_demo_body = "Press <strong>Select</strong>, then click one bar."

_selection_demo_point_status = "Added" if _selection_demo_has_point else "Not yet"
_selection_demo_region_status = "Added" if _selection_demo_has_region else "Not yet"

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

Each new selection appears in **Open** with a stable `S<n>` label. Use its row
to add a note or inspect its image. Move or resize the marker on the output to
refine its point or region.

## Work with open selections

Open **Selections** to review open selections and their notes. Lens focuses the
current selection in the **Open** tab. That selection is the likely target when
you ask an agent to change "this" or inspect "here."

Choose another row to make it current. Editing its note, moving it, or resizing
it also makes it current. If the current selection leaves **Open**, Lens focuses
the most recently active selection that remains.

Open the note editor from a row, describe what the agent should inspect or
change, then press **Done**.

Press **Select** again when the request refers to another point or region. An
agent can resolve those selections together after one verified change.

Lens keeps each open selection connected as the document changes:

| Selection detail | What Lens keeps                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Label and note   | The `S<n>` label stays stable and is never reused.                                                                                          |
| Target           | Notebook outputs reconnect by cell ID. DOM targets reconnect by document path and an exact DOM selector.                                  |
| Producing cells  | A DOM target includes producer IDs inferred from nested `data-runtime-cell-id` metadata.                                                   |
| Annotated image  | Moving or resizing starts a fresh PNG capture. The previous image remains available and is marked outdated until the new capture succeeds.  |

Cross-origin images and external iframes can block image capture. The selection,
target reference, producing cells, and note remain available.

## Finish or reopen a selection

After completing the request, an agent marks the selection **Addressed**. Lens
moves it from **Open** to **History** with its target, note, point or region,
timestamps, and optional completion summary.

Selections completed by the same verified change can move together and share
one completion summary.

To continue a request, open **History** and press **Reopen**. Lens restores it
as the current selection and captures a fresh annotated image from the current
output.

## Keyboard

Use these keys while **Select** mode is active:

| Keys                                     | Result                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `Option+L` on macOS or `Alt+L` elsewhere | Start or refocus **Select** mode from the notebook or a same-origin output frame. |
| `↑` / `↓`                                | Move between selectable targets.                                                  |
| `Enter`                                  | Create a point in the center of the focused target.                               |
| `Tab`                                    | Exit **Select** mode and continue to the next dock control.                       |
| `Escape`                                 | Exit **Select** mode and return focus to **Select**.                              |

Open **Selections** for row, tab, and note controls:

| Keys                                 | Result                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `↑` / `↓` on an open selection       | Move focus between selection rows.                                        |
| `Enter` on an open selection         | Make the focused selection current.                                       |
| `←` / `→` on **Open** or **History** | Switch tabs when the other tab contains items.                            |
| `Tab` / `Shift+Tab`                  | Move through row actions. In the note editor, cycle through its controls. |
| `Escape` in **Selections**           | Close the sheet and return focus to **Selections**.                       |
| `Escape` in the note editor          | Close the editor and return focus to the selection marker or Lens dock.   |

## Multiple Lens instances

The first displayed Lens in a document owns interaction. Additional Lens views
show **Lens is already active** until the owner closes. A Lens in another
same-origin document has its own owner.

The [Python API reference](./api) describes the context, activity lifecycle,
reveal, and resolution methods used by agent integrations.
