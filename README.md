# marimo-lens

`marimo-lens` lets a notebook user point at a rendered output, keep that
selection as a cell-backed reference, and hand compact context to an agent.
A click selects a point. A drag selects a region. The selection is available
as soon as the pointer is released. Notes and marked PNGs enrich the reference
when they are available.

```python
import marimo as mo
from marimo_lens import Lens

lens = mo.ui.anywidget(Lens())
lens
```

Press **Select**, then click or drag inside an output. Lens creates `S1` and
returns to its resting state. Hover or focus the marker to add a note beside
the selection or preview the exact stored snapshot.

The bottom-center dock stays open until you collapse it. **Copy** copies the
current reference. The actions menu exposes all selection references and the
standalone text context.

Read one current context snapshot from Python:

```python
context = lens.context()

context.current      # most recently created, activated, or edited selection
context.references   # compact live output-cell references
context.text         # standalone text with bounded DAG context

for image in context.images:
    send_to_vision_model(
        data=image.data,
        media_type=image.media_type,
    )
```

`context()` refreshes the marimo DAG, source context, and relevant controls on
every call. `context.text` remains complete when the user writes no note and
when the receiving model accepts text input only. Successful and retained
outdated captures appear in `context.images` in selection order.

Display one `Lens` instance in a live notebook. Selection commands use the
running kernel, so static exports can render the widget state but cannot create
or mutate selections.

## Context contract

`LensContext` exposes four related views of one selection revision:

| Surface      | Contract                                                               | Consumer                                    |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------- |
| `current`    | The current selection reference, or `None`                             | “Use my current selection” flows            |
| `references` | JSON-safe selections with output cell IDs and image status             | marimo-pair or another live kernel resolver |
| `text`       | Standalone text with notes, DOM hints, source, DAG edges, and controls | Text-only models and clipboard workflows    |
| `images`     | Successful marked PNG captures                                         | Models that accept image input              |

The references object uses `marimo-lens.context` version 1. It carries
selection metadata, `currentSelectionId`, and stable output cell IDs. A live
consumer resolves each `outputCellId` through marimo's current cell collection
and dataflow graph.

marimo-pair can evaluate `lens.context()` in the same kernel and resolve those
cell IDs directly. Lens has no Pair dependency or Pair-specific API. Pair can
start from `context.current`, query graph neighbors when the request needs
them, and keep notebook edits, scratchpad state, and agent lifecycle on its side
of the boundary.

`context.text` materializes the selected cells and their bounded upstream
closure. It includes source, definitions, references, direct parent IDs, and
relevant current control values. Images add capture-time visual detail.

Cross-origin images and external iframes can block browser capture. Lens keeps
the selection, output cell ID, geometry, DOM hint, and text context when a
snapshot fails.

## Install

Use Node 22.18 or newer and the pnpm version declared in `package.json`.

```sh
uv sync --locked --all-packages --all-groups
pnpm install --frozen-lockfile
pnpm build
```

Run the browser workbench:

```sh
env -u MARIMO_LENS_VITE_DEV_SERVER \
  uv run --locked --all-packages --all-groups \
  marimo run workbench/demo.py --port 28889 --headless
```

## Development

Start the Vite server:

```sh
pnpm dev
```

Run the workbench in another shell:

```sh
MARIMO_LENS_VITE_DEV_SERVER=http://localhost:5173 \
  uv run --all-packages --group workbench \
  marimo run workbench/demo.py --port 28889 --headless
```

Run the local gate before review:

```sh
make check
```

See [Architecture](development_docs/architecture.md) for package ownership and
[Development](development_docs/development.md) for build and browser workflows.

## Acknowledgements

marimo-lens was inspired by
[Agentation](https://github.com/benjitaylor/agentation).
