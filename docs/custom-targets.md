---
title: Custom targets
description: Name notebook outputs, make cards and page regions selectable, publish notebook sources for composed views, and keep those targets stable.
---

# Custom targets

Every rendered notebook output is a Lens target by default, and marimo supplies
its producing cell. Custom HTML, dashboards, and host applications can shape
that further with `data-marimo-lens-*` attributes on their markup and, when
needed, the `dom_selector` option on `Lens()`:

- **Name** an output so the target indicator and agent context describe it well.
- **Make a region its own target**, such as one card inside a larger output.
- **Publish notebook sources** so a composed view keeps its graph context.

[HTML attributes](./reference/attributes) lists every attribute with its
bounds and precedence rules. This page shows how to use them.

::: tip Everything on this page is a target

The Lens mounted on this page uses `dom_selector="*"`, so every rendered
element is selectable: headings, paragraphs, sidebar links, code lines, and the
demo card. Press **Select** in the dock and click anything. The demo readout
under [Try the attributes](#try-the-attributes) shows what Lens captured for
your current selection.

:::

## Label an output

Open a notebook with marimo and Lens installed:

```sh
uvx --with marimo-lens marimo edit notebook.py
```

Run this in one cell:

```python
import marimo as mo

mo.Html("""
<section
  data-marimo-lens-label="Revenue forecast"
  data-marimo-lens-detail="Monthly total · USD"
>
  <h3>Revenue</h3>
  <p>$42,000</p>
</section>
""")
```

Mount Lens in another cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Press **Select** and point at the revenue output. The target indicator reads
**Revenue forecast**, with **Monthly total · USD** as detail. Click to create a
selection. The whole notebook output remains the target, and marimo supplies
its producing cell. A custom name describes that output even when its visible
heading says something else.

A root's explicit label wins over labels on nested elements. Without a custom
label, Lens falls back to available value selectors, headings, accessible
names, producing cell IDs, or the element name. Labels describe a target and
do not affect its identity. Changing a label updates the indicator and future
selections, while existing selections keep the description they captured.

## Make a region its own target

Two mechanisms turn part of a page into a target. Mark authored markup with
`data-marimo-lens-target`, including layout or copy with no notebook inputs:

```html
<header id="intro" data-marimo-lens-target data-marimo-lens-label="Introduction">
  <h1>Regional outlook</h1>
</header>
```

Or pass `dom_selector` to `Lens()` when you cannot change the markup or want
one policy for an application shell:

```python
from marimo_lens import Lens

lens = Lens(dom_selector="#app-shell :is(header, section, article)")
lens
```

Each matching element becomes a configured
[DOM](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model)
target in the document that displays `lens`. A configured region takes
precedence over notebook outputs nested inside it. Notebook outputs outside it
remain separate targets. Choose the narrowest roots that match the feedback
task. A selector for the whole shell produces one large target and hides its
nested outputs. When configured roots nest, a click picks the innermost match,
so a broad selector such as `*` makes every rendered element selectable on its
own. Declared regions still win over broad matches inside them.

Give every region a stable, unique `id`. Lens uses it to find the same target
after the view renders again. A region with no notebook inputs has empty
`cells` and `sources` while keeping its note, DOM hint, and image.

To turn the revenue card into its own target, replace the Lens cell with:

```python
from marimo_lens import Lens

lens = Lens(dom_selector="#revenue-card")
lens
```

Replace the revenue output cell with:

```python
import marimo as mo

mo.Html("""
<section
  id="revenue-card"
  data-marimo-lens-label="Revenue forecast"
  data-marimo-lens-detail="Monthly total · USD"
  data-marimo-lens-render-source='{"path":"notebook.py","symbol":"revenue_card"}'
  data-marimo-lens-context
>
  <h3>Revenue</h3>
  <p>$42,000</p>
</section>
""")
```

`data-marimo-lens-render-source` describes where the client renders the card.
Replace `notebook.py` and `revenue_card` with your project's path and symbol,
or omit the attribute. Lens carries this reference as evidence and does not
open the file or verify that the symbol exists. Put it on the selected root. A
rendering reference on a nested child is not inherited by a notebook target.

`data-marimo-lens-context` makes the card the preferred selection-image
container. [Choose the image context](#choose-the-image-context) explains the
alternatives.

## Try the attributes

The card carries `data-marimo-lens-target`, so it stays one unit while the
page-wide `dom_selector="*"` picks the innermost element everywhere else.

Edit the fields, press **Select**, then click the revenue card. The readout
shows the current selection's target, captured `description`, and DOM hint from
`Lens.context()`. The code panel shows the `mo.Html` call used to render the
card.

This example runs Python in your browser and may take a moment to start on the
first visit. It mounts its own Lens. The copyable notebook examples work locally
with the installation command on this page.

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
import json

import marimo as mo
from marimo_lens import Lens

get_metadata_revision, set_metadata_revision = mo.state(0)
```

<div class="lens-doc-demo">

<div class="lens-doc-demo-mount">

```python marimo
metadata_lens = Lens(dom_selector="*")


def _sync_metadata_revision(change):
    set_metadata_revision(int(change["new"]["revision"]))


metadata_lens.observe(_sync_metadata_revision, names="_state")
metadata_lens
```

</div>

```python marimo
metadata_label = mo.ui.text(
    value="Revenue forecast", label="Target label", full_width=True
)
metadata_detail = mo.ui.text(
    value="Monthly total · USD", label="Target detail", full_width=True
)
metadata_source = mo.ui.text(
    value='{"path":"notebook.py","symbol":"revenue_card"}',
    label="Rendering reference (JSON)",
    full_width=True,
)
metadata_context = mo.ui.checkbox(
    value=True, label="Keep image context inside the card"
)
mo.vstack([metadata_label, metadata_detail, metadata_source, metadata_context])
```

<div class="lens-doc-demo-output">

```python marimo
_metadata_context_attribute = (
    "\n  data-marimo-lens-context" if metadata_context.value else ""
)
metadata_html = f"""<section
  id="metadata-revenue-card"
  data-marimo-lens-target
  data-marimo-lens-label="{escape(metadata_label.value, quote=True)}"
  data-marimo-lens-detail="{escape(metadata_detail.value, quote=True)}"
  data-marimo-lens-render-source="{escape(metadata_source.value, quote=True)}"{_metadata_context_attribute}
  style="padding:24px;border:1px solid currentColor;border-radius:8px"
>
  <h3>Revenue</h3>
  <p>$42,000</p>
</section>"""
mo.Html(metadata_html)
```

</div>

::: details Inspect the current mo.Html source

````python marimo
mo.md('```python\nimport marimo as mo\n\nmo.Html("""\n' + metadata_html + '\n""")\n```')
````

:::

````python marimo
_metadata_revision = get_metadata_revision()
_metadata_current = metadata_lens.context().current
if _metadata_current is None:
    mo_output = mo.md(
        "**No selection yet.** Press **Select**, then click the revenue card "
        "or any other element on this page."
    )
else:
    _metadata_target = _metadata_current["target"]
    _metadata_hint = _metadata_current.get("domHint") or {}
    _metadata_summary = {
        "target": {
            "kind": _metadata_target["kind"],
            "domSelector": _metadata_target.get("domSelector"),
            "cellIds": _metadata_target["cellIds"],
        },
        "description": _metadata_current.get("description"),
        "domHint": {
            _key: _metadata_hint[_key]
            for _key in ("tag", "role", "text")
            if _key in _metadata_hint
        },
    }
    mo_output = mo.vstack(
        [
            mo.md(f"**Captured target · {_metadata_current['label']}**"),
            mo.md(
                "```json\n"
                + json.dumps(_metadata_summary, ensure_ascii=False, indent=2)
                + "\n```"
            ),
        ]
    )
mo_output
````

</div>

</llm-exclude>

Try these variations:

| Change                                                                                        | What Lens does                                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Change the label to `Quarterly revenue` after selecting.                                      | The existing selection keeps `Revenue forecast`. A new selection captures the new name.          |
| Clear the label.                                                                              | The card falls back to its `Revenue` heading. Detail alone does not define a custom description. |
| Clear the detail while keeping a label.                                                       | The custom name remains, with no authored secondary text.                                        |
| Enter `{"path":"src/report.ts","line":12,"symbol":"revenueCard"}` as the rendering reference. | A new selection includes that object under `description.renderSource`.                           |
| Enter invalid JSON as the rendering reference.                                                | Lens omits the rendering reference and keeps the valid label and detail.                         |
| Uncheck the image-context option.                                                             | Lens uses its bounded surrounding-context heuristics for the next capture.                       |

Exit Select mode before editing fields. Open **Selections** to compare captured
names across selections. Live changes affect future selections. Note edits,
History, and reopen preserve a selection's original description.

## Read the captured description

In your notebook, run this in another cell after selecting the card:

```python
context = lens.context()
selection = context.current

if selection is not None:
    print(selection["label"])
    print(selection.get("description"))
    print(selection["target"])
```

The selection's `label` is its stable `S<n>` identifier. The custom name is
`selection["description"]["label"]`. For the card example, the description is:

```json
{
  "label": "Revenue forecast",
  "detail": "Monthly total · USD",
  "renderSource": { "path": "notebook.py", "symbol": "revenue_card" }
}
```

Lens records the description when the selection is created. It appears in the
editor, Open list, History, and agent context, and survives reopen, so it
records what the person selected even if the live page later changes its label.
A `LensContext` is a detached snapshot, and compact references can omit
optional descriptions when they reach their byte budget, so read them with
`.get("description")`.

## Pick anywhere in a view

A host can make an entire authored subtree selectable with
`data-marimo-lens-scope`. Its value is a CSS selector for preferred grouping
roots:

```html
<main data-marimo-lens-scope=".card, section, figure">
  <div id="outlook" class="card">
    <h2>Outlook</h2>
    <p>Focus on <em>this phrase</em>.</p>
  </div>
</main>
```

Clicking the phrase selects the card and records `em`, its short text, relative
bounds, and `p > em` as the DOM hint. When no grouping root matches, Lens uses
the nearest rendered block. The scope stays in its own document and can change
with the rendered view. Invalid grouping syntax falls back to blocks.

Declared targets, source regions, and native notebook outputs take precedence
over broad picking. Native output subtrees are opaque to it, and notebook or
editor chrome outside the scope is unchanged.

## Publish notebook sources

Ordinary notebook outputs get their producing cells from marimo. A composed
view that renders values from several cells can publish resolved notebook
sources through Lens-owned attributes. Lens then derives Python code, graph
dependencies, and controls from those cell IDs in the active runtime.

```html
<span
  id="revenue-data"
  hidden
  data-marimo-lens-cell-id="summary-cell"
  data-marimo-lens-selector="summary.revenue"
></span>
<section
  id="revenue-card"
  data-marimo-lens-inputs="revenue-data"
  data-marimo-lens-label="Revenue"
  data-marimo-lens-detail="Monthly total"
  data-marimo-lens-render-source='{"path":"src/report.ts","symbol":"revenueCard"}'
  data-marimo-lens-context
>
  <!-- The client renders the result. -->
</section>
```

`Lens()` recognizes these regions automatically. The client resolves
`summary-cell` from its notebook integration at runtime. A value selector is
descriptive evidence that distinguishes values defined by the same cell. Lens
never evaluates it.

A source element declares one complete notebook input. A container without its
own declaration collects its nested source elements, and an explicit
`data-marimo-lens-inputs` list declares the region's complete input set. Source
metadata must resolve before a region is selectable. Missing, ambiguous, empty,
or chained input references make the target unavailable. Use real cell IDs from
the host's runtime integration. A name such as `revenue` or a rendering path
does not establish a notebook connection.

Hosts that expose a canonical notebook output through custom output DOM mark it
with `data-marimo-lens-output-cell-id="<cell-id>"`.

## Choose the image context

For DOM targets, the closest ancestor carrying `data-marimo-lens-context`
supplies the preferred image container. Put it on the target itself to keep
capture within that target, or on a containing panel when nearby headings or
values should also supply context. Without it, Lens uses bounded heuristics
that include a nearby containing block for small targets. The context
container must belong to the same document. Marking the document body or root
keeps capture within the selected element.

Capture plans keep the original target and normalized attention independent
from the image crop. Native notebook selections retain their output boundary.

## Keep targets stable

Lens identifies a DOM target by its owning document, an exact CSS selector, and
its notebook sources. The exact selector is a unique authored element ID when
one exists. Otherwise Lens assigns a locator owned by that element, and a
replacement needs a stable authored ID to represent the same target.

A configured target becomes unavailable when its exact selector stops locating
one eligible element. Common causes are changing an element ID, replacing an
unkeyed element, introducing a duplicate ID, changing which roots match
`dom_selector`, or changing the producing cells or value selectors. Changing a
label or rendering reference preserves identity and applies to future
selections.

Restore the original identity when the replacement represents the same target.
Create a new selection when the page now represents a different one. A full
document replacement creates a new document identity, and older selections
remain Open with **Target unavailable** until removed or resolved. See
[Troubleshooting](./troubleshooting#target-is-unavailable).

## Shadow roots and iframes

Configured roots must match elements in the Lens document's ordinary element
tree, often called the light DOM. A root can contain an
[open shadow root](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM),
and Lens follows pointer events, layout changes, and selected detail through
that open tree.

Lens also follows selection gestures into iframes allowed by the browser's
[same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy).
The iframe remains part of the enclosing target. Mount Lens in another document
when content owned by that document should become its own target.

An inaccessible iframe can still occupy pixels inside a target, but the browser
cannot read its document for image capture. The selection and text evidence
remain available when its image reports a failure. See
[Troubleshooting](./troubleshooting#iframe-or-resource-content-blocks-image-capture).

## Host checklist

1. Give every configured root a stable and unique element ID.
2. Keep `dom_selector` focused on the roots that should own selections.
3. Publish resolved sources and use `data-marimo-lens-inputs` for composed
   regions.
4. Keep a target visible with non-zero rendered dimensions while it is
   selectable.
5. Use `data-marimo-lens-output-cell-id` when custom output DOM exposes a
   canonical notebook output.

Lens skips a matching root whose identity cannot fit its bounds. [HTML
attributes](./reference/attributes) lists them, and [Errors and
limits](./reference/errors#resource-limits) lists every resource bound.
