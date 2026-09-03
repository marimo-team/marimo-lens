---
title: How Lens works
description: Follow one selection from a rendered target through agent context, verification, review, and History.
---

# How Lens works

A Lens workflow keeps human attention, notebook code, and the returned result
connected through one selection. The selection records a point or region on a
target. Lens links that target to its producing cells, builds bounded notebook
context, and attempts to capture a selection image. A code-mode agent
uses those forms of evidence to inspect, change, and verify the notebook.

The agent then reveals the selected target for review and resolves the
selection. Resolution moves it from **Open** to **History**. Reopening restores
the selection as current.

<llm-exclude>

```marimo-config
requires-python = ">=3.10,<3.15"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

```python marimo output=false
from html import escape
import inspect

import marimo as mo
from marimo_lens import Lens

supports_overview_selection_feedback = (
    "expected_revision" in inspect.signature(Lens.start_activity).parameters
)

get_overview_revision, set_overview_revision = mo.state(0)
get_overview_action, set_overview_action = mo.state(None)
get_overview_activity, set_overview_activity = mo.state(None)

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
        "Mark the selected target.",
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
        "Move the selection to History.",
    ),
    tooltip="Call resolve()",
    full_width=True,
)
```

</llm-exclude>

## The collaboration loop

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
    <span>Lens brings the result into view and preserves the selection for another pass.</span>
  </li>
</ol>

<llm-only>

1. The person marks a rendered target and adds an optional note.
2. Lens connects the selection to its producing cells and graph context.
3. The agent changes notebook code and verifies the affected result.
4. Lens reveals the result and moves Open selections into History.

</llm-only>

## Try the collaboration loop

Press **Select**, mark one bar, and add a note such as "Make this blue." The
panel reads the same Lens state available to a code-mode agent. Click the API
cards in order to send activity and review feedback back to the notebook.

<llm-exclude>

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
    elif _overview_method == "stop_activity":
        _overview_activity = get_overview_activity()
        if _overview_activity is None:
            set_overview_action(
                {
                    "kind": "missing",
                    "method": _overview_method,
                    "revision": _overview_method_context.revision,
                }
            )
        else:
            overview_lens.stop_activity(_overview_activity)
            set_overview_activity(None)
            set_overview_action(
                {
                    "kind": "stop_activity",
                    "revision": _overview_method_context.revision,
                }
            )
    elif _overview_method_current is None:
        set_overview_action(
            {
                "kind": "missing",
                "method": _overview_method,
                "revision": _overview_method_context.revision,
            }
        )
    elif _overview_method == "start_activity":
        if supports_overview_selection_feedback:
            _overview_activity = overview_lens.start_activity(
                _overview_method_current,
                expected_revision=_overview_method_context.revision,
                label="Reviewing selected chart",
                message="Checking the selected result",
            )
        else:
            _overview_cell_id = str(_overview_method_current["cells"][0]["id"])
            overview_lens.start_activity(
                _overview_cell_id,
                label="Reviewing selected chart",
                message="Checking the selected result",
            )
            _overview_activity = _overview_cell_id
        set_overview_activity(_overview_activity)
        set_overview_action(
            {
                "kind": "start_activity",
                "revision": _overview_method_context.revision,
            }
        )
    elif _overview_method == "reveal":
        if supports_overview_selection_feedback:
            overview_lens.reveal(
                _overview_method_current,
                expected_revision=_overview_method_context.revision,
                duration_ms=8_000,
                label="Selected result",
                message="Returned the selected result for review.",
            )
        else:
            overview_lens.reveal(
                str(_overview_method_current["cells"][0]["id"]),
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
        if _overview_resolved_revision is None:
            _overview_resolved_revision = overview_lens.context().revision
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
    _overview_cells = list(_overview_current.get("cells", []))
    _overview_cell = (
        escape(str(_overview_cells[0]["id"])) if _overview_cells else "None"
    )
    _overview_context_status = (
        "Ready"
        if any(_cell.get("status") == "available" for _cell in _overview_cells)
        else "Unavailable"
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
        <div><dt>Selection image</dt><dd>{_overview_image_status}</dd></div>
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
        _overview_title = "No selection yet"
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
    _overview_title = "Activity is visible on the selected target"
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
        "<code>reveal()</code> brought the selected chart into view."
        f"{_overview_details}"
    )
elif _overview_kind == "resolve":
    _overview_title = "The selection is in History"
    _overview_body = "<code>resolve()</code> moved the selection to History."
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

</llm-exclude>

<llm-only>

The interactive example follows one selection through the public agent loop:
`context()` reads it, `start_activity()` marks the work location,
`stop_activity()` clears that mark after verification, `reveal()` brings the
result for review, and `resolve()` moves the selection to History.

</llm-only>

Each card calls the method printed on it. A real agent keeps the activity handle
while code mode inspects, edits, runs, and verifies the producing cells.

## Lens context keeps three forms of evidence together

Lens returns three connected forms of evidence:

| Context property | Agent use                                                                  |
| ---------------- | -------------------------------------------------------------------------- |
| `references`     | Identifies each point or region, target, note, and producing cells.        |
| `text`           | Supplies bounded source, graph relationships, and eligible control values. |
| `images`         | Supplies selection images when browser capture succeeded.                  |

The graph determines computational relevance. A selection image preserves
capture-time visual focus. The selection remains usable when image capture is
pending or fails because its reference, note, and available notebook context
are independent evidence.

## Code mode carries the notebook work

`marimo_lens.agent` connects to an existing Lens from code-mode globals or the
active runtime's browser-ready registry. Its stable handle reads Lens state and
sends notebook feedback across kernel calls. Code mode owns cell inspection,
edits, execution, and runtime verification.

Follow the [Agent workflow](./agents) to connect a compatible agent. Read
[Context and evidence](./concepts/evidence) for the data boundary. The
[Python API reference](./api) defines method signatures.

## Browser and Python responsibilities

Lens uses [anywidget](https://anywidget.dev/) to connect its browser interface
to a Python model in the notebook kernel.

| Browser                                                      | Python                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Finds rendered outputs and handles pointer or keyboard input | Stores Open selections and History entries                    |
| Positions markers, selection UI, and agent feedback          | Reads the live marimo graph and builds `LensContext`          |
| Captures selection images of selected targets                | Validates selection changes, activity, reveal, and resolution |

The two sides exchange compact selection records and explicit commands through
the widget connection. PNG bytes travel separately from ordinary selection
state.

Start with [Getting started](./getting-started) to mount Lens and create one
selection. The [Selections guide](./selections) covers point and region
gestures, multiple selections, History, and reopening.
