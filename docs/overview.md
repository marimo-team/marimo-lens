---
title: Overview
description: How Lens connects visual feedback to notebook code and returns agent work for review.
---

# Overview

People review notebook results as charts and tables. Notebook agents revise the
code that produces them. When a user asks an agent to "change this," the marked
result and requested change need to stay connected to the computation behind
it.

Lens provides that connection in a live [marimo](https://marimo.io/) notebook.
A user marks a point or region and can add a note. Lens gives the notebook
agent the producing cell, related notebook context, and an annotated image.
The agent can then revise and check the notebook while Lens returns its work
for review.

```marimo-config
requires-python = ">=3.11"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

```python marimo output=false
from html import escape

import marimo as mo
from marimo_lens import Lens

get_overview_revision, set_overview_revision = mo.state(0)
get_overview_action, set_overview_action = mo.state(None)

overview_activity_button = mo.ui.run_button(
    label=(
        "<span style='display:block;padding:0.3rem 0.75rem;"
        "line-height:1.25rem'>Show activity</span>"
    ),
)
overview_complete_button = mo.ui.run_button(
    label=(
        "<span style='display:block;padding:0.3rem 0.75rem;"
        "line-height:1.25rem'>Return for review</span>"
    ),
)
```

## From visual feedback to a reviewed result

<ol class="lens-context-flow" aria-label="Lens human-agent collaboration loop">
  <li>
    <strong>Mark the result</strong>
    <span>The user selects a point or region and describes what should change.</span>
  </li>
  <li>
    <strong>Ground the request</strong>
    <span>Lens links the feedback to its producing cell, related context, and annotated image.</span>
  </li>
  <li>
    <strong>Revise and check</strong>
    <span>The agent changes notebook code and checks the updated output.</span>
  </li>
  <li>
    <strong>Review or reopen</strong>
    <span>Lens brings the result into view and keeps the request available for another pass.</span>
  </li>
</ol>

## Grounding the request

The selection says where the user is looking. Its optional note says what the
user noticed or wants changed. Lens keeps both attached to the rendered output
cell as marimo rerenders the notebook.

The agent receives three connected forms of context:

- The request, including its point or region and optional note.
- The producing cell, related upstream cells, and relevant control values.
- An annotated image that preserves the user’s visual focus.

Press **Select**, mark one bar, and add a note such as "Make this blue." The
context panel reads the same Lens state available to a notebook agent.

<div class="lens-doc-demo">

<div class="lens-doc-demo-mount">

```python marimo
overview_lens = Lens()


def _sync_overview_revision(change):
    set_overview_revision(int(change["new"]["revision"]))


overview_lens.observe(
    _sync_overview_revision,
    names="_state",
)
overview_lens
```

</div>

<div class="lens-doc-demo-output">

```python marimo
_overview_values = [
    ("Mon", 34),
    ("Tue", 48),
    ("Wed", 63),
    ("Thu", 52),
]
_overview_rows = "".join(
    f"""
    <div
      class="lens-selection-demo-row"
      role="listitem"
      aria-label="{_day}, {_value} new users"
    >
      <span>{_day}</span>
      <span class="lens-selection-demo-track" aria-hidden="true">
        <span
          data-overview-demo-bar
          style="width:{_value / 70 * 100:.1f}%"
        ></span>
      </span>
      <span>{_value}</span>
    </div>
    """
    for _day, _value in _overview_values
)
mo.Html(
    f"""
    <figure
      class="lens-selection-demo-chart"
      aria-labelledby="lens-overview-demo-title"
    >
      <figcaption>
        <span>
          <strong id="lens-overview-demo-title">Weekly sign-ups</strong>
          <small>New users</small>
        </span>
        <small>Mon–Thu</small>
      </figcaption>
      <div class="lens-selection-demo-rows" role="list">
        {_overview_rows}
      </div>
    </figure>
    """
)
```

</div>

<div class="lens-doc-demo-status">

```python marimo
_overview_revision = get_overview_revision()
_overview_context = overview_lens.context()
_overview_current = _overview_context.current

if _overview_current is None:
    _overview_state = "empty"
    _overview_title = "Mark the chart"
    _overview_body = "Press <strong>Select</strong>, mark one bar, and add a note."
else:
    _overview_state = "ready"
    _overview_id = str(_overview_current.get("id", ""))
    _overview_label = escape(str(_overview_current.get("label", "Selection")))
    _overview_note = (
        escape(str(_overview_current.get("note", "")).strip()) or "No note added"
    )
    _overview_cell = escape(str(_overview_current["outputCellId"]))
    _overview_context_status = (
        "Ready" if _overview_current.get("cellStatus") == "available" else "Unavailable"
    )
    _overview_images = {str(_image.selection_id) for _image in _overview_context.images}
    _overview_snapshot = _overview_current.get("snapshot", {})
    _overview_image_status = (
        "Ready"
        if _overview_id in _overview_images
        else escape(
            str(_overview_snapshot.get("status", "pending")).replace("_", " ").title()
        )
    )
    _overview_title = f"{_overview_label} is connected"
    _overview_body = f"""
      <dl class="lens-doc-demo-context">
        <div><dt>Requested change</dt><dd>{_overview_note}</dd></div>
        <div><dt>Producing cell</dt><dd><code>{_overview_cell}</code></dd></div>
        <div><dt>Notebook context</dt><dd>{_overview_context_status}</dd></div>
        <div><dt>Annotated image</dt><dd>{_overview_image_status}</dd></div>
      </dl>
    """

mo.Html(
    f"""
    <aside
      data-overview-demo-state="{escape(_overview_state)}"
      data-overview-demo-revision="{_overview_revision}"
      aria-live="polite"
    >
      <span class="lens-doc-demo-eyebrow">What the agent receives</span>
      <strong>{_overview_title}</strong>
      <div>{_overview_body}</div>
    </aside>
    """
)
```

</div>

</div>

The agent can begin with notebook structure and inspect the image when visual
detail affects the task. Annotated image bytes remain separate from the text
context.

## Agent feedback in the notebook

The same Lens instance carries the agent’s response back to the user:

| Method       | Visible role                                                     |
| ------------ | ---------------------------------------------------------------- |
| `context()`  | Reads the current selections and related notebook context        |
| `activity()` | Marks the cell the agent is changing or checking                 |
| `resolve()`  | Moves completed selections into history with an optional summary |
| `reveal()`   | Brings one verified or explanatory result into view              |

Continue with the selection from the chart. These controls call the same
feedback methods a notebook agent uses.

```python marimo
mo.md(
    f"""
    <div
      class="lens-api-demo-actions"
      role="group"
      aria-label="Lens feedback controls"
    >
      <span class="lens-api-demo-button">{overview_activity_button}</span>
      <span class="lens-api-demo-button">{overview_complete_button}</span>
    </div>
    """
)
```

```python marimo output=false
if overview_activity_button.value:
    _overview_activity_context = overview_lens.context()
    _overview_activity_current = _overview_activity_context.current
    if (
        _overview_activity_current is None
        or _overview_activity_current.get("cellStatus") != "available"
    ):
        set_overview_action(
            {
                "kind": "missing",
                "revision": _overview_activity_context.revision,
            }
        )
    else:
        _overview_activity_cell = str(_overview_activity_current["outputCellId"])
        overview_lens.activity(
            _overview_activity_cell,
            label="Working on it…",
            message="Checking the selected result",
        )
        set_overview_action(
            {
                "kind": "activity",
                "revision": _overview_activity_context.revision,
                "cellId": _overview_activity_cell,
            }
        )
```

```python marimo output=false
if overview_complete_button.value:
    _overview_complete_context = overview_lens.context()
    _overview_complete_current = _overview_complete_context.current
    if (
        _overview_complete_current is None
        or _overview_complete_current.get("cellStatus") != "available"
    ):
        set_overview_action(
            {
                "kind": "missing",
                "revision": _overview_complete_context.revision,
            }
        )
    else:
        _overview_complete_id = str(_overview_complete_current["id"])
        _overview_complete_cell = str(_overview_complete_current["outputCellId"])
        _overview_complete_summary = "Returned the selected result for review."
        overview_lens.reveal(
            _overview_complete_cell,
            duration_ms=8_000,
            label="Selected result",
            message=_overview_complete_summary,
        )
        _overview_complete_revision = overview_lens.resolve(
            [_overview_complete_id],
            expected_revision=_overview_complete_context.revision,
            summary=_overview_complete_summary,
        )
        set_overview_action(
            {
                "kind": "complete",
                "revision": _overview_complete_revision,
            }
        )
```

<div class="lens-doc-demo-status">

```python marimo
_overview_feedback_revision = get_overview_revision()
_overview_feedback_context = overview_lens.context()
_overview_feedback_action = get_overview_action()
if (
    _overview_feedback_action is not None
    and int(_overview_feedback_action["revision"])
    != _overview_feedback_context.revision
):
    _overview_feedback_action = None

_overview_feedback_current = _overview_feedback_context.current
_overview_feedback_kind = (
    str(_overview_feedback_action["kind"])
    if _overview_feedback_action is not None
    else ("ready" if _overview_feedback_current is not None else "empty")
)

if _overview_feedback_kind == "empty":
    _overview_feedback_title = "Mark the chart first"
    _overview_feedback_body = "Open a selection before returning agent feedback."
elif _overview_feedback_kind == "ready":
    _overview_feedback_title = "The request is ready"
    _overview_feedback_body = (
        "Show where the agent is working or return the result for review."
    )
elif _overview_feedback_kind == "missing":
    _overview_feedback_title = "Open a selection first"
    _overview_feedback_body = "Mark the chart before calling a feedback method."
elif _overview_feedback_kind == "activity":
    _overview_feedback_cell = escape(str(_overview_feedback_action["cellId"]))
    _overview_feedback_title = "Working on it…"
    _overview_feedback_body = (
        f"activity() marked cell <code>{_overview_feedback_cell}</code>."
    )
else:
    _overview_feedback_title = "Ready for review"
    _overview_feedback_body = (
        "resolve() moved the request into history. "
        "reveal() returned the chart to view. "
        "Reopen the request for another pass."
    )

mo.Html(
    f"""
    <aside
      data-overview-feedback-state="{escape(_overview_feedback_kind)}"
      data-overview-feedback-revision="{_overview_feedback_revision}"
      aria-live="polite"
    >
      <span class="lens-doc-demo-eyebrow">Agent feedback</span>
      <strong>{_overview_feedback_title}</strong>
      <div>{_overview_feedback_body}</div>
    </aside>
    """
)
```

</div>

Completed selections remain available in history. Reopening one restores the
request for another pass and starts a fresh annotated image capture.

## Connect a notebook agent

Any notebook agent that can call the Lens Python API in a marimo notebook can
use this loop. [marimo Pair](https://marimo.io/pair) provides a ready-made
workflow that reads the current request, reports activity, revises and checks
the notebook, then reveals the result and resolves the addressed selection.

Follow [Use with marimo Pair](./pair) for that workflow. The
[Python API reference](./api) defines the methods an agent integration calls.

## Browser and Python responsibilities

Lens uses [anywidget](https://anywidget.dev/) to connect its browser interface
to a Python model in the notebook kernel.

| Browser                                                      | Python                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Finds rendered outputs and handles pointer or keyboard input | Stores open selections and completed history items            |
| Positions markers, the selection sheet, and agent feedback   | Reads the live marimo runtime and builds `LensContext`        |
| Captures annotated images of selected outputs                | Validates selection changes, activity, reveal, and resolution |

The two sides exchange compact selection records and explicit commands through
the widget connection. PNG bytes travel separately from ordinary selection
state.

Start with [Getting started](./getting-started) to add Lens to a notebook and
create one request. The [Selections guide](./selections) covers point and
region gestures, multiple requests, history, and reopening.
