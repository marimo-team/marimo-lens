---
layout: home

hero:
  text: Let Pair see what you see.
  tagline: Point at a notebook result and ask <a href="https://marimo.io/pair">marimo Pair</a> about "this" without copying cell IDs, code, or screenshots. Pair starts with the selected cell and related notebook structure, then loads an image of your selection when needed.
  image:
    light: /brand/marimo-lens-lockup-stacked-light.svg
    dark: /brand/marimo-lens-lockup-stacked-dark.svg
    alt: marimo-lens
  actions:
    - theme: brand
      text: Try Lens
      link: "#try-lens"
    - theme: alt
      text: Get started
      link: ./getting-started

features:
  - title: Mark what you mean
    details: Point to a value or drag across a region. Add a note to say what you noticed or what should change.

  - title: Connect it to the notebook
    details: Lens turns the mark and note into text and a marked image linked to the producing cell, relevant controls, and upstream code.

  - title: Follow the work
    details: See which cell <a href="https://marimo.io/pair">marimo Pair</a> is changing or checking. Review the result it reveals, then reopen the request for another pass.
---

```marimo-config
requires-python = ">=3.11"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

<section id="try-lens" class="lens-demo">

## Try Lens on a live result

Mark the April bar, describe what you want changed, and see how Lens connects
the request to its notebook cell.

<div class="lens-demo-steps" aria-label="Try Lens in three steps">
  <span><strong>1</strong> Press Select</span>
  <span><strong>2</strong> Mark April</span>
  <span><strong>3</strong> Add “Label this peak with its change from March.”</span>
</div>

```python marimo output=false
from html import escape

import marimo as mo
from marimo_lens import Lens

get_lens_revision, set_lens_revision = mo.state(0)
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
      style="display:grid;grid-template-columns:2.75rem minmax(0,1fr) 2.5rem;align-items:center;gap:0.75rem;min-width:0"
    >
      <span style="font-size:0.875rem;font-weight:500">{_month}</span>
      <span
        aria-hidden="true"
        style="display:block;height:1.125rem;overflow:hidden;border-radius:2px;background:color-mix(in srgb,currentColor 8%,transparent)"
      >
        <span style="display:block;width:{_value / 80 * 100:.1f}%;height:100%;background:light-dark(#1d7363,#cad996)"></span>
      </span>
      <span style="font-family:'Fira Mono',monospace;font-size:0.75rem;text-align:right">{_value}</span>
    </div>
    """
    for _month, _value in _monthly_revenue
)
mo.Html(
    f"""
    <figure
      aria-labelledby="lens-demo-chart-title"
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

<div class="lens-demo-handoff">

```python marimo
_lens_revision = get_lens_revision()
_context = lens.context()
_selections = _context.references.get("selections", [])
_current_id = _context.references.get("currentSelectionId")
_user_icon = """
<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="8" r="5"></circle>
  <path d="M20 21a8 8 0 0 0-16 0"></path>
</svg>
"""
_bot_icon = """
<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 8V4H8"></path>
  <rect width="16" height="12" x="4" y="8" rx="2"></rect>
  <path d="M2 14h2"></path>
  <path d="M20 14h2"></path>
  <path d="M15 13v2"></path>
  <path d="M9 13v2"></path>
</svg>
"""
if not _selections:
    _handoff = """
    <div data-demo-handoff-state="empty">
      <strong style="display:block;font-size:0.9375rem">No request yet</strong>
      <span style="display:block;margin-top:0.25rem;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.8125rem">
        Mark the April bar to create a request linked to this output.
      </span>
    </div>
    """
else:
    _selection_items = []
    for _selection in _selections:
        _selection_id = str(_selection.get("id", ""))
        _anchor = _selection.get("anchor", {})
        _snapshot = _selection.get("snapshot", {})
        _kind = str(_anchor.get("kind", "selection")).title()
        _note = str(_selection.get("note", "")).strip()
        _note_value = escape(_note) if _note else "No note added"
        _snapshot_value = str(_snapshot.get("status", "pending")).title()
        _current_badge = (
            """
            <span style="border:1px solid color-mix(in srgb,#0880ea 45%,transparent);border-radius:999px;padding:0.125rem 0.4375rem;color:#0880ea;font-family:'PT Sans',sans-serif;font-size:0.6875rem;font-weight:600">
              Current
            </span>
            """
            if _selection_id == _current_id
            else ""
        )
        _selection_items.append(
            f"""
            <li
              data-demo-selection-id="{escape(_selection_id)}"
              style="min-width:0;border:1px solid var(--marimo-island-border,#e2e8f0);border-radius:6px;padding:0.75rem 0.875rem;background:var(--marimo-island-surface,#fff)"
            >
              <div style="display:flex;min-width:0;align-items:center;justify-content:space-between;gap:0.75rem">
                <strong style="min-width:0;font-size:0.875rem">
                  {escape(str(_selection.get("label", "Selection")))} · {escape(_kind)} selection
                </strong>
                {_current_badge}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:0.25rem 0.875rem;margin-top:0.375rem;color:var(--marimo-island-muted-foreground,#64748b);font-size:0.75rem">
                <span>Cell <span style="font-family:'Fira Mono',monospace">{escape(str(_selection.get("outputCellId", "")))}</span></span>
                <span>Image {escape(_snapshot_value)}</span>
              </div>
              <div style="display:grid;grid-template-columns:14px minmax(0,1fr);align-items:start;gap:0.5rem;margin-top:0.625rem">
                <span
                  aria-label="Request"
                  title="Request"
                  style="display:inline-flex;width:14px;height:17px;align-items:center;justify-content:center;color:var(--marimo-island-muted-foreground,#64748b)"
                >
                  {_user_icon}
                </span>
                <span style="min-width:0;font-size:0.8125rem;line-height:17px;overflow-wrap:anywhere;white-space:pre-wrap">{_note_value}</span>
              </div>
            </li>
            """
        )
    _handoff = f"""
    <ol
      data-demo-handoff-state="ready"
      style="display:grid;gap:0.625rem;margin:0;padding:0;list-style:none"
    >
      {"".join(_selection_items)}
    </ol>
    """
mo.Html(
    f"""
    <aside
      aria-labelledby="lens-demo-handoff-title"
      style="border:1px solid var(--marimo-island-border,#e2e8f0);border-left:3px solid #0880ea;border-radius:6px;padding:1rem 1.125rem;background:var(--marimo-island-muted-surface,#f1f5f9);color:var(--marimo-island-foreground,#0f172a);font-family:'PT Sans',sans-serif"
    >
      <span id="lens-demo-handoff-title" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.625rem;color:var(--marimo-island-muted-foreground,#64748b);font-family:'Fira Mono',monospace;font-size:0.6875rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase">
        <span
          aria-label="Agent"
          title="Agent"
          style="display:inline-flex;width:14px;height:17px;align-items:center;justify-content:center"
        >
          {_bot_icon}
        </span>
        What an agent starts with
      </span>
      {_handoff}
    </aside>
    """
)
```

</div>

Try a region next. Press **Select** again and drag from April through June.
Lens keeps both marks and notes linked to the same output so an agent can
inspect the requests together.

<div class="lens-demo-actions">
  <a class="lens-demo-action lens-demo-action-primary" href="./pair">Use with Pair</a>
  <a class="lens-demo-action" href="./getting-started">Install Lens</a>
</div>

</section>
