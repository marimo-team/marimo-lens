---
layout: home
title: "marimo-lens: Visual grounding for your notebook agent"
titleTemplate: false

hero:
  text: 'Let your agent see <span class="lens-hero-focus">what you see<span class="lens-hero-selection-box" aria-hidden="true"></span></span>.'
  tagline: Point to a notebook result and say what should change. Lens connects that selection to the cells and notebook context behind the result.
  image:
    light: /brand/marimo-lens-lockup-stacked-light.svg
    dark: /brand/marimo-lens-lockup-stacked-dark.svg
    alt: marimo-lens
  actions:
    - theme: brand
      text: Get started
      link: ./getting-started
    - theme: alt
      text: Try the demo
      link: "#try-lens"
    - theme: alt
      text: What is Lens?
      link: ./overview

features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="lucide:square-dashed-mouse-pointer"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033zM5 3a2 2 0 0 0-2 2m16-2a2 2 0 0 1 2 2M5 21a2 2 0 0 1-2-2M9 3h1M9 21h2m3-18h1M3 9v1m18-1v2M3 14v1"/></svg>'
    title: Mark what you mean
    details: Click a location or drag across a region. Add a note with what you noticed or want changed.

  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="lucide:workflow"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></g></svg>'
    title: Ground the agent's work
    details: Lens links your selection to the code, controls, and visual context behind the result.

  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="lucide:eye"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></g></svg>'
    title: Review the result
    details: See where your agent is working, review the result it brings into view, and reopen the selection for another pass.

  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="lucide:bot"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2m16 0h2m-7-1v2m-6-2v2"/></g></svg>'
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

Start with [What is Lens?](./overview), then follow [Getting
started](./getting-started). [How Lens works](./how-lens-works) explains the
selection lifecycle and what an agent receives.

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

Select part of the chart, add a note, and hand it to a scripted agent. Everything
runs in your browser with no language model.

<ol class="lens-demo-steps" aria-label="Try Lens in three steps">
  <li>Press <strong class='lens-select'>Select</strong>, then click a bar.</li>
  <li>Add the note “Make bars blue”.</li>
  <li>Hand off and review the result.</li>
</ol>

```python marimo output=false
import asyncio
from html import escape

import marimo as mo
from marimo_lens import Lens

get_lens_revision, set_lens_revision = mo.state(0)
get_response_request, set_response_request = mo.state(None)
get_response_completion, set_response_completion = mo.state(None)
get_bar_color, set_bar_color = mo.state(None)
_button_style = (
    "<style>button[data-testid='marimo-plugin-button']{display:inline-flex;"
    "align-items:center;gap:8px;height:34px;padding:0 14px;"
    "border:1px solid var(--vp-c-divider,#e2e8f0);border-radius:6px;"
    "background:var(--vp-c-bg-elv,#fff);color:var(--vp-c-text-1,#0f172a);"
    "font-family:var(--vp-font-family-base,'PT Sans',sans-serif);font-size:14px;"
    "font-weight:600;line-height:1;box-shadow:none}"
    "button[data-testid='marimo-plugin-button']:hover{"
    "border-color:var(--vp-c-text-3,#94a3b8);background:var(--vp-c-bg-soft,#f1f5f9)}"
    "button[data-testid='marimo-plugin-button'] :is(.markdown,.paragraph,p)"
    "{display:contents}"
    "button[data-testid='marimo-plugin-button'] svg{flex:none;color:var(--vp-c-text-2,#64748b)}"
    "</style>"
)
handoff_to_agent = mo.ui.run_button(
    label=_button_style
    + (
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"16\" "
        "height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" "
        "stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">"
        "<path d=\"M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904zM6 12h16\"/>"
        "</svg>Hand off to agent"
    ),
)


def find_css_color(note):
    """Return the last word of the note that the browser accepts as a CSS color."""
    from js import OffscreenCanvas

    for word in reversed(str(note).split()):
        candidate = word.strip(".,!?;:'\"“”‘’")[:64]
        if not candidate:
            continue
        probe_a = OffscreenCanvas.new(1, 1).getContext("2d")
        probe_b = OffscreenCanvas.new(1, 1).getContext("2d")
        probe_a.fillStyle = "#010203"
        probe_b.fillStyle = "#040506"
        probe_a.fillStyle = candidate
        probe_b.fillStyle = candidate
        if str(probe_a.fillStyle) == str(probe_b.fillStyle):
            return candidate
    return None
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
_applied_color = get_bar_color()
_bar_style = f"background:{escape(str(_applied_color))};" if _applied_color else ""
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
    <div class="lens-selection-demo-row" role="listitem"
      aria-label="{_month}, {_value} thousand dollars" data-demo-month="{_month}">
      <span>{_month}</span>
      <span class="lens-selection-demo-track" aria-hidden="true">
        <span data-demo-bar style="width:{_value / 80 * 100:.1f}%;{_bar_style}"></span>
      </span>
      <span>{_value}</span>
    </div>
    """
    for _month, _value in _monthly_revenue
)
chart_result = {"request": get_response_request(), "color": _applied_color}
mo.Html(
    f"""
    <figure class="lens-selection-demo-chart" aria-labelledby="lens-demo-chart-title">
      <figcaption>
        <span>
          <strong id="lens-demo-chart-title">Monthly revenue</strong>
          <small>USD thousands</small>
        </span>
        <small>Jan–Jun 2026</small>
      </figcaption>
      <div class="lens-selection-demo-rows" role="list">{_rows}</div>
    </figure>
    """
)
```

</div>

```python marimo output=false
_lens_revision = get_lens_revision()
_agent_context = lens.context()
_agent_items = []
for _selection in _agent_context.references["selections"]:
    _agent_items.append(
        {
            "label": _selection["label"],
            "note": _selection["note"].strip(),
            "cellId": _selection["cells"][0]["id"],
            "imageStatus": (
                "image ready"
                if _selection["id"] in _agent_context.images
                else f"image {_selection['snapshot'].get('status', 'pending')}"
            ),
            "reopened": isinstance(_selection.get("previousResolution"), dict),
        }
    )
_response_completion = get_response_completion()

if _agent_items:
    agent_handoff = {
        "state": "ready" if any(_item["note"] for _item in _agent_items) else "selected",
        "items": _agent_items,
        "reopened": any(_item["reopened"] for _item in _agent_items),
    }
elif _response_completion is not None:
    agent_handoff = {"state": "complete", **_response_completion}
else:
    agent_handoff = {"state": "empty"}
```

<div class="lens-demo-handoff">

```python marimo
_state = agent_handoff["state"]
_eyebrow = "Addressed" if _state == "complete" else "What the agent receives"

if _state == "empty":
    _title = "No selection yet"
    _body = "<p>Press <strong class='lens-select'>Select</strong> and click a bar.</p>"
elif _state == "complete":
    _title = escape(agent_handoff["summary"])
    _body = (
        "<p>The selection moved to <strong>History</strong> and the chart came back "
        "into view. Reopen it from the dock to try another color.</p>"
    )
else:
    _items = "".join(
        f"""
        <li>
          <strong>{escape(_item["label"])}</strong>
          <span>{escape(_item["note"]) or "No note yet"}</span>
          <small>Cell <code>{escape(_item["cellId"])}</code> · {escape(_item["imageStatus"])}</small>
        </li>
        """
        for _item in agent_handoff["items"]
    )
    _reopened = (
        "<p>Reopened from History. Update the note or hand it off again.</p>"
        if agent_handoff["reopened"]
        else ""
    )
    if _state == "selected":
        _title = "Selection captured"
        _body = f"{_reopened}<ol>{_items}</ol><p>Add a note describing the change.</p>"
    else:
        _title = "Request ready"
        _body = (
            f"{_reopened}<ol>{_items}</ol>"
            "<p>The agent also receives the chart cell's source, its upstream data, "
            "and the current control values. It will recolor the bars, show where it "
            "is working, and bring the chart back for review.</p>"
        )

_actions = (
    f'<div class="lens-demo-panel-actions">{handoff_to_agent}</div>'
    if _state == "ready"
    else ""
)
mo.Html(
    f"""
    <aside class="lens-demo-panel" data-demo-handoff-state="{_state}" aria-live="polite">
      <span class="lens-doc-demo-eyebrow">{_eyebrow}</span>
      <strong>{_title}</strong>
      {_body}
      {_actions}
    </aside>
    """
)
```

</div>

```python marimo output=false
if handoff_to_agent.value:
    _context = lens.context()
    _selections = _context.references["selections"]
    _current = _context.current
    _noted = [_s for _s in _selections if _s["note"].strip()]
    if _current is not None and _noted:
        _noted.sort(key=lambda _s: _s["id"] != _current["id"])
        _color = next(
            (_c for _c in (find_css_color(_s["note"]) for _s in _noted) if _c), None
        )
        _count = len(_selections)
        set_response_completion(None)
        _activity = lens.start_activity(
            _current,
            expected_revision=_context.revision,
            label="Reading the request",
            message=(
                _noted[0]["note"][:120]
                if _count == 1
                else f"Working through {_count} selections"
            ),
        )
        await asyncio.sleep(2.5)
        if _color:
            set_bar_color(_color)
        lens.stop_activity(_activity)
        set_response_request(
            {
                "selectionIds": [_s["id"] for _s in _selections],
                "revision": _context.revision,
                "color": _color,
                "count": _count,
            }
        )
```

```python marimo output=false
_request = chart_result["request"]
if _request is not None:
    _context = lens.context()
    _current = _context.current
    _open_ids = {_s["id"] for _s in _context.references["selections"]}
    if (
        _current is not None
        and _context.revision == _request["revision"]
        and all(_id in _open_ids for _id in _request["selectionIds"])
    ):
        _color = _request["color"]
        _count = _request["count"]
        if _color:
            _scope = "" if _count == 1 else f" for all {_count} selections"
            _summary = f"Changed the bars to {_color} and checked the result{_scope}."
        else:
            _summary = 'This demo can recolor the bars. Add a color to your note, such as "Make the bars blue."'
        _activity = lens.start_activity(
            _current,
            expected_revision=_context.revision,
            label="Checking the chart" if _color else "Checking the request",
            message="Comparing the updated chart with the request.",
        )
        await asyncio.sleep(2)
        lens.stop_activity(_activity)
        if lens.context().revision == _context.revision:
            _hold_ms = 5_000
            lens.reveal(
                _current,
                expected_revision=_context.revision,
                duration_ms=_hold_ms,
                label="Updated chart" if _color else "Try a color",
                message=_summary,
            )
            await asyncio.sleep(_hold_ms / 1_000)
            if _color and lens.context().revision == _context.revision:
                lens.resolve(
                    _request["selectionIds"],
                    expected_revision=_context.revision,
                    summary=_summary,
                )
                set_response_completion({"summary": _summary, "count": _count})
```

</section>

</llm-exclude>

## Continue

- [What is Lens?](./overview) explains visual and computational grounding.
- [Get started](./getting-started) with one notebook, one selection, and one reviewed change.
- [Connect an agent](./agents) to inspect, change, verify, and return notebook work.
