---
title: HTML attributes
description: Every data-marimo-lens-* attribute, where it goes, its bounds, and how attributes decide target precedence and identity.
---

# HTML attributes

Lens reads `data-marimo-lens-*` attributes from the document that displays a
`Lens` instance. They declare targets, name them, publish notebook sources for
composed views, and choose image context. [Custom targets](../custom-targets)
shows them in use.

## Attributes

| Attribute                         | Put it on                             | Meaning                                                                                                                               | Bound                                                         |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `data-marimo-lens-target`         | Any authored element                  | Makes the element a selectable target, with or without notebook inputs.                                                               | None                                                          |
| `data-marimo-lens-scope`          | A container                           | CSS selector for preferred grouping roots. A click inside selects the nearest matching root, or the nearest rendered block otherwise. | None                                                          |
| `data-marimo-lens-label`          | A target root, or inside an output    | Display name shown by the target indicator and captured as `description.label`.                                                       | 256 code units                                                |
| `data-marimo-lens-detail`         | Same element as the label             | Secondary text. Captured only alongside a label.                                                                                      | 512 code units                                                |
| `data-marimo-lens-render-source`  | A target root                         | JSON object with required `path` and optional `line`, `column`, and `symbol`. Carried as evidence and never opened.                   | `path` 1,024, `symbol` 256 code units, positive safe integers |
| `data-marimo-lens-context`        | The target or an ancestor             | Preferred container for selection-image capture. Must belong to the same document.                                                    | None                                                          |
| `data-marimo-lens-cell-id`        | A source element, which can be hidden | One resolved producing cell ID.                                                                                                       | 128 code units                                                |
| `data-marimo-lens-selector`       | The same element as `cell-id`         | Optional symbolic value selector from that cell. Descriptive evidence that Lens never evaluates.                                      | 4,096 code units, nonempty when present                       |
| `data-marimo-lens-inputs`         | A composed region                     | Whitespace-separated IDs of source elements in the same document. Declares the region's complete input set.                           | 64 sources per target                                         |
| `data-marimo-lens-output-cell-id` | Custom output DOM                     | Exposes a canonical notebook output rendered by the host.                                                                             | 128 code units                                                |

Bounds are UTF-16 code units. Most characters use one unit, and characters
outside the Basic Multilingual Plane, including many emoji, use two. Lens
renders labels and details as bounded plain text. Malformed render-source JSON
is omitted while valid labels and notebook inputs remain available.

## Target precedence

When a click or keyboard focus could belong to several candidates, Lens picks
the target in this order:

1. Native notebook outputs and regions with resolved source metadata take
   precedence over broad picking through `data-marimo-lens-scope`.
2. Regions marked with `data-marimo-lens-target` or `data-marimo-lens-inputs`
   have equal priority. When nested, the region nearest the clicked element
   wins.
3. Both take precedence over elements marked only with
   `data-marimo-lens-cell-id`.
4. A configured root, whether declared or matched by `dom_selector`, takes
   precedence over notebook outputs nested inside it. Outputs outside it remain
   separate targets.
5. When several `dom_selector` matches nest, the innermost match under the
   pointer wins. A declared region wins over `dom_selector` matches nested
   inside it, and its descendants are not separate targets.
6. Native output subtrees are opaque to broad picking. Unresolved source
   declarations remain unavailable, and hidden source elements are not
   themselves selectable.

## Source resolution

- A source element declares one complete notebook input through
  `data-marimo-lens-cell-id` and an optional `data-marimo-lens-selector`.
- A container without its own declaration collects its nested source elements.
  Source elements are opaque during collection, so renderer internals do not
  add unrelated dependencies.
- An explicit `data-marimo-lens-inputs` list declares the complete input set.
- Input IDs must be unique and resolve to elements with bound cell IDs.
  Missing, ambiguous, empty, or chained references make the target unavailable.
- Lens derives code, graph dependencies, and controls from the resolved cell
  IDs in the active runtime. Labels and rendering references never establish a
  notebook connection.

## Identity

A DOM target is identified by its owning document ID and path, an exact CSS
selector, and its notebook sources. The exact selector is a unique authored
element ID when available. Otherwise Lens assigns a locator owned by that
element.

| Change                                                      | Effect on existing selections                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Label, detail, or rendering reference                       | Identity preserved. Future selections capture the new value.                   |
| Element replaced with the same unique ID and sources        | The selection reattaches.                                                      |
| Element ID changed, duplicated, or unkeyed element replaced | Target unavailable.                                                            |
| Value selector or producing cells changed                   | Target unavailable.                                                            |
| Root no longer matches `dom_selector`                       | Target unavailable.                                                            |
| Full document replacement                                   | New document identity. Older selections stay Open with **Target unavailable**. |

Notebook targets reconnect whenever the same cell ID renders again in the same
document. A hidden output or one with no rendered dimensions is unavailable
until it becomes visible.

## `dom_selector`

`Lens(dom_selector=...)` adds configured targets from an existing CSS selector.
The string is stripped, must be nonblank, and accepts at most 1,024 UTF-16 code
units. It matches elements in the Lens document's light DOM. Elements inside a
shadow root or another document cannot be matched directly, so select their
light-DOM host when that host should own the selection. The browser reports
invalid CSS syntax when the view mounts. See [`Lens`](../api#lens) for the
constructor contract.
