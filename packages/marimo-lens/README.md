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
the selection immediately. Add a note from the selection list when needed.

```python
context = lens.context()

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

Lens keeps selection metadata and image bytes for the lifetime of its widget
instance. Display one `Lens` instance in a live notebook.

Cross-origin content can block browser capture. A failed snapshot keeps the
cell-backed reference and standalone text context available.
