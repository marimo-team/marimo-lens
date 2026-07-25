# Selections

A Lens selection marks one rendered output cell. A point or rectangle narrows
attention within that output, and an optional note records what you want an
agent to inspect or change.

## Point and region selections

Press **Select**, then use one gesture:

- Click to mark a point.
- Drag to mark a rectangular region.

Pointer release creates the selection immediately and returns Lens to rest.
Notes are optional and can be added after the gesture.

Moving or resizing a selection keeps its stable `S<n>` label and starts a fresh
marked image capture.

## Current selection

Lens keeps one open selection current. New selections become current
immediately. Activating a row, editing its note, moving it, or resizing it also
makes it current.

When the current selection is deleted or addressed, Lens promotes the most
recently active open selection.

Stable labels are never reused. Deleting `S2` does not rename later selections.

## Output changes

Each selection stores the exact marimo output cell ID.

When an output rerenders, Lens reconnects the selection to the current output.
When the output temporarily disappears, the selection, note, and marked image
remain available. Returning the same cell ID reconnects it to the notebook.

## Marked images

Lens attempts to capture a marked PNG for each selection. The PNG helps when
pixels, layout, or a chart region affects the task.

Moving or resizing a selection marks its current PNG as outdated until the
replacement capture succeeds. A failed replacement keeps the prior image and
labels it outdated.

Cross-origin images and external iframes can block browser capture. The output
cell reference and note remain available when image capture fails.

## Addressed history

An agent can mark a selection **Addressed** after completing the request. The
open selection moves to **History** with its cell, note, point or region,
timestamps, and optional completion summary. Lens releases its marked PNG.

Several selections completed by the same verified change can move to History
together. They share one completion summary and resolution revision.

Reopening a history item restores it as the current selection and starts a
fresh marked image capture. The History item remains available for the next
pass.

## Keyboard and multiple Lens views

Keyboard users can move between eligible outputs and press Enter to create a
centered point. Escape cancels an armed gesture. Lens follows the browser's
reduced-motion preference.

The first displayed Lens in a document owns interaction. Additional Lens views
show **Lens is already active** until the owner closes. A Lens in another
same-origin document has its own owner.

[Python API](./api) describes the context, activity, reveal, and resolution
methods used by agent integrations.
