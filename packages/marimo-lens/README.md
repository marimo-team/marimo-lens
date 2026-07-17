# marimo-lens

`marimo-lens` records point and region selections on rendered marimo outputs.
Each selection keeps its output cell ID, normalized geometry, bounded DOM hint,
optional note, and optional marked PNG.

```python
import marimo as mo
from marimo_lens import Lens

lens = mo.ui.anywidget(Lens())
lens
```

Press **Select**, then click or drag over an output. The pointer release creates
the selection immediately. Hover or focus its marker to add a note or preview
the exact stored snapshot. The selection list provides the same actions and
reveals an activated selection's output cell.

```python
context = lens.context()

context.revision
context.current
context.references
context.text

for image in context.images:
    use_image(image.selection_id, image.data)
```

`LensContext.references` is a compact `marimo-lens.context` version 1 object
for a consumer with access to the live notebook kernel. It carries selections,
the current selection ID, and output cell IDs. `LensContext.text` is a bounded
standalone handoff with current DAG lineage, source, DOM hints, and relevant
controls. `LensContext.images` contains successful PNG captures, including
retained captures marked outdated after a selection moves or resizes. It may be
empty.

Each reference has a runtime `cellStatus`. `available` means the graph contains
the exact output cell ID. `missing` means the runtime is available but that ID
is absent. `unavailable` means Lens could not read the current notebook
runtime. Browser output availability is a separate DOM state.

A missing-cell selection remains resolvable and reconnects to graph lineage
only when the exact cell ID returns.

Lens owns active selection metadata and image bytes in memory. Delete, clear,
and resolve operations release the identified entries. Display one `Lens`
instance in a live notebook.

Cross-origin content can block browser capture. A failed snapshot keeps the
cell-backed reference and standalone text context available.

After an agent verifies the requested notebook change, resolve the selection
against the revision that grounded the work:

```python
selection = context.current
if selection is not None:
    revision = lens.resolve(
        selection["id"],
        expected_revision=context.revision,
        summary="Updated the aggregation cell and verified the chart.",
    )
```

`resolve()` removes the named selection and its PNG, then returns the resulting
revision. Resolving the current selection promotes the most recently active
remaining selection. Resolving another selection preserves the current
selection. Lens sends the optional summary as a best-effort transient browser
receipt. Receipt delivery does not affect the committed resolution. The method
validates arguments, then checks widget lifecycle, revision, and selection
identity in that order. It raises `LensError` with `lens_closed`,
`revision_conflict`, or `selection_not_found` for those expected conditions.
The error carries the current Lens revision.
