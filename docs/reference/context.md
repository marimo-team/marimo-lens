---
title: LensContext reference
description: Exact public shapes for Lens context references, targets, anchors, DOM hints, image status, and previous resolution.
---

# `LensContext` reference

`Lens.context()` and `MountedLens.context()` return a detached `LensContext`.
The object represents one selection-state revision. It does not update when the
notebook, browser document, or Lens state changes.

To create `lens`, run this in a notebook cell with `marimo-lens` installed:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep that cell displayed, create a selection with **Select**, then run this in
another cell. Rerun it to read changes to the selection:

```python
context = lens.context()

print(context.brief)
print(context.revision)
print(context.request)
print(context.current)
print({selection_id: len(png) for selection_id, png in context.images.items()})
```

## Construction

`lens.context()` and `mounted.context()` create every `LensContext`. Calling
`LensContext()` directly raises `TypeError`. To keep the evidence, save
`context.brief`, `context.references`, `context.text`, the bytes in
`context.images`, and `context.history()` when the Lens keeps a record. Each
`history()` row judges the record against this context's notebook snapshot.

## Properties

| Property     | Type                         | Contract                                                                    |
| ------------ | ---------------------------- | --------------------------------------------------------------------------- |
| `revision`   | `int`                        | Selection-state revision captured by this context.                          |
| `brief`      | `str`                        | Lazy, cached first read for the current request.                            |
| `request`    | `RequestReference \| None`   | Open request described by the brief, or `None`.                             |
| `current`    | `SelectionReference \| None` | Current Open selection, or `None`.                                          |
| `references` | `LensReferences`             | Detached JSON-safe notebook, target, and selection records.                 |
| `text`       | `str`                        | Lazy, cached standalone text with selections and available graph context.   |
| `history()`  | `list[RecordedRequest]`      | Recorded requests, each change with whether it still holds. Needs a record. |
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

## `request`

`context.request -> RequestReference | None` returns the open request described
by `brief`. A chat request takes precedence when it opened after the current
selection. Otherwise the current selection is the request. With neither open,
`request` is `None`.

```python
request = context.request
if request is not None:
    print(request["id"], request["channel"], [cell["id"] for cell in request["cells"]])
```

| Key       | Type                    | Meaning                                                                                                       |
| --------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`      | `str`                   | Request ID accepted by `resolve()`.                                                                           |
| `channel` | `"selection" \| "chat"` | How the request opened.                                                                                       |
| `label`   | `str \| None`           | Selection label such as `S1`, or `None` for chat.                                                             |
| `note`    | `str`                   | The selection note or quoted chat instruction.                                                                |
| `cells`   | `list[CellReference]`   | Producing cells for a selection, or cells named in `open_request()`. See [cell references](#cell-references). |

Each read returns a copy of the request captured when the context was created.
Keep its ID when work spans kernel calls. A later context can describe a newer
request. `context.current` continues to identify the current selection while a
chat request is open.

## `LensReferences`

| Key                  | Type                         | Meaning                                             |
| -------------------- | ---------------------------- | --------------------------------------------------- |
| `revision`           | `int`                        | Same value as `context.revision`.                   |
| `generatedAt`        | `str`                        | ISO 8601 context-generation time with a UTC offset. |
| `notebook`           | `NotebookReference`          | Notebook path and runtime availability.             |
| `currentSelectionId` | `str \| None`                | ID of the current Open selection.                   |
| `selections`         | `list[SelectionReference]`   | Open selections in stable state order.              |
| `chatRequests`       | `list[ChatRequestReference]` | Open chat requests, oldest first.                   |

`NotebookReference` contains `path`, `available`, and `record`. It contains
`reason` when Lens could not inspect the active marimo runtime.

`record` is `None` when the Lens keeps no record. With `Lens(record=...)`, it
reports whether the Lens's [request record](../data-and-trust#request-record)
holds every resolved request:

| `status`  | Meaning                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saved`   | The record file holds every resolved request.                                                                                                                                    |
| `unsaved` | The notebook has no file name. Lens keeps resolved requests in memory.                                                                                                           |
| `session` | Lens keeps the record in memory until the runtime restarts. A `keep="session"` record always does, and a `keep="notebook"` record does in an app, in Pyodide, or outside marimo. |
| `failed`  | A write or read of the record file failed. Lens retries a write at the next resolution or `context()` call.                                                                      |

`unsaved`, `session`, and `failed` carry a `reason`.

Each `ChatRequestReference` contains `id`, `note`, `cells`, and `openedAt`.
`note` is the analyst's message as the agent quoted it to `open_request()`, and
`cells` are [cell references](#cell-references) for the cells the agent named.
When open chat requests exceed their 24,000-byte budget, Lens shortens the
notes of the oldest requests first.

## `SelectionReference`

| Key                  | Type                             | Meaning                                                          |
| -------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `id`                 | `str`                            | Stable selection ID used by `resolve()`.                         |
| `label`              | `str`                            | Stable human label in `S<n>` form.                               |
| `note`               | `str`                            | Person-authored text. No note is represented by an empty string. |
| `target`             | `SelectionTargetReference`       | Notebook or configured DOM target identity.                      |
| `cells`              | `list[CellReference]`            | Producing cells. See [cell references](#cell-references).        |
| `anchor`             | `Mapping[str, object]`           | Normalized point or region geometry.                             |
| `snapshot`           | `Mapping[str, object]`           | Selection-image status.                                          |
| `description`        | `Mapping[str, object]`, optional | Captured target label, detail, rendering reference, and media.   |
| `domHint`            | `Mapping[str, object]`, optional | Bounded description of the element at the point or region.       |
| `previousResolution` | `Mapping[str, object]`, optional | Prior result for the current reopened selection.                 |

`previousResolution` is projected for the current selection when it was
reopened from History, which a Lens shows with `Record(history=True)`. Other Open selections omit it even when they share the
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
DOM targets also contain `sources`: resolved notebook references with `cellId`
and `selector`. The selector is `None` for a cell output or cell-only metadata.
These references distinguish values defined by the same cell. They persist after
reopening; a fresh image has its own capture time. Sources identify dependencies,
not historical values. Inspect current values through the active notebook.

## Cell references

Each `CellReference` names one cell a selection or chat request points at:

| Key        | Type                                        | Meaning                                                                                          |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`       | `str`                                       | Cell ID.                                                                                         |
| `status`   | `"available" \| "missing" \| "unavailable"` | Whether the notebook has the cell now.                                                           |
| `codeHash` | `str \| None`                               | The cell's `code_hash` when the request opened. `None` when Lens read no code for the cell then. |

| Status        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `available`   | The current marimo graph contains the cell ID.                          |
| `missing`     | The runtime is available and the current graph does not contain the ID. |
| `unavailable` | Lens could not inspect the active runtime.                              |

`codeHash` is the `code_hash` that marimo's
[host protocol](https://github.com/marimo-team/marimo/blob/main/protocols/host/spec.md),
the API that marimo pair and the editor use, reports for each cell. Compare it
with the cell's current `code_hash`, as marimo pair's `view_notebook` shows it.
A different value means the cell changed after the analyst pointed at it, which
`check()` reports as `LV003`. Send `codeHash` as a run's `code_hash`
precondition, and the host refuses the run with a `conflict` once the code
moved on.

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
reference exceeds its shared budget, fitting drops optional DOM hints, target
descriptions, and snapshot failure reasons before shortening notes. Target identity, selection identity, and anchor geometry
remain intact.

## Captured target description

A selection can include `description`, containing `label`, optional `detail`,
optional `renderSource`, and optional `media`. The rendering reference contains
`path` and optional `line`, `column`, and `symbol`. `media` names the file the
target shows part of with `path`, at most 1,024 code units, an optional `page`
as a positive safe integer, and optional `start` and `end` as nonnegative
seconds, with `end` after `start`. Lens leaves out media that breaks these
rules and keeps the rest of the description. These are bounded client-supplied descriptions,
separate from runtime-derived notebook provenance. The record, History, and
reopen retain the creation-time description. Compact context may omit descriptions to fit its
byte budget, and standalone text reports truncation within its own budget.

See [Custom targets](../custom-targets) for runnable examples and [HTML
attributes](./attributes) for the DOM contract.

## Selection image status

The compact `snapshot` reference contains a `status` field:

| Status      | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| `pending`   | Browser capture has not completed.                                    |
| `available` | `context.images[id]` contains the current selection image.            |
| `outdated`  | `context.images[id]` contains the image from before the marker moved. |
| `failed`    | Capture failed and `context.images` has no image for the selection.   |

A `failed` snapshot also carries `error`, the reason capture failed, when the
browser reported one:

```json
{
  "status": "failed",
  "error": "Output contains media from another origin that cannot be captured"
}
```

Capture fails for content the browser keeps from Lens, such as an iframe from
another origin, or an image or video from another origin served without
[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS). The
selection keeps its note, target, and notebook context.

Image dimensions, hashes, and timestamps belong to private selection state and
browser transport. The public `images` mapping exposes validated bytes when
status is `available` or `outdated`.

## `previousResolution`

| Key          | Type            | Meaning                                            |
| ------------ | --------------- | -------------------------------------------------- |
| `resolvedAt` | `str`           | ISO 8601 time when the prior resolution committed. |
| `summary`    | `str`, optional | Prior resolution summary.                          |

A selection reopened from History carries this field. Its `resolvedAt` matches
the resolved request's `resolvedAt` in `history()`.

## `brief`

`context.brief` is the first read for the current request: the newest open
chat request when it opened after the current selection, or else the current
selection. It renders on first read, is cached, and holds at most 4,000
characters in this order:

1. The request label or ID, its channel, and the note.
2. The part: a point or region, the target, its captured description, and
   whether `context.images` holds the image the analyst saw.
3. The trace: each producing cell by ID and name, or by the names it defines
   when it has no name, with its state (`idle`,
   `stale`, `failed`, `queued`, `running`, or `disabled`), each source cell with
   its value selector, and the render source.
4. [Checks](./checks) on the current selection that the trace does not show,
   such as a producing cell that changed after the selection opened.
5. Earlier requests on these cells and the cells upstream of them, changes in
   force first, at most 8. A chat request that names no cells lists the
   notebook's recorded requests instead. An undone change names the request
   that undid it and the other cells that request changed. A Lens without a
   record has none, and the brief says the Lens keeps no record.
6. The other open requests in both channels, at most 8.
7. The Lens calls that fetch more, with the IDs and revision to pass. The list
   names `context.history()` only when the Lens keeps a record. When the brief
   exceeds its budget, the earlier sections shorten and this one stays whole.

```text
# Request S3 (selection)

Note: "Central looks off, can you check the returns?"

Part: a point on the output of its producing cell, "Revenue by region".
Image: the analyst's view is in context.images.

Trace:
- Cell `Hbol` (revenue_chart): stale

Earlier requests on these cells and upstream, changes in force first:
- S2 (selection, 2026-10-21 10:45) "Move net revenue into a function": in force on `MJUe` (net_revenue); in force on `bkHC` (defines net_by_store)
- S1 (selection, 2026-10-21 10:31) "Drop refunds": undone on `MJUe` (net_revenue) by S2, which also changed `bkHC` (defines net_by_store)

Next Lens calls:
- context.history(context.request): earlier requests on its cells and upstream, with the statements each undone change lost.
- context.images["9f2c..."]: the PNG the analyst saw.
- mounted.check() after editing: stale or failed outputs, changed cells, and record issues.
- mounted.reveal(...), then mounted.resolve(["9f2c..."], expected_revision=5, summary=...), with a summary of at most 240 characters.
```

The brief names cells by ID and name and values by variable name. It holds no
cell code, values, images, or control state. Cell names come from marimo's
notebook document, which marimo hands the kernel during a code-mode call. Lens
keeps the latest document per kernel, so names appear in every read after the
first code-mode call in that kernel. With no open request, the brief says so and shows how to open a chat
request.

## `history()`

`context.history(target=None) -> list[RecordedRequest]` joins the Lens's
[request record](../data-and-trust#request-record) with the notebook captured
by this context. It reads the record of a Lens built with `record`:

```python
lens = Lens(record=True)
```

A Lens built without one raises `LensError(code="record_off")`. Check
`lens.record`, `mounted.record`, or `context.references["notebook"]["record"]`
before calling it:

```python
if context.references["notebook"]["record"] is not None:
    print(context.history())
```

```python
context.history()  # every recorded request, newest 256
context.history("Hbol")  # requests on Hbol and the cells upstream of it
context.history(["Hbol", "MJUe"])  # requests on either cell or upstream
context.history(context.request)  # requests on the current request's cells
```

Name cells by ID or by [cell reference](#cell-references), alone or in a
sequence, or pass a reference that lists cells: `context.request`, a
`SelectionReference`, or a `ChatRequestReference`. Lens keeps the requests
whose changed or pointed-at cells are now those cells or their upstream
closure, or whose lost code now lives there. Rows come in resolution order and
are JSON-safe, so `pl.DataFrame(context.history())` builds a table. The first
call for a target computes the rows and later calls reuse them. An empty cell
ID or an empty sequence raises `ValueError`, and any other target type raises
`TypeError`.

Each `RecordedRequest` contains:

| Key          | Type                    | Source                                        | Meaning                                                     |
| ------------ | ----------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `id`         | `str`                   | Lens                                          | Selection ID or chat request ID.                            |
| `channel`    | `"selection" \| "chat"` | Lens                                          | How the request reached the agent.                          |
| `label`      | `str \| None`           | Lens                                          | The selection label. `None` for a chat request.             |
| `note`       | `str`                   | Stated by the analyst, or quoted by the agent | The selection's note, or the chat message the agent quoted. |
| `summary`    | `str \| None`           | Reported by the agent                         | The summary passed to `resolve()`.                          |
| `openedAt`   | `str`                   | Lens                                          | When the request opened or reopened.                        |
| `resolvedAt` | `str`                   | Lens                                          | When the request was resolved.                              |
| `cellIds`    | `list[str]`             | Observed                                      | Current cells the request pointed at.                       |
| `changes`    | `list[RecordedChange]`  | Observed                                      | Cells that changed while the request was open.              |
| `concurrent` | `list[str]`             | Lens                                          | Other requests open at the same time, in either channel.    |
| `image`      | `RecordedImage \| None` | Captured in the browser                       | The selection's annotated PNG. `None` for a chat request.   |

A `RecordedImage` holds `sha256`, `width`, `height`, `capturedAt`, `outdated`,
and `path`. `outdated` is true when the selection moved after the image was
taken, so its marker shows an earlier point or region. `path` is the PNG in
`__marimo__/lens/images/` when that file exists and matches its digest. It is
`None` when the record lives in memory: for a notebook without a file name, a
`keep="session"` record, a marimo app, and marimo's browser runtime. A record
built with `images=False` stores no PNG, so `image` is `None`. Open the file with your image reader to see
what the analyst marked:

```python
earlier = [row["image"]["path"] for row in context.history("Hbol") if row["image"]]
```

Each `RecordedChange` contains:

| Key        | Type                                  | Meaning                                                                                     |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `cellId`   | `str \| None`                         | The current cell that continues the changed cell. `None` when it is deleted or not located. |
| `name`     | `str \| None`                         | The cell name, when marimo reported one.                                                    |
| `status`   | `"in_force" \| "undone" \| "unknown"` | Whether the change still holds.                                                             |
| `undoneBy` | `str \| None`                         | For an undone change, the request ID that undid it, `"unrecorded"`, or `None` when unknown. |
| `missing`  | `list[str]`                           | Statements the request added that are gone from the cell, at most 8.                        |
| `restored` | `list[str]`                           | Statements the request removed that are back in the cell, at most 8.                        |
| `movedTo`  | `list[str]`                           | Other cells that now hold a missing statement or define a name the cell no longer defines.  |

A change is `in_force` while every statement the request added is still in its
cell at least as often as right after the request. An added assignment that a
later edit rewrote still holds while the variable it assigns still reads every
name the request wired into it, directly or through earlier lines in the cell,
so a later refactor that keeps a fix wired in keeps the fix in force. A request
that only removed statements holds while none of them come back. Otherwise it
is `undone`. It is `unknown` when
the record left out the code it needs, or when the snapshot cannot show where
the cell is now: the runtime is unavailable, the notebook has more than 1,000
cells, or the cell is missing from the graph outside a code-mode call, where
marimo hides cells whose code does not parse. Lens compares statements as Python
syntax trees without positions, so formatting and comments do not count. The
statements inside a function, loop, or condition count one by one, and a
compound statement counts by its header. Code that does not parse counts line
by line.

`undoneBy` names whoever began the current undone period: a later recorded
request whose change removed the statement, or `"unrecorded"` for an edit that
no recorded request made, such as an edit in the editor after the last
resolution. It is `None` when the record left out code from that period, so the
change may have been undone earlier. Lens follows requests in the order they
were resolved. A request that opened before the previous one on the same cell
was resolved started from older code, so only the code it left counts.

The status reports which statements exist in the cell. A statement left in an
unused helper still counts as present. A change that only
reorders statements adds and removes none, so it is `in_force`. The text inside
an `mo.sql` or `mo.md` string is part of one statement, so an edit inside it
replaces that whole statement.

marimo assigns cell IDs by position when it loads a notebook. Within the kernel
that recorded a request, Lens follows the changed cell by its ID. After a
restart, it follows the cell by its code: through later recorded changes, then
to the current cell with the same code or the most of its statements. When no
single cell continues it, the status is `unknown`.

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
`CellReference`, `SelectionReference`, `SelectionTargetReference`,
`RecordedRequest`, and `RecordedChange` for type checking. Read the [Python API reference](../api) for construction and method
contracts.
