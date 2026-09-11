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
`data-marimo-sources` inherit their source hosts' labels; an explicit label on the
region takes precedence; source labels remain as secondary information unless
the region supplies its own detail. Without consumer text, Lens uses available value
selectors, accessible names, headings, or cell IDs. Display labels do not grant
notebook access, change target identity, or establish provenance.

## Notebook sources

Lens reads the resolved projection metadata on Studio's `mo-value`,
`marimo-output`, and `marimo-cell` hosts. It retains producing cells and exact
value selectors in `target.sources`, distinguishing values from the same cell.

For custom JS rendering, put the existing hidden value hosts inside the selected
region, or reference their unique IDs explicitly:

```html
<span id="revenue-data" hidden mo-value="summary.revenue"></span>
<section data-marimo-sources="revenue-data">...</section>
```

Include `[data-marimo-sources]` in your `dom_selector`; Studio's
`STUDIO_RESULT_SELECTOR` already includes it. The annotation is a space-separated
list of projection host IDs in the same document and declares the complete input
set. References cannot chain through another annotated region. Missing,
duplicate, or unbound references make the region unavailable. Without an
annotation, Lens collects sources inside the region. A target carries at most
64 sources; value selectors accept up to 4,096 UTF-16 code units.

Keep references current when component inputs change. Set `aria-busy="true"`
during asynchronous rendering and clear it on completion; busy regions are
unavailable for selection and capture. This declares notebook dependencies; it
does not infer JS dataflow or record historical kernel values. Updating a value
preserves attention, while changing its selector or producing cell detaches it.

## Producing cells

A configured DOM target can project values from several notebook cells. The host
marks those producing cells with `data-runtime-cell-id` on the target or its descendants.

```html
<section class="lens-panel" data-runtime-cell-id="chart-cell">
  <div data-runtime-cell-id="filter-cell">Region: Europe</div>
  <div id="chart">Monthly revenue chart</div>
</section>
```

```python
lens = Lens(dom_selector=".lens-panel")
lens
```

Lens reads every non-empty `data-runtime-cell-id`, removes duplicates, and stores
the IDs in sorted order. Their order has no meaning. The producing-cell ID set
becomes part of the target identity, so adding or removing producing-cell
metadata detaches an existing selection until the original set returns.

A configured target with no producing-cell metadata is still selectable. Its context
contains the target, point or region, note, DOM hint, and available selection
image. It has no cell-backed graph context.

## Documents and reattachment

Every target belongs to one live browser document. Lens stores both an opaque
document ID and the current document path to prevent a selector or cell ID from
attaching to a similar element in another document.

Reattachment requires the original live document:

| Target kind    | Reattachment requirements                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Notebook       | Same document ID, same document path, same cell ID, and a visible output                                                                        |
| Configured DOM | Same document ID, same document path, same exact selector, continued `dom_selector` eligibility, same producing-cell ID set, and a visible root |

A page reload creates a new browser document. Make a new selection after reload
when an older target remains unavailable.

An unavailable selection stays in **Open** with its note and any selection image
whose capture previously succeeded. Its marker returns when the target satisfies
the reattachment requirements. You can also edit the note, inspect an available
image, or remove the selection while the target is unavailable.

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
3. Reference existing projections with `data-marimo-sources`. Cell-only integrations
   can attach `data-runtime-cell-id` to configured roots or their descendants.
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
