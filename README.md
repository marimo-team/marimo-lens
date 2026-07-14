# marimo-lens

`marimo-lens` collects precise feedback from a live marimo notebook. Select a
rendered table, chart, widget, cell output, or DOM region, write a note, and copy
a packet that identifies the notebook cells and runtime state an agent should
edit.

```python
import marimo as mo
from marimo_lens import Lens

lens = mo.ui.anywidget(Lens())
lens
```

`Lens()` scans the active marimo runtime, dataflow graph, globals, display
cells, UI controls, anywidgets, traitlets state, and visible notebook targets.
The project assumes trusted notebooks, local machines, and agent sessions.

## Install

Use Node 22.18 or newer and the pnpm version declared in the root
`package.json`.

Install the Python and JavaScript workspaces from a checkout, then build the
widget assets:

```sh
uv sync --locked --all-packages --all-groups
pnpm install --frozen-lockfile
pnpm build
```

Run the workbench against controls, dataframes, charts, SVG, and nested
anywidgets:

```sh
uv run --all-packages --group workbench marimo edit workbench/demo.py
```

## Feedback

Lens exports the same feedback in two forms:

```python
feedback = lens.pair_feedback
prompt = lens.pair_prompt
```

The packet contains selected and related cells, defs, refs, chart parts, table
columns, widget controls, DOM evidence, current UI values, trait state, graph
state, and suggested edit boundaries. Copying feedback refreshes Python context
before reading the packet.

Refresh the Lens dock after adding a marimo cell so target discovery sees the
updated graph.

## Targeting

Built-in selection covers Lens markers, marimo output cells, semantic tables
and grids, Altair or Vega, Plotly, Matplotlib, generic SVG charts, canvas and
visual surfaces, media, documents, interactive controls, and open shadow roots.

Use these extension points for domain-specific targets:

- `include`, `exclude`, `targets`, and `target(...)` narrow or anchor targets.
- `EntityInspector` describes custom Python objects.
- `ChartInspector`, `chart_adapter(...)`, and `chart_part(...)` describe custom
  chart libraries.

## Agent receipts

Agents can report work through the same widget:

```python
from marimo_lens import find_lens

lens = find_lens(required=False)
if lens is not None:
    run_id = lens.agent_started(label="marimo-pair")
    lens.mark_cells(["cell-a"], kind="edited", run_id=run_id)
    lens.resolve_annotation("ml-123", status="addressed", run_id=run_id)
    lens.agent_finished("Updated the chart filter.", run_id=run_id)
```

Read the result through `lens.export_pair_result()` or
`lens.export_pair_result_prompt()`.

## Development

Start the Vite server:

```sh
pnpm dev
```

Run the workbench in another shell:

```sh
MARIMO_LENS_VITE_DEV_SERVER=http://127.0.0.1:5173 \
  uv run --all-packages --group workbench \
  marimo run workbench/demo.py --port 28889 --headless
```

Run the complete local gate before review:

```sh
make check
```

See [Architecture](development_docs/architecture.md) for package ownership and
[Development](development_docs/development.md) for watch mode, packaging, and
browser checks.

## Acknowledgements

marimo-lens was inspired by
[Agentation](https://github.com/benjitaylor/agentation).
