---
title: Context and evidence
description: How Lens combines selection references, DOM hints, notebook graph context, selection images, and current cell-output images for an agent.
---

# Context and evidence

Lens gives an agent several connected forms of evidence for one selection. Each
form answers a different question about the request. A Document Object Model
(DOM) hint describes the rendered browser element at the selected location.

| Evidence            | Question it answers                                            |
| ------------------- | -------------------------------------------------------------- |
| Selection reference | What did the person select and ask for?                        |
| Target description  | What name and rendering reference did the author supply?       |
| DOM hint            | What rendered element was at the selected point or region?     |
| Graph context       | Which cells and controls produced the target?                  |
| Selection image     | What did the target look like when the selection was captured? |
| Cell-output image   | What does the producing cell output look like now?             |

[Why Lens?](/why-lens) explains why visual and computational evidence stay
connected. The [context reference](/reference/context) defines their complete
Python shapes.

## Selection references

Install `marimo-lens` in the notebook environment and mount Lens in one cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep the cell displayed, press **Select**, and click or drag on another output.
Run the inspection example in another cell, rerunning it after selections change.
[Getting started](/getting-started) includes installation commands.

`Lens.context()` returns compact references for every open selection. A
selection reference contains its stable ID and `S<n>` label, note, target,
producing cells, point or region, DOM hint, and selection snapshot status.

```python
context = lens.context()
selection = context.current

if selection is not None:
    print(selection["label"], selection["note"])
    print(selection["target"], selection["cells"])
```

`context.current` is the selection Lens most recently created or activated. It
is a likely referent for requests such as "change this." Read every item in
`context.references["selections"]` when one request spans several selections.

The context is detached. Its revision, references, text, and images describe the
same captured selection state even if the notebook changes afterward. Call
`lens.context()` again before revision-checked feedback or resolution.

## DOM hints

A DOM hint records bounded evidence about the rendered element at the selected
location. It can contain:

- The element tag.
- Its `role`, `aria-label`, and `title` attributes when present.
- Up to 240 UTF-16 code units of normalized rendered text.
- A generic path through element and open shadow-root boundaries.
- Bounds normalized to the selected target.

The hint helps an agent distinguish nearby labels, controls, rows, or chart
containers. It describes rendered DOM evidence. The agent still interprets the
meaning of a chart mark, application object, or visual pattern.

## Selection images

A selection image is an annotated
[Portable Network Graphics (PNG)](https://www.w3.org/TR/png-3/) image captured
from the selected target. It contains the target overview and the selection's
`S<n>` point or region marker. Large or scrolled targets can include a second
detail view that preserves the selected area at readable scale.

Lens starts image capture after it stores the selection. The selection remains
available when capture is still running or fails.

### Selection snapshot status

The `snapshot` field describes the selection image lifecycle:

| Status      | Meaning                                                    | Available bytes              |
| ----------- | ---------------------------------------------------------- | ---------------------------- |
| `pending`   | Lens has stored the selection and is preparing its image.  | No                           |
| `available` | The stored image matches the current point or region.      | Yes                          |
| `outdated`  | The marker moved after the stored image was captured.      | Yes, from the prior position |
| `failed`    | Lens could not produce an image for the current selection. | No                           |

Moving or resizing a marker starts replacement capture. Lens keeps the previous
image as `outdated` until replacement succeeds. A failed replacement keeps that
previous image available. Editing the note preserves the image.

`context.images` is a read-only mapping from selection IDs to successful PNG
bytes. Available and outdated images appear in that mapping.

```python
context = lens.context()
selection = context.current

if selection is not None:
    png = context.images.get(str(selection["id"]))
    status = selection["snapshot"]["status"]
    print(status, png is not None)
```

Deleting or clearing an open selection releases its image. Resolving a selection
also releases the image and moves bounded metadata into **History**. Reopening a
History entry while its target is available restores the selection and starts a
fresh capture. An unavailable target leaves the History entry unchanged.

### What capture includes

The browser captures the full selected target, filters out live Lens controls,
and draws the saved annotation onto the resulting PNG.

Selection images use the target's rendered background when one is available.
Same-origin iframe content and open shadow-root content can participate in the
capture. Inaccessible iframes and browser-protected resources can cause capture
to fail.

One selection image is limited to 8 MiB, 2,048 pixels per edge, and four
megapixels. Lens resizes a large raster to fit those bounds. One Lens instance
stores up to 64 MiB of selection image bytes.

### Visual context around small targets

A small DOM value can need its heading, row, or card to explain the selection.
Lens includes a nearby containing block and keeps a bounded crop around the
selected point or region. Wide containers are cropped to keep nearby text
legible. The marker stays aligned with the original target, and the target's
producer context remains tied to that selected value. Image previews preserve
natural size when the captured image is smaller than the preview.

## Graph context and text

The producing cell IDs in a [target](./targets) give Lens entry points into the
live marimo dependency graph. `Lens.context()` captures one bounded runtime
snapshot for the union of those producing cells and their relevant upstream
cells.

`context.references` builds immediately as dictionaries that can be serialized
to [JavaScript Object Notation (JSON)](https://www.rfc-editor.org/rfc/rfc8259).
`context.text` builds and caches when first read. Lens prioritizes producing
cells and their nearest upstream dependencies, retains at most 64 cells, and
shares a 24,000-character source budget across them. It presents retained cells
with dependencies before consumers and reports omitted cells or truncated
source. The text can include:

- Producing and relevant upstream cell source.
- Direct parent IDs, definitions, and references.
- Safely displayable native marimo control values.
- Selection notes and target information.

Passwords, file payloads, custom controls,
[anywidget](https://anywidget.dev/) values, and opaque state appear as
`[redacted]` or `[unavailable]`. A configured DOM target with no producing cell IDs has
selection evidence but no cell-backed graph context.

The [context reference](/reference/context) describes the projection fields and
bounds.

## Current cell-output images

A cell-output image is a fresh, unannotated PNG of one rendered notebook output. Agents
use it to verify current pixels after changing and running a cell. It is separate
from the capture-time selection image.

Code-mode integrations request a cell-output image through
`MountedLens.cell_image(cell_id, expected_revision=...)`. The first call starts
browser capture and returns `None`. End that kernel call so the browser can
respond, then repeat the call with the same Lens identity, cell ID, and selection
revision. A completed call returns and consumes the PNG bytes.

A Lens capture slot accepts one cell-output image request at a time. Poll the active
cell until it returns bytes or a terminal error before requesting another cell. The
[Agent workflow](/agents#inspect-current-cell-output-pixels) shows the complete loop.

## Trust and data scope

A selection image contains target pixels and can include nearby context for small
DOM targets. A DOM hint can
contain visible text and accessibility labels. Graph context can contain cell
source and supported control values. Choose a narrow `dom_selector` and review
notebook output before handing its evidence to an agent integration.

Lens keeps PNG bytes outside synchronized trait state, compact references, and
standalone text. A code-mode agent receives selection images through
`context.images` and cell-output images through `cell_image()`. The agent integration
controls how those returned bytes are stored or sent to a model.

See [Troubleshooting](/troubleshooting#image-is-unavailable-or-outdated) when an
image is pending, outdated, or unavailable. The [Python API reference](/api)
defines method signatures and lifecycle errors.
