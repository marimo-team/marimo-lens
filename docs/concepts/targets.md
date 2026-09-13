---
title: Targets
description: How Lens identifies notebook outputs and configured page regions, connects them to producing cells, and reattaches selections after the page changes.
---

# Targets

A target is the rendered area that owns a Lens selection. Lens selects notebook
outputs by default. Pass `dom_selector` when an authored page region should also
accept selections.

```python
from marimo_lens import Lens

lens = Lens(
    dom_selector="#app-shell :is(header, section, article)",
)
lens
```

The selector applies to the document that displays `lens`. Each matching region
becomes a configured [Document Object Model (DOM)](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model)
target. Notebook outputs outside those regions remain selectable.

## Target, point, and region

Lens stores two parts when a person makes a selection:

- The **target** identifies the rendered notebook output or configured DOM root.
- The **point** or **region** narrows attention within that target.

The target connects the selection to producing cells. The point or region keeps
the visible location that motivated the request. A selection also carries its
note and [evidence](./evidence).

## Notebook targets

A notebook target identifies one rendered output cell. Lens recognizes the
output roots produced by an active marimo notebook and records the cell ID with
the target.

The cell ID gives `Lens.context()` an entry point into the marimo dependency
graph. Lens follows that graph upstream to collect the source and control values
that produced the selected output.

Notebook targets reconnect when the same cell ID renders again in the same
document. A hidden output or an output with no rendered dimensions remains
unavailable until it becomes visible.

## Configured DOM targets

`dom_selector` is a [Cascading Style Sheets (CSS) selector](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors),
a browser pattern that matches authored roots in the Lens document. Use it for
page layouts, dashboards, or application regions that wrap notebook outputs.

For each matching root, Lens records:

- An opaque document ID and the document path.
- A unique, exact CSS selector for that root.
- Zero or more producing cell IDs.

The configured selector chooses which roots can become targets. The exact
selector reconnects one chosen root after its DOM node is replaced.

### Selection precedence

A configured root takes precedence over notebook outputs nested inside it. This
makes the configured root the selection target for pointer and keyboard input.
Notebook outputs outside configured roots remain separate targets.

Choose the narrowest roots that match the feedback task. A selector for an
entire application shell produces a large target and hides its nested notebook
outputs from the target list. A selector for individual articles or panels keeps
those regions independently selectable.

### Exact selectors

Lens uses a unique authored element ID when available. Otherwise it assigns a
locator owned by that element. A replacement needs a stable authored ID to
represent the same target.
The resulting selector must identify exactly one element in the document.

A configured target becomes unavailable when its exact selector stops locating
one eligible element. Common causes include changing an element ID, replacing
an unkeyed element, introducing a duplicate ID, or changing
which roots match `dom_selector`.

Restore the original identity when the replacement represents the same target.
Create a new selection when the page now represents a different target.

## Target labels

In Select mode, Lens outlines the pointed or keyboard-focused target and places
its label at the element's edge. The indicator follows the Marimo theme and disappears when selection starts
or Select mode ends. It does not intercept pointer input. Selectable content
uses a crosshair cursor while Select mode is active, including native controls
and custom-rendered descendants. Lens restores authored cursors when it leaves
the target or exits Select mode. Declared targets that normally pass pointer
input through to underlying content become pickable during Select mode; their
authored pointer behavior is restored afterward.

Any consumer can provide the display text. For example, configure
`Lens(dom_selector="[data-feedback-target]")` and render:

```html
<section
  data-feedback-target
  data-marimo-lens-label="Revenue forecast"
  data-marimo-lens-detail="Query · finance.monthly"
>
  <!-- Your application renders this region. -->
</section>
```

`data-marimo-lens-label` is the primary name; `data-marimo-lens-detail` is optional
secondary text. Lens defines this `TargetInfo` model and renders bounded plain
text (256 UTF-16 units for a name, 512 for detail). Consumers choose the data;
HTML, scripts, links, and custom presentation are not interpreted. Updates appear
without moving the pointer. Keyboard target navigation announces the same text.

Studio supplies these attributes from resolved projections. Regions linked with
`data-marimo-lens-inputs` inherit their source hosts' labels; an explicit label on the
region takes precedence; source labels remain as secondary information unless
the region supplies its own detail. Without consumer text, Lens uses available value
selectors, accessible names, headings, or cell IDs. Display labels do not grant
notebook access, change target identity, or establish provenance.

After selection, labels retain the captured description, such as “Revenue” or
`athlete_summary.athletes`. Hover over the target label in the note editor or
selection list to see its producing cell IDs and rendering reference. The same
sources remain available in `Lens.context()` through note edits and History.

## Client metadata

Custom clients publish resolved notebook sources through Lens-owned attributes.
Lens derives Python code, graph dependencies, and controls from those cell IDs
in the active Marimo runtime. A value selector is descriptive evidence, not an
expression that Lens executes.

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

Configure `Lens(dom_selector="[data-marimo-lens-inputs]")` for these regions.
Clients resolve `summary-cell` from their notebook integration at runtime.
Studio publishes the same source attributes on its mounted projections.

| Attribute                        | Meaning                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `data-marimo-lens-cell-id`       | One resolved producing cell ID.                                                     |
| `data-marimo-lens-selector`      | Optional symbolic value selector from that cell.                                    |
| `data-marimo-lens-inputs`        | Whitespace-separated IDs of source elements in the same document.                   |
| `data-marimo-lens-label`         | Display name, bounded to 256 UTF-16 units.                                          |
| `data-marimo-lens-detail`        | Additional description, bounded to 512 UTF-16 units.                                |
| `data-marimo-lens-render-source` | JSON rendering reference with a `path` and optional `line`, `column`, and `symbol`. |
| `data-marimo-lens-context`       | Marks a containing element as the preferred image context.                          |

A source element declares its complete notebook input. A container without its
own source declaration collects its nested source elements. An explicit
`data-marimo-lens-inputs` list declares the complete input set for that region.
Source elements are opaque during collection, so nested renderer internals do
not add unrelated dependencies.

Input IDs must be unique and resolve to elements with bound cell IDs. Missing,
ambiguous, empty, or chained input references make the target unavailable.
Targets retain at most 64 sources. Selectors accept up to 4,096 UTF-16 units.
An optional selector must be nonempty when present.

A new DOM element with the same unique ID and source signature can restore a
selection. Changing the value selector or producing cells makes the original
target unavailable. Changing its label or render-source reference preserves
identity and applies to future selections.

## Captured descriptions and rendering references

At selection creation, Lens records the resolved label, detail, and optional
render-source reference in `selection.description`. This bounded description
appears in the editor, Open list, History, and agent context, and survives reopen.
It records what the person selected even if the live page later changes its label.

A rendering reference describes client-owned source separately from the
notebook inputs. Its path is interpreted within the client project and is
bounded to 1,024 UTF-16 units. Line and column are positive safe integers, and
symbol is bounded to 256 UTF-16 units. Lens carries the reference as client-supplied
evidence. It does not read that file or infer browser dataflow. Malformed
render-source metadata is omitted while valid labels and notebook inputs remain
available.

## Capture context

For DOM targets, the closest ancestor carrying `data-marimo-lens-context`
supplies the preferred image container. Place it on the target itself to keep
capture within that target. Otherwise Lens uses its bounded context heuristics.
The context container must belong to the same document. Marking the document
body or root keeps capture within the selected element.

Capture plans keep the original target and normalized attention independent
from the image crop. Native notebook selections retain their output boundary.

## Shadow roots and iframes

Configured roots must match elements in the Lens document's ordinary element
tree, often called the light DOM. A root can contain an
[open shadow root](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM),
and Lens follows pointer events, layout changes, and selected detail through that
open tree.

Lens also follows selection gestures into iframes allowed by the browser's
[same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy).
The iframe remains part of the enclosing target. Mount Lens in another document
when content owned by that document should become its own target.

An inaccessible iframe can still occupy pixels inside a target, but the browser
cannot read its document for image capture. The selection and text evidence
remain available when its image reports a failure. See [Troubleshooting](../troubleshooting#iframe-or-resource-content-blocks-image-capture).

## Host contract

Host integrations should preserve these inputs:

1. Give every configured root a stable and unique element ID when possible.
2. Keep `dom_selector` focused on the roots that should own selections.
3. Publish resolved sources and use `data-marimo-lens-inputs` for composed regions.
4. Keep a target visible with non-zero rendered dimensions while it is
   selectable.
5. Use `data-marimo-lens-output-cell-id="<cell-id>"` when a host exposes a
   canonical notebook output through custom output DOM.

The configured selector and exact selector accept up to 1,024 UTF-16 code units.
A configured target can carry up to 64 producing cell IDs, each up to 128 UTF-16 code
units. Lens skips a matching root when its target identity cannot fit these
limits. [Errors and limits](/reference/errors#resource-limits) lists the
complete bounds.

Continue with [Selections](/selections) to create and refine points and regions,
or read [Context and evidence](./evidence) to see what Lens gives an agent.
