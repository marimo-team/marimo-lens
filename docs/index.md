---
layout: home
title: "marimo-lens: Visual grounding for your notebook agent"
titleTemplate: false

hero:
  text: 'Let your notebook agent see <span class="lens-hero-focus">what you see<span class="lens-hero-selection-box" aria-hidden="true"></span></span>.'
  tagline: Point to a notebook result and say what should change. Lens connects that selection to the cells and notebook context behind the result.
  image:
    light: /brand/marimo-lens-lockup-stacked-light.svg
    dark: /brand/marimo-lens-lockup-stacked-dark.svg
    alt: marimo-lens
  actions:
    - theme: brand
      text: Try Lens
      link: "#try-lens"
    - theme: alt
      text: Understand Lens
      link: ./overview

features:
  - icon: 🎯
    title: Mark what you mean
    details: Click a location or drag across a region. Add a note with what you noticed or want changed.

  - icon: 🔗
    title: Ground the agent's work
    details: Lens links your selection to the code, controls, and visual context behind the result.

  - icon: 🔍
    title: Review the result
    details: See where your agent is working, review the result it brings into view, and reopen the selection for another pass.

  - icon: 🔌
    title: Connect your notebook agent
    details: Use Lens with a code-mode agent that can inspect, edit, run, and verify cells in the live marimo kernel.
---

<llm-exclude>

```marimo-config
requires-python = ">=3.10,<3.15"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

</llm-exclude>

<llm-only>

# marimo-lens

marimo-lens connects a point or region on rendered notebook output to the cells
and context behind it. A live notebook agent can inspect that selection, show
where it is working, and return the result for review.

Start with [Getting started](./getting-started), then read [What is
Lens?](./overview), [Why Lens?](./why-lens), and [How Lens
works](./how-lens-works).

</llm-only>

<llm-exclude>

<section id="demo" class="lens-video-demo" aria-labelledby="see-lens-in-action">

## See Lens in action

Mark a chart region, hand the request to a notebook agent, and review the result it brings back into view.

<div class="lens-video-frame">
<video aria-label="marimo-lens demo showing a chart selection, an agent request, and the reviewed notebook result" controls height="2160" playsinline poster="/lens-demo-poster.jpg" preload="metadata" src="/lens-demo-min.mp4" width="3592"></video>
</div>

</section>

</llm-exclude>

<llm-exclude>

<section id="try-lens" class="lens-demo">

## Try Lens on this chart

Select part of the chart, add a note, and see what your notebook agent receives.

<div class="lens-demo-steps" aria-label="Try Lens in four steps">
  <span><strong>1</strong> Press <strong>Select</strong></span>
  <span><strong>2</strong> Click a bar</span>
  <span><strong>3</strong> Add "Make bars blue"</span>
  <span><strong>4</strong> Hand off to agent</span>
</div>

```python marimo output=false
import asyncio
from html import escape

import marimo as mo
from marimo_lens import Lens

get_lens_revision, set_lens_revision = mo.state(0)
get_response_request, set_response_request = mo.state(None)
get_response_completion, set_response_completion = mo.state(None)
get_bar_color, set_bar_color = mo.state(None)
handoff_to_agent = mo.ui.run_button(
    label=(
        "<span style='display:block;padding:0.25rem 0.625rem;"
        "line-height:1.25rem'>"
        "Hand off to agent"
        "</span>"
    ),
)
```

<div class="lens-demo-mount">

```python marimo
lens = Lens()


def _sync_lens_revision(change):
    set_lens_revision(int(change["new"]["revision"]))


lens.observe(_sync_lens_revision, names="_state")
lens
```

</div>

<div class="lens-demo-output">

```python marimo
_response_request = get_response_request()
_applied_color = get_bar_color()
_bar_fill = (
    escape(str(_applied_color)) if _applied_color else "light-dark(#1d7363,#cad996)"
)
_monthly_revenue = [
    ("Jan", 42),
    ("Feb", 58),
    ("Mar", 67),
    ("Apr", 76),
    ("May", 35),
    ("Jun", 48),
]
_rows = "".join(
    f"""
    <div
      role="listitem"
      aria-label="{_month}, {_value} thousand dollars"
      data-demo-month="{_month}"
      style="display:grid;grid-template-columns:2.75rem minmax(4rem,1fr) 2.5rem;align-items:center;gap:0.75rem;min-width:0"
    >
      <span style="font-size:0.875rem;font-weight:500">{_month}</span>
      <span
        aria-hidden="true"
        style="display:block;height:1.125rem;overflow:hidden;border-radius:2px;background:color-mix(in srgb,currentColor 8%,transparent)"
      >
        <span
          data-demo-bar
          style="display:block;width:{_value / 80 * 100:.1f}%;height:100%;background:{_bar_fill}"
        ></span>
      </span>
      <span style="font-family:'Fira Mono',monospace;font-size:0.75rem;text-align:right">{_value}</span>
    </div>
    """
    for _month, _value in _monthly_revenue
)
chart_result = {
    "request": _response_request,
    "color": _applied_color,
}
mo.Html(
    f"""
    <figure
      aria-labelledby="lens-demo-chart-title"
      data-demo-bar-color="{_bar_fill}"
      style="margin:0;border:1px solid var(--marimo-island-border,#e2e8f0);border-radius:8px;background:var(--marimo-island-surface,#fff);color:var(--marimo-island-foreground,#0f172a);font-family:'PT Sans',sans-serif"
    >
      <figcaption style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.25rem 1.25rem 1rem">
        <span>
          <strong id="lens-demo-chart-title" style="display:block;font-size:1rem">Monthly revenue</strong>
          <span style="display:block;margin-top:0.125rem;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">USD thousands</span>
        </span>
        <span style="color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">Jan–Jun 2026</span>
      </figcaption>
      <div role="list" style="display:grid;gap:0.75rem;padding:0 1.25rem 1.25rem">
        {_rows}
      </div>
    </figure>
    """
)
```

</div>

```python marimo output=false
_lens_revision = get_lens_revision()
_agent_context = lens.context()
_agent_selections = _agent_context.references["selections"]
_agent_items = []
for _selection in _agent_selections:
    _selection_id = _selection["id"]
    _snapshot = _selection["snapshot"]
    _agent_items.append(
        {
            "id": _selection_id,
            "label": _selection["label"],
            "note": _selection["note"].strip(),
            "cellId": _selection["cells"][0]["id"],
            "imageStatus": (
                "Ready"
                if _selection_id in _agent_context.images
                else str(_snapshot.get("status", "pending")).title()
            ),
            "reopened": isinstance(
                _selection.get("previousResolution"),
                dict,
            ),
        }
    )
_response_request = get_response_request()
_response_completion = get_response_completion()

if not _agent_items:
    agent_handoff = (
        {
            "state": "complete",
            "summary": str(_response_completion["summary"]),
            "count": int(_response_completion["count"]),
        }
        if _response_completion is not None
        else {"state": "empty"}
    )
else:
    agent_handoff = {
        "state": (
            "ready" if any(_item["note"] for _item in _agent_items) else "selected"
        ),
        "items": _agent_items,
        "reopened": any(_item["reopened"] for _item in _agent_items),
    }
```

<div class="lens-demo-handoff">

```python marimo
_view = agent_handoff
_state = _view["state"]
_panel_open = """
<aside
  aria-labelledby="lens-demo-handoff-title"
  style="border:1px solid var(--marimo-island-border,#e2e8f0);border-left:3px solid #0880ea;border-radius:6px;padding:1rem 1.125rem;background:var(--marimo-island-muted-surface,#f1f5f9);color:var(--marimo-island-foreground,#0f172a);font-family:'PT Sans',sans-serif"
>
  <span id="lens-demo-handoff-title" style="display:block;margin-bottom:0.75rem;color:var(--marimo-island-muted-foreground,#64748b);font-family:'Fira Mono',monospace;font-size:0.6875rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase">
    What the agent receives
  </span>
"""
_panel_close = "</aside>"

if _state == "empty":
    _handoff_html = f"""
    {_panel_open}
      <div data-demo-handoff-state="empty">
        <strong style="display:block;font-size:0.9375rem">No request yet</strong>
        <span style="display:block;margin-top:0.25rem;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">
          Select part of the chart and add a note.
        </span>
      </div>
    {_panel_close}
    """
    _handoff_output = mo.Html(_handoff_html)
elif _state == "complete":
    _completed_summary = escape(_view["summary"])
    _completed_noun = "selection" if int(_view["count"]) == 1 else "selections"
    _handoff_html = f"""
    <aside
      aria-labelledby="lens-demo-complete-title"
      data-demo-handoff-state="complete"
      style="border:1px solid color-mix(in srgb,#1d7363 45%,var(--marimo-island-border,#e2e8f0));border-left:3px solid #1d7363;border-radius:6px;padding:1rem 1.125rem;background:var(--marimo-island-surface,#fff);color:var(--marimo-island-foreground,#0f172a);font-family:'PT Sans',sans-serif"
    >
      <span id="lens-demo-complete-title" style="display:block;color:#1d7363;font-family:'Fira Mono',monospace;font-size:0.6875rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase">
        Ready for review
      </span>
      <strong style="display:block;margin-top:0.625rem;font-size:0.9375rem">{_completed_summary}</strong>
      <p style="margin:0.5rem 0 0;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">
        Lens moved the {_completed_noun} to History and brought the chart back
        into view. Reopen one for another pass.
      </p>
    </aside>
    """
    _handoff_output = mo.Html(_handoff_html)
else:
    _reopened_notice = (
        """
        <p data-demo-reopened="true" style="margin:0 0 0.75rem;border-left:2px solid #1d7363;padding-left:0.625rem;color:#1d7363;font-size:0.8125rem;font-weight:600">
          Reopened from History. Update the note or hand it off again.
        </p>
        """
        if _view["reopened"]
        else ""
    )
    _selection_rows = []
    for _item in _view["items"]:
        _item_id = escape(_item["id"])
        _item_label = escape(_item["label"])
        _item_note = escape(_item["note"]) or "No note added"
        _item_cell = escape(_item["cellId"])
        _item_image_status = escape(_item["imageStatus"])
        _selection_rows.append(
            f"""
            <li
              data-demo-selection-id="{_item_id}"
              style="display:grid;gap:0.375rem;border:1px solid var(--marimo-island-border,#e2e8f0);border-radius:5px;padding:0.75rem;background:var(--marimo-island-surface,#fff)"
            >
              <strong style="font-size:0.8125rem">{_item_label}</strong>
              <span data-demo-request style="min-width:0;overflow-wrap:anywhere;font-size:0.8125rem">
                {_item_note}
              </span>
              <span style="color:var(--marimo-island-muted-foreground,#64748b);font-size:0.75rem">
                Cell <code data-demo-cell>{_item_cell}</code>
                · Selection image
                <span data-demo-image-status>{_item_image_status}</span>
              </span>
            </li>
            """
        )
    _selection_list = f"""
    <ol
      data-demo-selection-count="{len(_view["items"])}"
      style="display:grid;gap:0.625rem;margin:0;padding:0;list-style:none"
    >
      {"".join(_selection_rows)}
    </ol>
    """

    if _state == "selected":
        _handoff_body = f"""
        {_reopened_notice}
        <div data-demo-handoff-state="selected">
          {_selection_list}
          <span style="display:block;margin-top:0.75rem;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">
            Add a note with what you want the agent to change.
          </span>
        </div>
        """
        _handoff_output = mo.Html(f"{_panel_open}{_handoff_body}{_panel_close}")
    else:
        _selection_noun = "selection" if len(_view["items"]) == 1 else "selections"
        _handoff_button = mo.md(
            f"""
            <span data-demo-handoff-button style="display:inline-flex;overflow:hidden;align-items:center;border:1px solid #0880ea;border-radius:6px;background:light-dark(#edf6ff,#1d5b6a);line-height:1;cursor:pointer">
              {handoff_to_agent}
            </span>
            """
        )
        _handoff_html = f"""
        {_panel_open}
          {_reopened_notice}
          <div data-demo-handoff-state="ready">
            {_selection_list}
            <div style="margin-top:0.75rem;font-size:0.8125rem">
              <span style="display:block;color:var(--marimo-island-muted-foreground,#64748b)">
                Related notebook context
              </span>
              <span data-demo-context style="display:block;margin-top:0.25rem">
                Cell code, upstream cells, and current controls
              </span>
            </div>
          </div>
          <div style="margin-top:1rem;border-top:1px solid var(--marimo-island-border,#e2e8f0);padding-top:0.875rem">
            <strong style="display:block;font-size:0.875rem">Hand off to the demo agent</strong>
            <span style="display:block;margin-top:0.25rem;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem;line-height:1.45">
              It will use the {_selection_noun} to recolor the bars, show where
              it is working, and return the updated chart for review.
            </span>
          </div>
        {_panel_close}
        """
        _handoff_output = mo.vstack(
            [mo.Html(_handoff_html), _handoff_button],
            gap=0.75,
        )

_handoff_output
```

</div>

```python marimo output=false
if handoff_to_agent.value:
    _handoff_context = lens.context()
    _handoff_selections = _handoff_context.references["selections"]
    _handoff_current = _handoff_context.current
    _noted_selections = [
        _selection
        for _selection in _handoff_selections
        if _selection["note"].strip()
    ]
    if _handoff_current is not None and _noted_selections:
        _handoff_current_id = _handoff_current["id"]
        _ordered_notes = sorted(
            _noted_selections,
            key=lambda _selection: _selection["id"] != _handoff_current_id,
        )
        _color_candidate = ""
        _color_supported = False
        from js import OffscreenCanvas as _offscreen_canvas

        for _selection in _ordered_notes:
            _candidate = (
                str(_selection["note"]).rsplit(maxsplit=1)[-1].strip(".,!?;:'\"")
            )[:64]
            _color_context_a = _offscreen_canvas.new(
                1,
                1,
            ).getContext("2d")
            _color_context_b = _offscreen_canvas.new(
                1,
                1,
            ).getContext("2d")
            _color_context_a.fillStyle = "#010203"
            _color_context_b.fillStyle = "#040506"
            _color_context_a.fillStyle = _candidate
            _color_context_b.fillStyle = _candidate
            if str(_color_context_a.fillStyle) == str(_color_context_b.fillStyle):
                _color_candidate = _candidate
                _color_supported = True
                break

        _selection_count = len(_handoff_selections)
        _activity_message = (
            _ordered_notes[0]["note"][:120]
            if _selection_count == 1
            else f"Working through {_selection_count} selections"
        )
        set_response_completion(None)
        _activity_handle = lens.start_activity(
            _handoff_current,
            expected_revision=_handoff_context.revision,
            label="Reviewing chart request",
            message=_activity_message,
        )
        await asyncio.sleep(5)
        if _color_supported:
            set_bar_color(_color_candidate)
        lens.stop_activity(_activity_handle)
        set_response_request(
            {
                "selectionIds": [
                    _selection["id"] for _selection in _handoff_selections
                ],
                "revision": _handoff_context.revision,
                "color": _color_candidate,
                "colorSupported": _color_supported,
                "count": _selection_count,
            }
        )
```

```python marimo output=false
_verified_request = chart_result["request"]
if _verified_request is not None:
    _verified_context = lens.context()
    _verified_selection_ids = _verified_request["selectionIds"]
    _verified_current = _verified_context.current
    _open_selection_ids = {
        _selection["id"]
        for _selection in _verified_context.references["selections"]
    }
    if (
        _verified_current is not None
        and _verified_selection_ids
        and _verified_context.revision == _verified_request["revision"]
        and all(
            _selection_id in _open_selection_ids
            for _selection_id in _verified_selection_ids
        )
    ):
        _verified_color = _verified_request["color"]
        _verified_count = _verified_request["count"]
        if _verified_request["colorSupported"]:
            if _verified_count == 1:
                _verified_summary = (
                    f"Changed the bars to {_verified_color} and checked the result."
                )
            elif _verified_count == 2:
                _verified_summary = (
                    f"Changed the bars to {_verified_color} "
                    "and checked the result for both selections."
                )
            else:
                _verified_summary = (
                    f"Changed the bars to {_verified_color} "
                    f"and checked the result for all {_verified_count} "
                    "selections."
                )
        else:
            _verified_summary = (
                "This demo can recolor the bars. "
                "Add a color to a selection note, such as "
                '"Make bars blue."'
            )
        _verification_message = (
            "Checking the updated chart before returning it."
            if _verified_request["colorSupported"]
            else "Checking what this demo can change."
        )
        _verification_activity = lens.start_activity(
            _verified_current,
            expected_revision=_verified_context.revision,
            label="Checking updated chart",
            message=_verification_message,
        )
        await asyncio.sleep(5)
        lens.stop_activity(_verification_activity)
        _reveal_hold_ms = 10_000
        lens.reveal(
            _verified_current,
            expected_revision=_verified_context.revision,
            duration_ms=_reveal_hold_ms,
            label="Updated chart",
            message=_verified_summary,
        )
        await asyncio.sleep(_reveal_hold_ms / 1_000)
        lens.resolve(
            _verified_selection_ids,
            expected_revision=_verified_context.revision,
            summary=_verified_summary,
        )
        set_response_completion(
            {
                "summary": _verified_summary,
                "count": _verified_count,
            }
        )
```

</section>

</llm-exclude>

## Continue

- [Get started](./getting-started) with one notebook and one selection.
- [Understand Lens](./overview) through its targets, selections, context, and review loop.
- [Connect an agent](./agents) to inspect, change, verify, and return notebook work.
