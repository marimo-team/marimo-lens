---
title: Selections
description: Mark points and regions in notebook outputs or configured DOM roots, add notes, and manage Open selections and History.
---

# Selections

A selection is one point or region inside one rendered target, with a stable
`S<n>` label and an optional note. This page covers the controls a person uses
in the Lens dock: creating and adjusting selections, inspecting their images,
managing **Open** and **History**, and keyboard access. [How Lens
works](./how-lens-works) explains what a selection carries and how an agent
uses it.

To use these controls in your own notebook, install `marimo-lens` and keep this
cell displayed:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

**History** and **Reopen** need a Lens that keeps a record. Construct it with
`Lens(record=True)` to use them. [Getting started](./getting-started) includes
the installation command. The interactive chart on this page already mounts
its own Lens.

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
gestures become points. Click the code of a cell without output to select that
cell. Lens exits selection mode after it creates the
selection and opens the optional note editor.

Try both gestures on the chart:

<llm-exclude>

<div class="lens-doc-demo">

<div class="lens-doc-demo-steps lens-doc-demo-steps-two" aria-label="Create point and region selections">
  <span><strong>1</strong> Press <strong class='lens-select'>Select</strong>, then click a bar</span>
  <span><strong>2</strong> Press <strong class='lens-select'>Select</strong>, then drag across bars</span>
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
    _selection_demo_body = "Press <strong class='lens-select'>Select</strong> again, then drag across two or more bars."
elif _selection_demo_has_region:
    _selection_demo_state = "region"
    _selection_demo_title = "Region added. Now create a point."
    _selection_demo_body = (
        "Press <strong class='lens-select'>Select</strong> again, then click one bar."
    )
else:
    _selection_demo_state = "empty"
    _selection_demo_title = "Create a point"
    _selection_demo_body = (
        "Press <strong class='lens-select'>Select</strong>, then click one bar."
    )

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

Each new selection appears in **Open** with a stable `S<n>` label. Every Lens
in the notebook draws from one sequence, so a label names one selection. When a
Lens keeps a [request record](./data-and-trust#request-record), the sequence
continues after the highest label in the record, also after a kernel restart.
Two kernels that serve the same notebook file at once, or a Lens without a
record that ran before a file record opened, can give out a label the record
already holds. Use the row actions to edit its note, preview its selection
image, or remove it.

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
marker. Read [How Lens works](./how-lens-works#selection-images) for image
states and the separate cell-output image used after an agent change.

## Work with open selections

Press the list button in the dock to open **Requests**, the sheet that lists
open selections, their notes, and open chat requests. The button shows how
many requests are open. Drag the grip to move the dock out of the way. Lens
remembers its position in this browser for the site, including after a reload.
Collapse the dock to a compact Lens button, which you can also drag. The button
keeps the Open count visible.

Focus the grip or collapsed button and use arrow keys to move it. Hold `Shift`
for larger steps, press `Home` to reset to bottom center, or press `Escape`
to cancel a drag. **Requests** opens toward the available space and stays
inside the viewport.

Lens focuses the current selection in the **Open** tab. That selection is the
likely referent when you ask an agent to change “this” or inspect “here.”

Choose another row to make it current. Editing its note, moving it, or resizing
it also makes it current. If the current selection leaves **Open**, Lens focuses
the most recently activated selection that remains.

Open the note editor from a row, describe what the agent should inspect or
change, then press **Done**, or `Command+Enter` on macOS and `Ctrl+Enter`
elsewhere. The editor header shows the target's description, which names the
producing cell when the output has no heading or label of its own. On a Lens
with History, **Earlier requests that changed
this result** lists resolved requests that changed the selection's cells or
their upstream cells, undone ones first, each with its status, so the note can
build on them.

When an agent records a request from chat, it appears at the top of **Open**
as **Asked in chat**, with the agent's copy of the message and the time it
opened. It leaves **Open** when the agent resolves it.

Press **Select** again when the request refers to another point or region. An
agent can resolve those selections together after one verified change.

Use **Remove selection** to delete one Open selection. Use **Clear selections**
to delete every Open selection. These operations release their selection-image
bytes and leave History as it is. Removing the current selection makes the most
recently current remaining selection current.

Lens can reattach an Open selection after its target element is replaced within
the same browser document:

| Selection detail | What Lens keeps                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label and note   | The `S<n>` label stays stable, and the notebook runtime never issues it again.                                                                                                                  |
| Target           | The same document ID and path plus the cell ID or exact DOM selector identify the target. DOM targets also require the same source identities, producing-cell ID set, and selector eligibility. |
| Producing cells  | A DOM target includes producing cells from published source records or nested runtime metadata. Unkeyed roots remain tied to their original elements.                                           |
| Marker position  | A mark on a chart, image, video, or iframe stays on the same spot of that element when the output resizes or rerenders around it.                                                               |
| Selection image  | Moving or resizing starts a fresh PNG capture. The previous image remains available and is marked outdated until the new capture succeeds.                                                      |

A full document replacement creates a new opaque document identity. The old
selection then remains Open with **Target unavailable** until it is removed or
resolved. Cross-origin images and inaccessible iframes can block image capture.
The selection details remain available. [Custom
targets](./custom-targets#keep-targets-stable) explains DOM target identity.

## Resolve or reopen a selection

After verifying the work, an agent calls `resolve()`. Lens closes each resolved
selection. Each owning browser document shows a temporary resolution receipt
for the selections it owns, with the visible status **Addressed**, the agent's
summary, and the cells the change touched.

Selections resolved by the same verified change can be resolved together and
share one resolution summary.

The receipt remains for six seconds and pauses while hovered or focused. On a
Lens with History, clicking it opens the matching History entries in
**Requests**, and outside an open **Requests** sheet it also shows **View in
History**. On a Lens without History, clicking it dismisses the receipt, and
the sheet lists only open requests.

**History** lists resolved requests from the record, newest first, including
requests the agent recorded from chat. Each entry leads with whether its
changes still hold, then shows when it resolved, the selection's target, the
note, and the cells it changed with who undid them:

| Entry status    | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| Still applied   | Every change the request made still holds.                           |
| Undone          | Every change was undone.                                             |
| 1 of 2 undone   | Some changes were undone and the others still hold.                  |
| Status unknown  | Lens cannot tell whether a change still holds.                       |
| No cell changes | The request changed no cells, such as a question the agent answered. |

History names a cell by its marimo name or by the variables it defines. A cell
with neither is an **Unnamed cell**, a cell the notebook no longer holds is a
**Deleted cell**, and a cell Lens cannot find is **Cell not found**. Expand an
entry to see the image the analyst marked, the agent's summary, and the status
of each changed cell:

| Change status                       | Meaning                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Still applied                       | What the request added is still in the cell, even where a later request rewrote the line around it.           |
| Undone by S4                        | A later request changed the cell back. A chat request is named by the start of its note.                      |
| Undone by an edit made outside Lens | An edit outside every recorded request changed it back.                                                       |
| Undone                              | The cell changed back, and the record cannot name the edit.                                                   |
| Status unknown                      | The record or the notebook cannot tell. The [context reference](./reference/context#history) lists the cases. |

An undone change also lists the statements it added that its cell no longer
holds. **Show cells** reveals the cells an entry pointed at or changed. With a
selection open, **Only requests that changed what S1 shows** narrows History to
requests that changed that selection's cells or their upstream cells. History
and the note editor's earlier requests refresh every 5 seconds while they are
visible, so edits made outside Lens change the status there.

To continue a selection, press **Reopen** while its target is available in this
document. Lens restores the selection as current in **Open**, follows its cell
to the notebook now, and starts a fresh selection-image capture. The resolved
request stays in History. A reopened label that an open selection already uses
fails, so resolve or delete that selection first.

History shows the newest 100 resolved requests and says how many older ones the
record holds. It lasts as long as the
[request record](./data-and-trust#request-record). Open selections and stored
selection images last for the lifetime of the live Lens instance.
`lens.close()` or notebook-runtime teardown releases them.

## Keyboard

Use these keys while selection mode is active:

| Keys                                     | Result                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `Option+L` on macOS or `Alt+L` elsewhere | Start or refocus selection mode from the notebook or a same-origin output frame. |
| `↑` / `↓`                                | Move between selectable targets.                                                 |
| `Enter`                                  | Create a point in the center of the focused target.                              |
| `Tab`                                    | Exit selection mode and continue to the next dock control.                       |
| `Escape`                                 | Exit selection mode and return focus to **Select**.                              |

Open **Requests** for row, tab, and note controls:

| Keys                                               | Result                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `↑` / `↓` on an open selection                     | Move focus between selection rows.                                        |
| `Enter` on an open selection                       | Make the focused selection current.                                       |
| `←` / `→` on **Open** or **History**               | Switch tabs when the Lens shows History and the other tab has items.      |
| `Tab` / `Shift+Tab`                                | Move through row actions. In the note editor, cycle through its controls. |
| `Escape` in **Requests**                           | Close the sheet and return focus to **Requests**.                         |
| `Command+Enter` or `Ctrl+Enter` in the note editor | Save the note and close the editor.                                       |
| `Escape` in the note editor                        | Close the editor and return focus to the selection marker or Lens dock.   |
| `Enter` or `Space` on an image action              | Pin the preview and move focus to its close control.                      |
| `Escape` in an image preview                       | Close the preview and restore focus to its image action.                  |

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

The Lens displayed highest in a document owns interaction. Additional views
render no Lens UI and log a warning to the browser console. Use
`marimo_lens.agent.connect()` to access the Lens that owns the visible dock.
Ownership passes to the next Lens when the current owner closes, and a Lens
whose cell reruns takes it back. A Lens in
another same-origin document has its own owner.

[How Lens works](./how-lens-works#activity-reveal-and-resolve) distinguishes
activity, reveal, resolution, History entries, and resolution receipts. The
[Python API](./api) defines the agent-facing operations.
