---
title: Getting started
description: Install Lens, connect a notebook agent, make a first selection, and review the first change.
---

# Getting started

This page takes you from an empty notebook to a first reviewed change. You need
Python 3.10 through 3.14, [uv](https://docs.astral.sh/uv/), and an agent that
can run Python in the live marimo kernel. [marimo Pair](https://marimo.io/pair)
and the editor's **Code Mode (beta)** sidebar both qualify.

## Open the sample notebook

Save this file as `notebook.py`. Its inline script metadata declares Lens and
marimo with its recommended extras, which include Altair for the chart and the
packages marimo's AI assistant needs, so uv installs everything for you. To
skip the local setup, open the same notebook in molab:

[![Open in molab](https://molab.marimo.io/molab-shield.svg)](https://molab.marimo.io/notebooks/nb_MimGXwYTcvjfb1sdUdaTyn)

::: details notebook.py

```python
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "marimo[recommended]>=0.24.0",
#     "marimo-lens",
# ]
# ///

import marimo

__generated_with = "0.24.2"
app = marimo.App()


@app.cell
def _():
    import altair as alt
    import marimo as mo
    from marimo_lens import Lens

    return Lens, alt, mo


@app.cell
def _(mo):
    revenue = [
        {"month": "January", "revenue": 42},
        {"month": "February", "revenue": 58},
        {"month": "March", "revenue": 39},
    ]
    mo.ui.table(revenue, selection=None)
    return (revenue,)


@app.cell
def _(alt, mo, revenue):
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
    return


@app.cell
def _(mo, revenue):
    peak = max(revenue, key=lambda row: row["revenue"])
    mo.md(
        f"**{peak['month']} leads with {peak['revenue']} thousand dollars.** "
        "These are revenue totals, not profit."
    )
    return


@app.cell
def _(Lens):
    lens = Lens()
    lens
    return


if __name__ == "__main__":
    app.run()
```

:::

Start it in a sandbox that resolves those dependencies:

```sh
uvx marimo edit notebook.py --sandbox
```

The editor opens in your browser with three outputs, the data, the chart, and
the conclusion, and the Lens dock at the bottom of the page. The three outputs
give your agent a route from data to chart to conclusion.

::: details Use an existing uv project

Add the dependencies to the project instead of using a sandbox, then open the
same file:

```sh
uv add marimo-lens altair
uv run marimo edit notebook.py
```

For an already-running notebook, ask your connected agent to install Lens in
its active Python environment and add the dock. Keep using the same session.

:::

## Connect your agent

You have two ways to bring an agent into the notebook. Pick one:

- **Use marimo's built-in AI sidebar.** Open the AI panel from the left
  sidebar, choose **Code Mode (beta)** in the mode menu, and pick a configured
  model. This needs a provider set up in marimo's AI settings, and the sample
  notebook's `marimo[recommended]` dependency already includes everything code
  mode needs.
- **Use your own agent.** If you would rather work with an agent you already
  use, such as Claude Code or Codex, open **Settings → Pair with an agent**,
  choose it, and follow the connection instructions. If you already use
  [marimo Pair](https://marimo.io/pair), keep that connection.

Either way, check the connection by asking:

> Which notebook are you connected to?

Continue when it identifies `notebook.py` and can inspect its live cells.

## Add Lens

The sample notebook mounts Lens in its last cell. In a notebook of your own
that shows no dock, tell your connected agent:

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

## Ask for a walkthrough

Ask your agent:

> Use Lens to walk me through this notebook, from the inputs to the main result.

The agent reads the relevant cells and values, then shows a **Trail**: an
ordered explanation attached to the notebook's outputs. Use **Next** and
**Previous** to follow it at your own pace, or dismiss it when finished. A
walkthrough explains the existing notebook and needs no selection.

<llm-exclude>

<div class="lens-video-frame">
<video aria-label="An agent in marimo's code-mode sidebar shows a Lens Trail that steps through the revenue table, the chart, and the conclusion" controls muted playsinline poster="./assets/overview/lens-walkthrough-poster.jpg" preload="metadata" src="./assets/overview/lens-walkthrough.mp4" width="3840" height="2080"></video>
</div>

</llm-exclude>

## Address a selection

Press **Select** in the dock, click a point or drag a region on an output, and
add a note. For the revenue chart, click February and write:

> Make this bar orange and keep the other bars green

Then send this in the connected agent chat:

> Address current Lens selection

Saving a note keeps the selection in **Open** until an agent reads it. The chat
request starts the work. The agent loads its installed Lens instructions,
checks the selected output and its producing code, makes the change, and
verifies it.

Review the result when the agent brings it into view. In the sample, February
should be orange while January and March remain green. The verified request
moves to **History** with a summary. Reopen it to refine the result. Requests
the agent cannot verify stay open with an explanation.

<llm-exclude>

<div class="lens-video-frame">
<video aria-label="A February bar is selected with a note, the agent recolors it orange, and Lens brings the updated chart back for review" controls muted playsinline poster="./assets/overview/lens-address-poster.jpg" preload="metadata" src="./assets/overview/lens-address.mp4" width="3840" height="2088"></video>
</div>

</llm-exclude>

::: details The agent cannot find Lens or my selection

Confirm that it is connected to this notebook and that the dock is mounted.
Ask the agent to check that Lens is installed in that kernel, read
`help(marimo_lens.agent)`, and add the dock if it is missing.

A terminal can read the packaged briefing with
`uvx --with marimo-lens agent-plugins read marimo-lens`. That command reads an
isolated installation. Working with your notebook requires the live connection.
[Agent integration](./agents) covers discovery and resource access.

:::

## Try it here

::: info About this demo

This demo runs in your browser with scripted actions and no language model. It
shows the Lens interactions and the tools a connected agent uses to explain a
notebook and return results for review.

:::

Press **Show a walkthrough** to visit the data, chart, and conclusion. The
three steps explain which month leads and what the numbers measure. Use
**Next**, **Previous**, and dismiss to control the Trail.

You can also press **Select**, mark a bar, and add a note to inspect the
captured request. In your notebook, the agent chooses its actions from your
request, code, and live results.

<llm-only>

The demo shows three monthly revenue values: January 42, February 58, and
March 39, in USD thousands. Its Trail visits the data table, compares the bars,
then explains that February has the highest revenue and that revenue is not
profit. The reader controls the steps. Selections and History remain unchanged
by a walkthrough.

</llm-only>

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

<llm-exclude>

<div class="lens-doc-demo">

```python marimo output=false
from html import escape

import altair as alt
import marimo as mo
from marimo_lens import Lens

get_starter_revision, set_starter_revision = mo.state(0)
starter_walkthrough = mo.ui.run_button(
    label=(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" '
        'height="16" fill="none" stroke="currentColor" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'
        "</svg>Show a walkthrough"
    ),
)
```

<div class="lens-demo-button">

```python marimo
starter_walkthrough
```

</div>

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

```python marimo
_starter_feedback = None
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
    _targets = {
        definition: cell.id for cell in _runtime.cells for definition in cell.defs
    }
    _missing = [variable for variable, _, _ in _route if variable not in _targets]
    if _missing:
        _starter_feedback = mo.callout(
            "Cannot show the walkthrough: missing demo cells for "
            + ", ".join(_missing)
            + ". Reload the demo and try again.",
            kind="warn",
        )
    else:
        _steps = [
            {"target": _targets[variable], "label": label, "message": message}
            for variable, label, message in _route
        ]
        starter_lens.reveal(_steps, duration_ms=None)
_starter_feedback
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

## Next steps

- [Selections](./selections) covers gestures, notes, images, History, and reopening.
- [How Lens works](./how-lens-works) explains what your agent receives and how it returns results.
- [Custom targets](./custom-targets) makes cards, dashboards, and custom views selectable.
