---
title: Selections
description: Mark points and regions in notebook outputs or configured DOM roots, add notes, and manage Open selections and History.
---

# Selections

A selection stores one point or region inside one rendered target. It also
stores a stable label, optional note, target identity, producing-cell IDs, a
bounded DOM hint, and selection-image status. A request is the task given to an
agent and can refer to several selections.

Notebook output targets are available by default. `dom_selector` adds
configured DOM targets through a host-owned CSS policy. Read [Targets](./concepts/targets)
for target priority, producing-cell metadata, documents, and reattachment.

To use these controls in your own notebook, install `marimo-lens` and keep this
cell displayed:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

[Getting started](./getting-started) includes the installation command. The
interactive chart on this page already mounts its own Lens.

<llm-exclude>

```marimo-config
requires-python = ">=3.10,<3.15"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

</llm-exclude>

## Create a selection

Press **Select**, or use `Option+L` on macOS and `Alt+L` elsewhere. Click once
for a point or drag at least five pixels along both axes for a region. Smaller
gestures become points. Lens exits selection mode after it creates the
selection and opens the optional note editor.

Try both gestures on the chart:

<llm-exclude>

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

</llm-exclude>

Each new selection appears in **Open** with a stable `S<n>` label. Labels are
never reused during the Lens instance lifetime. Use the row actions to edit its
note, preview its selection image, or remove it.

Drag a point or region marker to move it. The current region exposes four
resize handles. Lens clamps the marker to its target. Press `Escape` during a
move or resize to restore the committed geometry.

## Inspect selection images

Lens starts image capture after it stores a new selection. The selection stays
available when capture is pending or fails.

| Image state         | What you can do                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Preparing image     | Use the selection reference and available graph context while capture runs.                                   |
| View image          | Hover or focus to open the preview. Click to pin it.                                                          |
| View previous image | Inspect the retained image from before the marker moved while replacement capture runs.                       |
| Image unavailable   | Continue with the selection details and retry by moving or recreating the selection when pixels are required. |

The preview reports its pixel dimensions. A previous image is marked
`outdated` in the API because its point or region no longer matches the current
marker. Read [Context and evidence](./concepts/evidence) for capture composition,
image limits, and the separate cell-output image used after an agent change.

## Work with open selections

Open **Selections** to review open selections and their notes. The dock shows
the Open count. Drag the grip to move the dock out of the way. Lens remembers
its position in this browser for the site, including after a reload. Collapse
the dock to a compact Lens button, which you can also drag. The button keeps the
Open count visible.

Focus the grip or collapsed button and use arrow keys to move it. Hold `Shift`
for larger steps, press `Home` to reset to bottom center, or press `Escape`
to cancel a drag. Selections open toward the available space and stay inside
the viewport.

Lens focuses the current selection in the **Open** tab. That selection is the
likely referent when you ask an agent to change “this” or inspect “here.”

Choose another row to make it current. Editing its note, moving it, or resizing
it also makes it current. If the current selection leaves **Open**, Lens focuses
the most recently activated selection that remains.

Open the note editor from a row, describe what the agent should inspect or
change, then press **Done**.

Press **Select** again when the request refers to another point or region. An
agent can resolve those selections together after one verified change.

Use **Remove selection** to delete one Open selection. Use **Clear selections**
to delete every Open selection. These operations release their selection-image
bytes. They do not clear History. Removing the current selection makes the most
recently current remaining selection current.

Lens can reattach an Open selection after its target element is replaced within
the same browser document:

| Selection detail | What Lens keeps                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label and note   | The `S<n>` label stays stable and is never reused.                                                                                                                                              |
| Target           | The same document ID and path plus the cell ID or exact DOM selector identify the target. DOM targets also require the same source identities, producing-cell ID set, and selector eligibility. |
| Producing cells  | A DOM target includes producing cells from published source records or nested runtime metadata. Unkeyed roots remain tied to their original elements.                                           |
| Selection image  | Moving or resizing starts a fresh PNG capture. The previous image remains available and is marked outdated until the new capture succeeds.                                                      |

A full document replacement creates a new opaque document identity. The old
selection then remains Open with **Target unavailable** until it is removed or
resolved. Cross-origin images and inaccessible iframes can block image capture.
The selection details remain available.

## Resolve or reopen a selection

After verifying the work, an agent calls `resolve()`. Lens moves each resolved
selection from **Open** to **History** with its target, note, point or region,
timestamps, and optional resolution summary. Each owning browser document shows
a temporary resolution receipt for the selections it owns, with the visible
status **Addressed**.

Selections resolved by the same verified change can move together and share
one resolution summary.

The receipt remains for six seconds and pauses while hovered or focused. Open
it to inspect the matching History entries.

To continue a request, open **History** and press **Reopen** while the target is
available. Lens keeps the History entry, restores the selection as current in
**Open**, and starts a fresh selection-image capture from the current target.
When the target is unavailable, the History entry remains unchanged. Restore
the target in the same browser document, then try again.

Use **Clear history** to remove every History entry. Open selections and their
images remain. Clearing History also removes prior-resolution metadata from
currently reopened selections. History keeps the newest 64 entries within a
64,000-byte metadata budget and evicts the oldest entries when either bound is
reached.

Open selections, History, and stored selection images last for the lifetime of
the live Lens instance. `lens.close()` or notebook-runtime teardown releases
them.

## Keyboard

Use these keys while selection mode is active:

| Keys                                     | Result                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `Option+L` on macOS or `Alt+L` elsewhere | Start or refocus selection mode from the notebook or a same-origin output frame. |
| `↑` / `↓`                                | Move between selectable targets.                                                 |
| `Enter`                                  | Create a point in the center of the focused target.                              |
| `Tab`                                    | Exit selection mode and continue to the next dock control.                       |
| `Escape`                                 | Exit selection mode and return focus to **Select**.                              |

Open **Selections** for row, tab, and note controls:

| Keys                                  | Result                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `↑` / `↓` on an open selection        | Move focus between selection rows.                                        |
| `Enter` on an open selection          | Make the focused selection current.                                       |
| `←` / `→` on **Open** or **History**  | Switch tabs when the other tab contains items.                            |
| `Tab` / `Shift+Tab`                   | Move through row actions. In the note editor, cycle through its controls. |
| `Escape` in **Selections**            | Close the sheet and return focus to **Selections**.                       |
| `Escape` in the note editor           | Close the editor and return focus to the selection marker or Lens dock.   |
| `Enter` or `Space` on an image action | Pin the preview and move focus to its close control.                      |
| `Escape` in an image preview          | Close the preview and restore focus to its image action.                  |

Use these keys on the current region's resize handles:

| Keys                      | Result                                                         |
| ------------------------- | -------------------------------------------------------------- |
| Arrow key                 | Move the selected corner by 1 percent of the target dimension. |
| `Shift` plus an arrow key | Move the selected corner by 5 percent.                         |
| `Escape`                  | Cancel the current resize and restore the committed region.    |

Lens announces selection-mode changes, saved selections, attempts to use an
unavailable target, and agent attention through polite live regions for
screen-reader users.

## Multiple Lens instances

The first displayed Lens in a document owns interaction. Additional Lens views
show **Lens is already active** until the owner closes. A Lens in another
same-origin document has its own owner.

The [Feedback and History](./concepts/feedback) concept page distinguishes
activity, reveal, resolution, History entries, and resolution receipts. The
[Python API reference](./api) defines the agent-facing operations.
