---
title: Custom labels and metadata
description: Use mo.Html attributes to name Lens targets, attach rendering references, choose image context, and inspect the captured description interactively.
---

# Custom labels and metadata

Add `data-marimo-lens-*` attributes to HTML output to give Lens a readable target
name, secondary detail, or rendering reference. Lens reads these attributes when
it presents a target and captures its description when someone selects it.

## Label an HTML output

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

## Select a card inside an output

Use `dom_selector` when an individual HTML element should be the target. Replace
the Lens cell with:

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

The `id` lets Lens find the same card after it renders again. The configured
card takes precedence over its containing notebook output. Other notebook
outputs remain selectable.

`data-marimo-lens-render-source` describes where the client renders the card.
Replace `notebook.py` and `revenue_card` with your project's path and symbol,
or omit the attribute. Lens carries this reference as evidence and does not
open the file or verify that the symbol exists. Put it on the selected root:
a rendering reference on a nested child is not inherited by a notebook target.

`data-marimo-lens-context` makes this card the preferred selection-image
container. Put it on a containing panel when nearby headings or values should
also supply image context. Capture stays bounded. See [Capture context](./concepts/targets#capture-context).

## Try the attributes

Edit the fields, press **Select**, then click the revenue card. The readout
shows the current selection's actual `description` from `Lens.context()`.
The code panel shows the `mo.Html` call used to render the card.

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
metadata_lens = Lens(dom_selector="#metadata-revenue-card")


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
        "**No selection yet.** Press **Select**, then click the revenue card."
    )
else:
    _metadata_description = _metadata_current.get("description")
    mo_output = mo.vstack(
        [
            mo.md(f"**Captured description · {_metadata_current['label']}**"),
            mo.md(
                "```json\n"
                + json.dumps(_metadata_description, ensure_ascii=False, indent=2)
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

## Read the captured metadata

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

Rerun the inspection cell after changing the selection. A `LensContext` is a
detached snapshot. Its compact references can omit optional descriptions when
they reach their byte budget, so use `.get("description")` when reading one.

## Choose attributes for your integration

| Attribute                        | Use it for                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `data-marimo-lens-label`         | A plain-text target name, up to 256 UTF-16 code units.                            |
| `data-marimo-lens-detail`        | Secondary text accompanying a label, up to 512 UTF-16 code units.                 |
| `data-marimo-lens-render-source` | A JSON object with a required `path` and optional `line`, `column`, and `symbol`. |
| `data-marimo-lens-context`       | A preferred image-context container for configured DOM targets.                   |
| `data-marimo-lens-cell-id`       | A producing cell ID already resolved by a host integration.                       |
| `data-marimo-lens-selector`      | An optional symbolic value selector accompanying a resolved cell ID.              |
| `data-marimo-lens-inputs`        | Space-separated IDs of source elements in the same document.                      |

Labels and rendering references describe content. Notebook sources establish
which cells Lens can follow into the runtime graph. A name such as `revenue`
or a rendering path does not establish that connection.

Ordinary notebook outputs get their producing cells from marimo. Hosts that
compose custom regions publish resolved sources through the [client metadata
contract](./concepts/targets#client-metadata). Use real cell IDs from the host's
runtime integration. A missing or ambiguous input reference makes a configured
target unavailable.

Read [Targets](./concepts/targets) for source collection and reattachment, and
[`LensContext`](./reference/context#captured-target-description) for the captured
metadata shape and bounds.
