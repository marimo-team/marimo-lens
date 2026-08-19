---
title: Getting started
description: Mount Lens in a marimo notebook and create a visual request for an agent.
---

# Getting started

Mount Lens in a marimo notebook, create one visual request, and inspect the
context available to a code-mode agent.

```marimo-config
requires-python = ">=3.10"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

## Start a notebook

Open a local notebook with Lens installed:

```sh
uvx --with marimo-lens marimo edit notebook.py
```

This command creates an isolated environment for marimo and Lens.

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
    _starter_cell = escape(str(_starter_current["outputCellId"]))
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
        <div><dt>Annotated image</dt><dd>{_starter_image_status}</dd></div>
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

Press **Select** again when the request refers to another point or region. An
agent can resolve those selections together after one verified change.

## Connect an agent

The Python package carries its matching Lens Agent Skill. An agent that already
executes code in the live notebook kernel can continue directly with Lens.

To give the agent live kernel execution, install
[marimo Pair](https://github.com/marimo-team/marimo-pair/tree/main/skills/marimo-pair):

```console
npx skills add https://github.com/marimo-team/marimo-pair --skill marimo-pair
```

Use `$marimo-pair` to connect to or start the notebook, then resume
`$marimo-lens`. Inside code mode, inspect the installed Lens instructions from
the notebook environment:

```python
import marimo_lens.agent as lens_agent

print(lens_agent.agent_skill() / "SKILL.md")
```

Then ask the agent to resolve the current request:

```text
Resolve my Lens request.
```

The [Agent workflow](./agents) covers direct code-mode use and the Pair setup
path, then shows how the agent edits and verifies cells and returns the result
for review. The [Overview](./overview) explains the collaboration loop. The
[Python API reference](./api) defines each handoff method.
