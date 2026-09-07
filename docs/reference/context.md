---
title: LensContext reference
description: Exact public shapes for Lens context references, targets, anchors, DOM hints, image status, and previous resolution.
---

# `LensContext` reference

`Lens.context()` and `MountedLens.context()` return a detached `LensContext`.
The object represents one selection-state revision. It does not update when the
notebook, browser document, or Lens state changes.

```python
context = lens.context()

print(context.revision)
print(context.current)
print(context.references)
print(context.text)
print({selection_id: len(png) for selection_id, png in context.images.items()})
```

## Construction

Read a live context with `lens.context()` or `mounted.context()`. To reconstruct
an application-owned context from saved values:

```python
from marimo_lens import LensContext

copy = LensContext(
    references=context.references,
    text=context.text,
    images=context.images,
)
```

`LensContext(references: Mapping[str, object], text: str, images: Mapping[str, bytes])`
copies the references and image mapping and stores the supplied text. It does
not read the notebook or validate the full reference schema. Reading `revision`
raises `ValueError` when the supplied references contain an invalid revision.

## Properties

| Property     | Type                         | Contract                                                                    |
| ------------ | ---------------------------- | --------------------------------------------------------------------------- |
| `revision`   | `int`                        | Selection-state revision captured by this context.                          |
| `current`    | `SelectionReference \| None` | Current Open selection, or `None`.                                          |
| `references` | `LensReferences`             | Detached JSON-safe notebook, target, and selection records.                 |
| `text`       | `str`                        | Lazy, cached standalone text with selections and available graph context.   |
| `images`     | `Mapping[str, bytes]`        | Read-only mapping from selection ID to available selection-image PNG bytes. |

The `references` dictionary is a detached copy. Mutating the copy cannot change
Lens state. Changes to this dictionary do affect `current` and `revision` on
that context, so treat it as captured evidence. `images` is a read-only mapping. Reading `text` for the first time
renders and caches it from the runtime snapshot captured by `context()`.

With no Open selections, `text` is:

```text
No Lens selections were collected.
```

Use the code-mode context's notebook and graph APIs for a zero-selection
walkthrough.

## `LensReferences`

| Key                  | Type                       | Meaning                                             |
| -------------------- | -------------------------- | --------------------------------------------------- |
| `revision`           | `int`                      | Same value as `context.revision`.                   |
| `generatedAt`        | `str`                      | ISO 8601 context-generation time with a UTC offset. |
| `notebook`           | `NotebookReference`        | Notebook path and runtime availability.             |
| `currentSelectionId` | `str \| None`              | ID of the current Open selection.                   |
| `selections`         | `list[SelectionReference]` | Open selections in stable state order.              |

`NotebookReference` contains `path` and `available`. It contains `reason` when
Lens could not inspect the active marimo runtime.

## `SelectionReference`

| Key                  | Type                             | Meaning                                                          |
| -------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `id`                 | `str`                            | Stable selection ID used by `resolve()`.                         |
| `label`              | `str`                            | Stable human label in `S<n>` form.                               |
| `note`               | `str`                            | Person-authored text. No note is represented by an empty string. |
| `target`             | `SelectionTargetReference`       | Notebook or configured DOM target identity.                      |
| `cells`              | `list[CellReference]`            | Producing cell IDs with current graph status.                    |
| `anchor`             | `Mapping[str, object]`           | Normalized point or region geometry.                             |
| `snapshot`           | `Mapping[str, object]`           | Selection-image status.                                          |
| `domHint`            | `Mapping[str, object]`, optional | Bounded description of the element at the point or region.       |
| `previousResolution` | `Mapping[str, object]`, optional | Prior result for the current reopened selection.                 |

`previousResolution` is projected for the current selection when it was
reopened from History. Other Open selections omit it even when they share the
same stable ID with an older History entry.

## Target shapes

Every target contains:

| Key            | Type                  | Meaning                                               |
| -------------- | --------------------- | ----------------------------------------------------- |
| `kind`         | `"notebook" \| "dom"` | Target variant.                                       |
| `cellIds`      | `list[str]`           | Sorted, unique producing cell IDs.                    |
| `documentId`   | `str`                 | Opaque identity for the owning live browser document. |
| `documentPath` | `str`                 | URL path captured for the owning document.            |

A notebook target contains exactly one `cellIds` entry. A configured DOM target
also contains `domSelector`, the exact CSS selector used to locate the target
within its owning document. It can contain zero through 64 producing cell IDs.

## Cell status

Each `CellReference` contains `id` and `status`:

| Status        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `available`   | The current marimo graph contains the cell ID.                          |
| `missing`     | The runtime is available and the current graph does not contain the ID. |
| `unavailable` | Lens could not inspect the active runtime.                              |

Graph membership does not guarantee that the cell's source fit the retained
cell and source budgets in `context.text`.

## Anchor shapes

Coordinates are normalized to the target's full scrollable content. The
top-left corner is `(0, 0)` and the bottom-right corner is `(1, 1)`.

A point selection uses:

```json
{ "kind": "point", "x": 0.42, "y": 0.31 }
```

A region selection serializes with the protocol value `"rect"`:

```json
{
  "kind": "rect",
  "x": 0.2,
  "y": 0.15,
  "width": 0.35,
  "height": 0.4
}
```

`width` and `height` are positive. The complete rectangle must remain inside
the normalized target bounds.

## DOM hint shape

`domHint` describes the element under the point or the center of the region. It
always contains `tag` and can contain the other keys:

| Key         | Type              | Meaning                                                                 |
| ----------- | ----------------- | ----------------------------------------------------------------------- |
| `tag`       | `str`             | Lower-level element tag name.                                           |
| `role`      | `str`, optional   | Explicit `role` attribute.                                              |
| `ariaLabel` | `str`, optional   | Explicit `aria-label` attribute.                                        |
| `title`     | `str`, optional   | Element title.                                                          |
| `text`      | `str`, optional   | Bounded rendered text.                                                  |
| `path`      | `str`, optional   | Short descriptive DOM path. It is not the target reattachment selector. |
| `bounds`    | mapping, optional | Element bounds normalized to the target.                                |

The `bounds` mapping contains `x`, `y`, `width`, and `height` between zero and
one. The bounds remain inside the target.

DOM hint fields are bounded when the browser collects them. When the complete
reference exceeds its shared budget, fitting drops optional DOM hints before
shortening notes. Target identity, selection identity, and anchor geometry
remain intact.

## Selection image status

The compact `snapshot` reference contains one `status` field:

| Status      | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| `pending`   | Browser capture has not completed.                                    |
| `available` | `context.images[id]` contains the current selection image.            |
| `outdated`  | `context.images[id]` contains the image from before the marker moved. |
| `failed`    | Capture failed and `context.images` has no image for the selection.   |

Image dimensions, hashes, timestamps, and failure details belong to private
selection state and browser transport. The public compact reference exposes
status. The public `images` mapping exposes validated bytes when status is
`available` or `outdated`.

## `previousResolution`

| Key           | Type            | Meaning                                            |
| ------------- | --------------- | -------------------------------------------------- |
| `addressedAt` | `str`           | ISO 8601 time when the prior resolution committed. |
| `summary`     | `str`, optional | Prior resolution summary.                          |

Clearing History removes this field from reopened Open selections.

## Standalone text structure

When selections exist, `context.text` can contain these sections:

1. Notebook name, path, and runtime availability.
2. Selections with target, note, anchor, DOM hint, and producing-cell status.
3. Relevant current native-control values.
4. Producing and relevant upstream cells in topological order.
5. Context-limit notices, including producing cells whose control collection
   was incomplete or truncated.

Password controls, custom controls, file payloads, AnyWidget state, composite
controls, and opaque values appear as `[redacted]` or `[unavailable]`. Read
[Data and trust](../data-and-trust) before sending this text to an external
agent provider.

The package exports `LensContext`, `LensReferences`, `NotebookReference`,
`CellReference`, `SelectionReference`, and `SelectionTargetReference` for type
checking. Read the [Python API reference](../api) for construction and method
contracts.
