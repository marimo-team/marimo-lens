# Getting started

Start a marimo notebook with **Lens**, create one visual request, and inspect what
your notebook agent receives.

```marimo-config
requires-python = ">=3.11"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

## Start a notebook

Open a notebook with marimo and Lens

```sh
uvx --with marimo-lens marimo edit --no-token notebook.py
```

We create an isolated environment for this notebook and configure `--no-token` to let an agent [pair](https://marimo.io/pair) with us on this notebook.

::: details Use an existing uv project

Add Lens to the project, then run marimo in that environment:

```sh
uv add marimo-lens
uv run marimo edit --no-token notebook.py
```

:::

## Make notebook results selectable

1. Render a result in the first cell

```python
import marimo as mo

revenue = {"January": 42, "February": 58, "March": 39}
rows = "\n".join(f"| {month} | {value} |" for month, value in revenue.items())
mo.md(f"| Month | Revenue |\n| --- | ---: |\n{rows}")
```

2. Mount Lens in the second cell

```python
from marimo_lens import Lens

lens = Lens()
lens
```

This creates a dock that appears at the bottom of your notebook.

## Create a selection

<div class="lens-doc-demo">

<div class="lens-doc-demo-steps" aria-label="Create a Lens request in four steps">
  <span><strong>1</strong> Press Select</span>
  <span><strong>2</strong> Click a value</span>
  <span><strong>3</strong> Add a note</span>
  <span><strong>4</strong> Review the request</span>
</div>

```python marimo output=false
from html import escape

import marimo as mo
from marimo_lens import Lens

get_starter_revision, set_starter_revision = mo.state(0)
```

<div class="lens-doc-demo-mount">

```python marimo
starter_lens = Lens()


def _sync_starter_revision(change):
    set_starter_revision(int(change["new"]["revision"]))


starter_lens.observe(_sync_starter_revision, names="_state")
starter_lens
```

</div>

<div class="lens-doc-demo-output lens-starter-output">

```python marimo
_starter_revenue = {
    "January": 42,
    "February": 58,
    "March": 39,
}
_starter_rows = "\n".join(
    f"| {_month} | {_value} |" for _month, _value in _starter_revenue.items()
)
mo.md(f"| Month | Revenue |\n| --- | ---: |\n{_starter_rows}")
```

</div>

<div class="lens-doc-demo-status">

```python marimo
_starter_revision = get_starter_revision()
_starter_context = starter_lens.context()
_starter_current = _starter_context.current
_starter_open_count = len(_starter_context.references.get("selections", []))

if _starter_current is None:
    _starter_state = "empty"
    _starter_title = "No request yet"
    _starter_body = (
        "Select a revenue value and add a note such as "
        '"Make these values easier to compare."'
    )
else:
    _starter_state = "ready"
    _starter_id = str(_starter_current.get("id", ""))
    _starter_label = escape(str(_starter_current.get("label", "Selection")))
    _starter_note = (
        escape(str(_starter_current.get("note", "")).strip()) or "No note added"
    )
    _starter_cell = escape(str(_starter_current["outputCellId"]))
    _starter_images = {str(_image.selection_id) for _image in _starter_context.images}
    _starter_snapshot = _starter_current.get("snapshot", {})
    _starter_image_status = (
        "Ready"
        if _starter_id in _starter_images
        else escape(
            str(_starter_snapshot.get("status", "pending")).replace("_", " ").title()
        )
    )
    _starter_title = f"{_starter_label} is ready for an agent"
    _starter_body = f"""
      <dl class="lens-doc-demo-context">
        <div><dt>Requested change</dt><dd>{_starter_note}</dd></div>
        <div><dt>Producing cell</dt><dd><code>{_starter_cell}</code></dd></div>
        <div><dt>Annotated image</dt><dd>{_starter_image_status}</dd></div>
        <div><dt>Open requests</dt><dd>{_starter_open_count}</dd></div>
      </dl>
    """

mo.Html(
    f"""
    <aside
      data-starter-demo-state="{escape(_starter_state)}"
      data-starter-demo-open-count="{_starter_open_count}"
      aria-live="polite"
    >
      <span class="lens-doc-demo-eyebrow">What the agent receives</span>
      <strong>{_starter_title}</strong>
      <div>{_starter_body}</div>
    </aside>
    """
)
```

</div>

</div>

You can create multiple selections to batch a request. Press **Select** again to add another point or region.

## Connect an agent

You can use any AI agent to work with this notebook including Claude Code, OpenCode or Codex.

[marimo pair](https://marimo.io/pair) is a skill that teaches your agent on how to work with marimo notebooks.
Follow the [instructions](./pair) to connect to this notebook and complete the first request.

The [overview section](./overview) explains the mechanism and feedback loop of Lens and the [Python reference](./api)
defines the methods to read a request, show the activity, complete it, and return a result.
