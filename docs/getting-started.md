---
title: Getting started
description: Add Lens to your notebook, follow a guided Trail, or ask an agent to address a selection.
---

# Getting started

::: info About the demos

These demos run in your browser with scripted actions and no language model.
They show Lens's interactions and the tools a connected AI agent can use to
explain your live notebook, work on selections, and return results for review.

:::

<llm-exclude>

```marimo-config
requires-python = ">=3.10,<3.15"
dependencies = [
    "altair",
    "marimo",
    "marimo-lens",
]
```

</llm-exclude>

## Connect your agent

Use Python 3.10 through 3.14 and [uv](https://docs.astral.sh/uv/).
Start a notebook with Lens and the chart library used by the sample:

```sh
uvx --with marimo-lens --with altair marimo edit notebook.py
```

In the editor, open **Settings → Pair with an agent**, choose your agent, and
follow the connection instructions. Ask it:

> Which notebook are you connected to?

Continue when it identifies `notebook.py` and can inspect its live cells.
If you already use [marimo Pair](https://marimo.io/pair), keep that connection.
You can also use the built-in AI sidebar with a configured provider and
**Code Mode (beta)** selected.

::: details Use an existing uv project

Install Lens in the notebook's Python environment. Altair is needed for the
sample chart:

```sh
uv add marimo-lens altair
uv run marimo edit notebook.py
```

For an already-running notebook, ask your connected agent to install Lens in
its active Python environment and add the dock. Keep using the same session.

:::

::: details Sample notebook: monthly revenue

Run each block in a separate notebook cell. The first displays the data:

```python
import altair as alt
import marimo as mo

revenue = [
    {"month": "January", "revenue": 42},
    {"month": "February", "revenue": 58},
    {"month": "March", "revenue": 39},
]
mo.ui.table(revenue, selection=None)
```

The second draws the chart:

```python
chart = (
    alt.Chart(alt.Data(values=revenue))
    .mark_bar(color="#1D7363")
    .encode(
        x=alt.X("month:N", sort=None, title="Month"),
        y=alt.Y("revenue:Q", title="Revenue (USD thousands)"),
        tooltip=["month:N", "revenue:Q"],
    )
    .properties(title="Monthly revenue", width="container", height=220)
)
mo.ui.altair_chart(chart)
```

The third states the result:

```python
peak = max(revenue, key=lambda row: row["revenue"])
mo.md(
    f"**{peak['month']} leads with {peak['revenue']} thousand dollars.** "
    "These are revenue totals, not profit."
)
```

These three outputs give your agent a route from data to chart to conclusion.

:::

## Add Lens to your notebook

If the dock is missing, tell your connected agent:

> Add Lens to this notebook.

The agent reuses an existing Lens or adds and runs a Lens cell. Continue when
you can see the dock.

::: details Add it yourself

Run this in a notebook cell and keep it mounted:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Lens is a separate Python package with its own releases. Marimo 0.24.2 needs
this explicit mount or one supplied by a host integration. If your notebook
already shows a Lens dock, reuse it. See [mounting compatibility](./compatibility#mounting-lens).

:::

## Explain the notebook

Ask your agent:

> Use Lens to walk me through this notebook, from the inputs to the main result.

The agent reads the relevant cells and values, then shows a **Trail**: an
ordered explanation attached to the notebook's outputs. Use **Next** and
**Previous** to follow it at your own pace, or dismiss it when finished.

You can ask a narrower question, such as:

> Use a Lens Trail to explain how the revenue chart supports the conclusion.

A walkthrough explains the existing notebook and works with no selections.

## Address a selection

Press **Select** in the dock, click a point or drag a region on an output, and
add a note. For the revenue chart, click February and write:

> Make this bar orange and keep the other bars green.

Then send this in the connected agent chat:

> Use Lens to address my current selection.

Saving a Lens note keeps it in **Open** until an agent reads it. The chat
request starts the work. The agent loads its installed Lens instructions,
checks the selected output and producing code, makes the requested change,
and verifies it.

Review the result when the agent brings it into view. In the sample, February
should be orange while January and March remain green. The verified request
moves to **History** with a summary. Reopen it to refine the result. Requests
the agent cannot verify should remain open with an explanation.

For several requests, ask:

> Use Lens to address all open selections.

::: details The agent cannot find Lens or my selection

Confirm that it is connected to this notebook and that the dock is mounted.
Ask the agent to check that Lens is installed in that kernel, read
`help(marimo_lens.agent)`, and add the dock if it is missing.

A terminal can read the packaged briefing with
`uvx --with marimo-lens agent-plugins read marimo-lens`. That command reads an
isolated installation. Working with your notebook requires the live connection.
[Agent integration](./agents) covers discovery and resource access.

:::

## Try a Trail

Press **Show a walkthrough** to visit the data, chart, and conclusion. The
three steps explain which month leads and what the numbers measure. Use
**Next**, **Previous**, and dismiss to control the Trail.

You can also press **Select**, mark a bar, and add a note to inspect the captured
request. In your notebook, the agent chooses its actions from your request,
code, and live results.

<llm-only>

The demo shows three monthly revenue values: January 42, February 58, and
March 39, in USD thousands. Its Trail visits the data table, compares the bars,
then explains that February has the highest revenue and that revenue is not
profit. The reader controls the steps. Selections and History remain unchanged
by a walkthrough.

</llm-only>

<llm-exclude>

<div class="lens-doc-demo">

```python marimo output=false
from html import escape

import altair as alt
import marimo as mo
from marimo_lens import Lens

get_starter_revision, set_starter_revision = mo.state(0)
starter_walkthrough = mo.ui.run_button(label="Show a walkthrough")
```

```python marimo
starter_walkthrough
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
starter_revenue = [
    {"month": "January", "revenue": 42},
    {"month": "February", "revenue": 58},
    {"month": "March", "revenue": 39},
]
mo.ui.table(starter_revenue, selection=None)
```

```python marimo
starter_chart = (
    alt.Chart(alt.Data(values=starter_revenue))
    .mark_bar(color="#1D7363")
    .encode(
        x=alt.X("month:N", sort=None, title="Month"),
        y=alt.Y("revenue:Q", title="Revenue (USD thousands)"),
        tooltip=["month:N", "revenue:Q"],
    )
    .properties(title="Monthly revenue", width="container", height=220)
)
mo.ui.altair_chart(starter_chart)
```

```python marimo
starter_peak = max(starter_revenue, key=lambda row: row["revenue"])
mo.md(
    f"**{starter_peak['month']} leads with "
    f"{starter_peak['revenue']} thousand dollars.** "
    "These are revenue totals, not profit."
)
```

</div>

```python marimo output=false
if starter_walkthrough.value:
    from marimo_lens._marimo_runtime import (
        collect_runtime_snapshot as _collect_runtime_snapshot,
    )

    # The docs demo runs in notebook cells rather than an agent scratchpad.
    _runtime = _collect_runtime_snapshot()
    if not _runtime.available:
        raise RuntimeError(_runtime.reason)
    _route = [
        (
            "starter_revenue",
            "Three months of revenue",
            f"Compare {len(starter_revenue)} monthly totals, measured in USD thousands.",
        ),
        (
            "starter_chart",
            "Compare the bars",
            f"{starter_peak['month']} is the tallest bar at {starter_peak['revenue']}.",
        ),
        (
            "starter_peak",
            "What the result means",
            f"{starter_peak['month']} leads on revenue. Costs are absent, so this does not tell us profit.",
        ),
    ]
    _steps = [
        {
            "target": next(cell.id for cell in _runtime.cells if variable in cell.defs),
            "label": label,
            "message": message,
        }
        for variable, label, message in _route
    ]
    starter_lens.reveal(_steps, duration_ms=None)
```

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
        "Select a bar and add a note such as "
        '"Make this bar orange and keep the other bars green."'
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

Read [Selections](./selections) for gestures, History, and reopening, or
[Custom labels and metadata](./custom-metadata) for selectable HTML regions.
