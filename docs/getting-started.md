---
title: Getting started
description: Mount Lens in a marimo notebook and create the first selection.
---

# Getting started

Mount Lens in [marimo](https://marimo.io/), a reactive Python notebook, create one selection,
and inspect the context available to a code-mode agent.

## Prerequisites

Use Python 3.10 through 3.14 and [uv](https://docs.astral.sh/uv/). The first
`uvx` run downloads marimo and Lens. See [Compatibility](./compatibility) when
adding Lens to an existing environment.

<llm-exclude>

```marimo-config
requires-python = ">=3.10,<3.15"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

</llm-exclude>

## Start a notebook

Open a local notebook with Lens installed:

```sh
uvx --with marimo-lens marimo edit notebook.py
```

This command creates an isolated environment for marimo and Lens, then opens
the notebook editor.

::: details Use an existing uv project

Add Lens to the project, then run marimo in that environment:

```sh
uv add marimo-lens
uv run marimo edit notebook.py
```

:::

## Mount Lens

Render a result in one cell:

```python
import marimo as mo

revenue = {"January": 42, "February": 58, "March": 39}
rows = [f"| {month} | {value} |" for month, value in revenue.items()]
mo.md(
    "\n".join(
        [
            "| Month | Revenue |",
            "| --- | ---: |",
            *rows,
        ]
    )
)
```

Mount Lens in another cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep this cell mounted. Lens adds its dock to the bottom of the notebook and
makes rendered output cells selectable.

## Create a selection

Press **Select**, click one rendered location, and add a note such as “Make
these values easier to compare.” The new `S<n>` selection appears in **Open**
with its notebook target and producing cell.

<llm-exclude>

<div class="lens-doc-demo">

<div class="lens-doc-demo-steps" aria-label="Create a Lens request in four steps">
  <span><strong>1</strong> Press <strong>Select</strong></span>
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
_starter_rows = [
    f"| {_month} | {_value} |" for _month, _value in _starter_revenue.items()
]
mo.md(
    "\n".join(
        [
            "| Month | Revenue |",
            "| --- | ---: |",
            *_starter_rows,
        ]
    )
)
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
    _starter_cell = escape(str(_starter_current["cells"][0]["id"]))
    _starter_snapshot = _starter_current.get("snapshot", {})
    _starter_image_status = (
        "Ready"
        if _starter_id in _starter_context.images
        else escape(
            str(_starter_snapshot.get("status", "pending")).replace("_", " ").title()
        )
    )
    _starter_title = f"{_starter_label} is ready for an agent"
    _starter_body = f"""
      <dl class="lens-doc-demo-context">
        <div><dt>Requested change</dt><dd>{_starter_note}</dd></div>
        <div><dt>Producing cell</dt><dd><code>{_starter_cell}</code></dd></div>
        <div><dt>Selection image</dt><dd>{_starter_image_status}</dd></div>
        <div><dt>Open selections</dt><dd>{_starter_open_count}</dd></div>
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

</llm-exclude>

Press **Select** again when the request refers to another point or region. An
agent can resolve those selections together after one verified change.

## Inspect the result

Open **Selections** from the Lens dock. The new selection appears in **Open**
with a stable `S<n>` label, its note, target, point or region kind, and image
status. Select the image action when capture succeeded to inspect the marked
selection image.

## Next: connect an agent

[Connect an agent](./agents) gives a notebook agent live code-mode access,
reads the current Lens context, verifies a change, reveals the result, and
resolves the selection. Read [How Lens works](./how-lens-works) first when you
want the complete collaboration model. The [Selections guide](./selections)
covers gestures, notes, image status, deletion, History, and reopening.

To name HTML output or select individual cards within it, try
[Custom labels and metadata](./custom-metadata). The guide includes a complete
`mo.Html` example and an editable preview.
