---
title: Overview
description: How Lens grounds human feedback in the marimo graph and returns agent work for review.
---

# Overview

People direct analytical work by pointing to visible evidence and explaining
what deserves attention. Notebook agents act through code. Lens keeps these
two views connected to the same rendered output, so the agent can make a
grounded change and the person can judge the result in context.

A point or region identifies the visual evidence. Its output cell identifies
the computation. Lens follows the live marimo dependency graph upstream from
that cell and returns a bounded closure of the code, controls, and values that
produced the result. The agent works from that computational grounding, then
brings verified evidence back into the notebook for review.

::: tip What this means for you

Lens allows you to keep referring to outputs as “this” while giving your agents
the exact computational context they need to understand what “this” is.

:::

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

_overview_api_icons = {
    "context": (
        "<circle cx='12' cy='12' r='6'></circle><path "
        "d='M12 2v4M12 18v4M2 12h4M18 12h4'></path>"
    ),
    "start": "<path d='M3 12h4l2-5 4 10 2-5h6'></path>",
    "stop": "<rect x='7' y='7' width='10' height='10' rx='1'></rect>",
    "reveal": (
        "<path d='M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z'></path>"
        "<circle cx='12' cy='12' r='2.5'></circle>"
    ),
    "resolve": (
        "<circle cx='12' cy='12' r='9'></circle><path d='m8 12 2.5 2.5L16.5 9'></path>"
    ),
}


def _overview_api_label(icon: str, method: str, description: str) -> str:
    return (
        "<style>button[data-testid='marimo-plugin-button']{height:4.5rem;"
        "padding:0;text-align:left}button[data-testid='marimo-plugin-button'] "
        ".paragraph:not(:empty){display:block;width:100%;height:100%}</style>"
        "<span style='display:grid;grid-template-columns:1.5rem minmax(0,1fr);"
        "align-items:start;gap:0.65rem;box-sizing:border-box;width:100%;"
        "height:100%;padding:0.625rem 0.75rem;text-align:left;"
        "white-space:normal'>"
        "<span aria-hidden='true' style='display:inline-flex;align-items:center;"
        "justify-content:center;width:1.5rem;height:1.5rem;border:1px solid "
        "color-mix(in srgb,var(--marimo-island-accent,#0880ea) 42%,"
        "var(--marimo-island-border,#e2e8f0));border-radius:0.3rem;"
        "color:var(--marimo-island-accent,#0880ea)'>"
        "<svg viewBox='0 0 24 24' width='15' height='15' fill='none' "
        "stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' "
        f"stroke-width='1.8'>{icon}</svg></span>"
        "<span style='display:grid;align-content:start;gap:0.2rem;min-width:0'>"
        "<code style='padding:0;background:transparent;color:inherit;"
        f"font-size:0.75rem;line-height:1.2;white-space:nowrap'>{method}</code>"
        "<span style='color:var(--marimo-island-muted-foreground,#64748b);"
        f"font-size:0.75rem;line-height:1.3'>{description}</span>"
        "</span></span>"
    )


overview_context_button = mo.ui.run_button(
    label=_overview_api_label(
        _overview_api_icons["context"],
        "context()",
        "Read the request and graph context.",
    ),
    tooltip="Call context()",
    full_width=True,
)
overview_start_button = mo.ui.run_button(
    label=_overview_api_label(
        _overview_api_icons["start"],
        "start_activity()",
        "Mark the current work cell.",
    ),
    tooltip="Call start_activity()",
    full_width=True,
)
overview_stop_button = mo.ui.run_button(
    label=_overview_api_label(
        _overview_api_icons["stop"],
        "stop_activity()",
        "Clear activity after verification.",
    ),
    tooltip="Call stop_activity()",
    full_width=True,
)
overview_reveal_button = mo.ui.run_button(
    label=_overview_api_label(
        _overview_api_icons["reveal"],
        "reveal()",
        "Bring verified evidence into view.",
    ),
    tooltip="Call reveal()",
    full_width=True,
)
overview_resolve_button = mo.ui.run_button(
    label=_overview_api_label(
        _overview_api_icons["resolve"],
        "resolve()",
        "Move the request to History.",
    ),
    tooltip="Call resolve()",
    full_width=True,
)
```

## How Lens works

<ol class="lens-context-flow" aria-label="Lens human-agent collaboration loop">
  <li>
    <strong>Mark the result</strong>
    <span>The person selects evidence and describes what should change.</span>
  </li>
  <li>
    <strong>Ground the request</strong>
    <span>Lens connects the mark to its producing cell and graph context.</span>
  </li>
  <li>
    <strong>Revise and verify</strong>
    <span>The agent changes notebook code and checks the affected result.</span>
  </li>
  <li>
    <strong>Review or reopen</strong>
    <span>Lens returns the result and preserves the request for another pass.</span>
  </li>
</ol>

## Try the collaboration loop

Press **Select**, mark one bar, and add a note such as "Make this blue." The
panel reads the same Lens state available to a code-mode agent. Click the API
cards in order to send activity and review feedback back to the notebook.

<div class="lens-doc-demo lens-overview-demo">

<div class="lens-doc-demo-steps" aria-label="Try the Lens collaboration loop">
  <span><strong>1</strong> Press <strong>Select</strong></span>
  <span><strong>2</strong> Mark a bar</span>
  <span><strong>3</strong> Try the API cards</span>
  <span><strong>4</strong> Watch the notebook respond</span>
</div>

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

```python marimo
mo.md(
    f"""
    <div
      class="lens-agent-api-controls"
      role="group"
      aria-label="Try the Lens agent API"
    >
      <span class="lens-agent-api-card">{overview_context_button}</span>
      <span class="lens-agent-api-card">{overview_start_button}</span>
      <span class="lens-agent-api-card">{overview_stop_button}</span>
      <span class="lens-agent-api-card">{overview_reveal_button}</span>
      <span class="lens-agent-api-card lens-agent-api-card-resolve">
        {overview_resolve_button}
      </span>
    </div>
    """
)
```

```python marimo output=false
_overview_method = next(
    (
        _method
        for _method, _button in (
            ("context", overview_context_button),
            ("start_activity", overview_start_button),
            ("stop_activity", overview_stop_button),
            ("reveal", overview_reveal_button),
            ("resolve", overview_resolve_button),
        )
        if _button.value
    ),
    None,
)

if _overview_method is not None:
    _overview_method_context = overview_lens.context()
    _overview_method_current = _overview_method_context.current
    if _overview_method == "context":
        set_overview_action(
            {
                "kind": "context",
                "revision": _overview_method_context.revision,
            }
        )
    elif (
        _overview_method_current is None
        or _overview_method_current.get("cellStatus") != "available"
    ):
        set_overview_action(
            {
                "kind": "missing",
                "method": _overview_method,
                "revision": _overview_method_context.revision,
            }
        )
    elif _overview_method == "start_activity":
        _overview_method_cell = str(_overview_method_current["outputCellId"])
        overview_lens.start_activity(
            _overview_method_cell,
            label="Reviewing selected chart",
            message="Checking the selected result",
        )
        set_overview_action(
            {
                "kind": "start_activity",
                "revision": _overview_method_context.revision,
            }
        )
    elif _overview_method == "stop_activity":
        overview_lens.stop_activity(str(_overview_method_current["outputCellId"]))
        set_overview_action(
            {
                "kind": "stop_activity",
                "revision": _overview_method_context.revision,
            }
        )
    elif _overview_method == "reveal":
        overview_lens.reveal(
            str(_overview_method_current["outputCellId"]),
            duration_ms=8_000,
            label="Selected result",
            message="Returned the selected result for review.",
        )
        set_overview_action(
            {
                "kind": "reveal",
                "revision": _overview_method_context.revision,
            }
        )
    else:
        _overview_resolved_revision = overview_lens.resolve(
            str(_overview_method_current["id"]),
            expected_revision=_overview_method_context.revision,
            summary="Addressed the selected request.",
        )
        set_overview_action(
            {
                "kind": "resolve",
                "revision": _overview_resolved_revision,
            }
        )
```

<div class="lens-doc-demo-status">

```python marimo
_overview_revision = get_overview_revision()
_overview_context = overview_lens.context()
_overview_action = get_overview_action()
if (
    _overview_action is not None
    and int(_overview_action["revision"]) != _overview_context.revision
):
    _overview_action = None

_overview_current = _overview_context.current
_overview_kind = (
    str(_overview_action["kind"])
    if _overview_action is not None
    else ("ready" if _overview_current is not None else "empty")
)

_overview_details = ""
if _overview_current is not None:
    _overview_id = str(_overview_current.get("id", ""))
    _overview_label = escape(str(_overview_current.get("label", "Selection")))
    _overview_note = (
        escape(str(_overview_current.get("note", "")).strip()) or "No note added"
    )
    _overview_cell = escape(str(_overview_current["outputCellId"]))
    _overview_context_status = (
        "Ready" if _overview_current.get("cellStatus") == "available" else "Unavailable"
    )
    _overview_snapshot = _overview_current.get("snapshot", {})
    _overview_image_status = (
        "Ready"
        if _overview_id in _overview_context.images
        else escape(
            str(_overview_snapshot.get("status", "pending")).replace("_", " ").title()
        )
    )
    _overview_details = f"""
      <dl class="lens-doc-demo-context">
        <div><dt>Requested change</dt><dd>{_overview_note}</dd></div>
        <div><dt>Producing cell</dt><dd><code>{_overview_cell}</code></dd></div>
        <div><dt>Graph context</dt><dd>{_overview_context_status}</dd></div>
        <div><dt>Annotated image</dt><dd>{_overview_image_status}</dd></div>
      </dl>
    """

if _overview_kind == "empty":
    _overview_title = "Mark the chart"
    _overview_body = "Press <strong>Select</strong>, mark one bar, and add a note."
elif _overview_kind == "missing":
    _overview_missing_method = escape(str(_overview_action["method"]))
    _overview_title = "Mark the chart first"
    _overview_body = (
        f"<code>{_overview_missing_method}()</code> needs an available selection."
    )
elif _overview_kind == "context":
    if _overview_current is None:
        _overview_title = "No open request yet"
        _overview_body = (
            "<code>context()</code> found no selection. Mark the chart to create one."
        )
    else:
        _overview_title = "Context is ready"
        _overview_body = (
            "<code>context()</code> read the request and graph-grounded cell context."
            f"{_overview_details}"
        )
elif _overview_kind == "start_activity":
    _overview_title = "Activity is visible on the work cell"
    _overview_body = (
        "<code>start_activity()</code> marks where the agent is working."
        f"{_overview_details}"
    )
elif _overview_kind == "stop_activity":
    _overview_title = "Activity is cleared"
    _overview_body = (
        "<code>stop_activity()</code> cleared the work mark after verification."
        f"{_overview_details}"
    )
elif _overview_kind == "reveal":
    _overview_title = "The selected result is in view"
    _overview_body = (
        "<code>reveal()</code> returned the selected chart for review."
        f"{_overview_details}"
    )
elif _overview_kind == "resolve":
    _overview_title = "The request is in History"
    _overview_body = "<code>resolve()</code> completed the selected request."
else:
    _overview_title = f"{_overview_label} is grounded"
    _overview_body = _overview_details

mo.Html(
    f"""
    <aside
      data-overview-demo-state="{escape(_overview_kind)}"
      data-overview-demo-revision="{_overview_revision}"
      aria-live="polite"
    >
      <span class="lens-doc-demo-eyebrow">Live agent loop</span>
      <strong>{_overview_title}</strong>
      <div>{_overview_body}</div>
    </aside>
    """
)
```

</div>

</div>

Each card calls the method printed on it. A real agent uses code mode between
`start_activity()` and `stop_activity()` to inspect, edit, run, and verify
notebook cells.

## What the agent receives

Lens returns three connected forms of evidence:

| Evidence            | Agent use                                                        |
| ------------------- | ---------------------------------------------------------------- |
| Selection reference | Identifies the point or region, note, and exact output cell       |
| Graph context       | Supplies bounded source for the producing cell and its ancestors |
| Annotated image     | Preserves the visible evidence that drew the person's attention   |

The graph determines computational relevance. The image determines visual
focus. Keeping them together lets an agent reason from the code that produced
the result while preserving the human request that motivated the work.

## Code mode carries the notebook work

`marimo_lens.agent` connects from a live `marimo._code_mode` context. Its
stable handle reads Lens state and sends notebook feedback across kernel calls.
Code mode owns cell inspection, edits, execution, and runtime verification.

Follow the [Agent workflow](./agents) to connect a compatible agent. The
[Python API reference](./api) defines method signatures, image transfer,
revision checks, limits, and expected errors.

## Browser and Python responsibilities

Lens uses [anywidget](https://anywidget.dev/) to connect its browser interface
to a Python model in the notebook kernel.

| Browser                                                      | Python                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Finds rendered outputs and handles pointer or keyboard input | Stores open selections and completed History items            |
| Positions markers, selection UI, and agent feedback          | Reads the live marimo graph and builds `LensContext`           |
| Captures annotated images of selected outputs                | Validates selection changes, activity, reveal, and resolution |

The two sides exchange compact selection records and explicit commands through
the widget connection. PNG bytes travel separately from ordinary selection
state.

Start with [Getting started](./getting-started) to mount Lens and create one
request. The [Selections guide](./selections) covers point and region gestures,
multiple requests, History, and reopening.
