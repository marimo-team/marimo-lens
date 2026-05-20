# marimo-lens

Agent-ready feedback for live marimo notebooks.

`marimo-lens` is an anywidget overlay for collecting precise notebook feedback:
click a rendered table, chart, widget, cell output, or DOM region; write the note;
copy a packet that an agent can use to make the edit in the right marimo cells.

Add it to your marimo notebook with:

```python
import marimo as mo
from marimo_lens import Lens

lens = mo.ui.anywidget(Lens())
lens
```

To see Lens against many output types, run the workbench:

```sh
uv run marimo edit workbench/demo.py
```

`Lens()` scans the active marimo runtime, dataflow graph, globals, display cells,
UI controls, anywidgets, traitlets state, and visible notebook targets. It is
designed for trusted notebooks on trusted local machines; collected context is
not redacted.

## Install

Until the first package release, install from a checkout:

```sh
uv sync --dev
uv pip install -e .
pnpm install
pnpm run build
```

After release, the package should install as:

```sh
pip install marimo-lens
```

## Feedback

Lens exports the same feedback in two forms:

```python
feedback = lens.pair_feedback  # JSON-safe packet
prompt = lens.pair_prompt  # paste-ready marimo-pair prompt
```

The packet includes:

- selected target cells, related cells, defs, and refs
- selected chart parts, table columns, widget controls, or DOM evidence
- current marimo UI values, anywidget traits, and graph state
- suggested edit boundaries for a marimo-pair agent

Copying feedback asks Python for a fresh context scan first, so the packet tracks
current controls, widget state, and graph lineage.

If you add a new marimo cell after mounting Lens, press the refresh/rescan
button in the Lens dock so Lens rescans the notebook graph before you capture
feedback.

## Targeting

Built-in selection covers explicit Lens markers, marimo output cells, semantic
tables and grids, Altair/Vega, Plotly, Matplotlib, generic SVG charts, visual
surfaces, media, documents, interactive controls, and open shadow roots.

Use the public extension points when the defaults need domain knowledge:

- `include`, `exclude`, `targets`, and `target(...)` for narrowing or anchoring
  targets
- `EntityInspector` for custom Python objects
- `ChartInspector`, `chart_adapter(...)`, and `chart_part(...)` for custom chart
  libraries

The collection pipeline is internal. Keep integrations on the public API above.

## Agent Receipts

Agents can report work back through the same widget:

```python
from marimo_lens import find_lens

lens = find_lens(required=False)
if lens is not None:
    run_id = lens.agent_started(label="marimo-pair")
    lens.mark_cells(["cell-a"], kind="edited", run_id=run_id)
    lens.resolve_annotation("ml-123", status="addressed", run_id=run_id)
    lens.agent_finished("Updated the chart filter.", run_id=run_id)
```

Use `lens.export_pair_result()` or `lens.export_pair_result_prompt()` to retrieve
the machine-readable result packet.

## Development

```sh
uv sync --dev
pnpm install
uv run marimo run workbench/demo.py --port 28889 --headless
pnpm run dev
```

Run the full local gate before handing off changes:

```sh
uv run ruff format
uv run ruff check
uv run ty check
uv run pytest
pnpm run fmt
pnpm run qa
npx -y react-doctor@latest . --verbose --diff
```
