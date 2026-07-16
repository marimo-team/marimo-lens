# Architecture

`marimo-lens` turns a visual gesture on a rendered output into a durable,
cell-backed selection. The browser owns pointing, geometry, and optional PNG
capture. Python owns selection identity, current-selection state, image bytes,
marimo DAG context, and context export.

## Package graph

```text
anywidget-bundle npm ----+
                         v
@marimo-lens/widget --> @marimo-lens/python --> PyPI marimo-lens
                         ^                       |
anywidget-bundle PyPI ---+                       v
                                           marimo notebook
```

The npm `anywidget-bundle` package emits the manifest, bootstrap, app module,
chunks, and stylesheet. The PyPI package loads those artifacts and serves
manifest modules. Together they own module loading, bundle resource messages,
Blob URL cleanup, and development HMR.

`@marimo-lens/widget` is the browser application. It resolves the canonical
`output-<cell-id>` root, records a point or rectangle, commits the selection,
and captures a marked PNG in the background.

`@marimo-lens/python` is the composition root. It validates browser commands,
stores selection metadata and image bytes, reads the active marimo runtime,
resolves bounded DAG context, and returns `LensContext` snapshots.

The workbench contains browser acceptance fixtures. Output-specific code stays
in the workbench.

## Product boundary

The rendered output cell is the semantic unit. A point or rectangle is an
attention hint inside that unit. Lens records a bounded DOM hint as supporting
evidence and uses the marimo DAG as the source of code lineage.

One renderer-neutral path covers tables, charts, SVG, canvas, layouts, media,
and widgets. Artifact interpretation belongs to the consumer of the context.
The output cell source, definitions, references, and direct DAG parents form
the durable semantic contract.

## Public API

```python
from marimo_lens import Lens

lens = Lens()
context = lens.context()

context.current
context.references
context.text
context.images
```

`Lens()` accepts no public configuration. One displayed instance owns the
notebook's Lens state. `context()` returns a detached snapshot from one Python
selection revision and one current marimo runtime snapshot.

`LensContext.current` is the current selection reference, or `None` when no
selection exists. Creation, explicit activation, and note editing make a
selection current.
Deleting the current selection falls back to the most recently active remaining
selection.

## Consumer boundary

```text
lens.context()
    |
    +-- current -----> current-reference workflows
    +-- references --> live cell resolver, including marimo-pair
    +-- text --------> text-only agent or clipboard
    +-- images ------> optional vision input
```

A live consumer resolves each `outputCellId` through marimo's current dataflow
graph. marimo-pair evaluates `lens.context()` in the running kernel, reads the
compact references it needs, and queries upstream or downstream cells when the
request calls for them. Scratchpad state, edits, and agent lifecycle stay
outside Lens.

The text surface materializes bounded source, DAG edges, DOM hints, notes, and
current relevant control values. It remains complete when every note is empty
and every image is missing or failed. Successful PNGs provide additional
capture-time evidence.

## Interaction flow

1. The user presses **Select**.
2. Lens arms one selection gesture and exposes eligible output cells.
3. A click records a normalized point. A drag records a normalized rectangle.
4. Pointer release sends `selection.put` with an empty note and pending image
   state.
5. Python validates the command, allocates the next stable `S<n>` label, makes
   the new selection current, increments the revision, and publishes `_state`.
6. The browser returns to its resting state. The marker exposes local note and
   snapshot actions on hover or focus.
7. PNG capture runs in the background. A second `selection.put` stores either
   successful image metadata and one binary buffer or an explicit failure.
8. Activating a marker or list row sends `selection.activate`. List activation
   reveals the owning output cell before the mutation completes.
9. Editing a note sends `selection.put` while preserving the image.
10. `lens.context()` refreshes runtime provenance and returns current,
    references, standalone text, and successful image bytes.

Snapshot work never gates selection creation. A capture timeout, cross-origin
boundary, or unsupported browser surface changes image status while keeping the
cell reference available.

## Selection contract

A selection has:

- stable `id`
- server-owned stable `S<n>` label
- `outputCellId`
- normalized point or rectangle anchor
- optional note
- bounded DOM hint
- image status
- creation timestamp

New labels increase monotonically. Delete and clear preserve the next label so
a label burned into an existing image keeps its meaning.

Anchors use normalized output coordinates:

```text
point: { kind, x, y }
rect:  { kind, x, y, width, height }
```

Point coordinates and rectangle extents stay inside `[0, 1]`. Editing a note
preserves its image. Moving or resizing an anchor starts a replacement capture.
Image status is `pending`, `available`, `failed`, or `outdated`.

## Authoritative widget state

Python publishes one private trait:

```json
{
  "revision": 4,
  "nextLabel": "S5",
  "currentSelectionId": "selection-id",
  "selections": []
}
```

The browser treats this trait as a read-only projection. Each mutation carries
`expectedRevision`. Python rejects stale revisions before processing image
bytes. The browser waits for the authoritative trait revision before treating a
mutation as synchronized.

## Browser command protocol

Commands use `marimo-lens.command` version 1:

```json
{
  "protocol": "marimo-lens.command",
  "version": 1,
  "requestId": "request-id",
  "type": "selection.put",
  "payload": {}
}
```

Version 1 has one selection-first schema shared by the browser and Python
packages.

Supported command types are:

- `selection.put`
- `selection.activate`
- `selection.delete`
- `selections.clear`
- `context.export`
- `snapshot.get`

Every mutation includes `expectedRevision`. `selection.put` includes
`imageAction` with `preserve`, `replace`, or `clear`. `replace` carries exactly
one PNG buffer. The remaining actions carry zero buffers.

`context.export` accepts `current`, `references`, or `text`. The first two
formats return compact JSON. The text format returns the bounded standalone
context. `snapshot.get` accepts a selection ID and returns metadata plus the
exact stored PNG in one response buffer.

Responses use `marimo-lens.response` version 1 and always carry `requestId`,
`ok`, `revision`, and an object `payload`. Failed responses add an `error`
object with string `code` and `message` fields.

Bundle resource messages and Lens command messages share the anywidget custom
message channel. Their protocol envelopes remain independent.

## Context references

`LensContext.references` uses `marimo-lens.context` version 1. Its complete
top-level shape is:

```text
protocol, version, revision, generatedAt, notebook,
currentSelectionId, selections
```

Each selection carries its note, output cell ID, normalized anchor, bounded DOM
hint, status-only snapshot record, and live cell status. References exclude
source bodies, DAG snapshots, control values, image bytes, and ambient caller
identity.

`LensContext.text` renders the same selections with current relevant controls
and up to 64 cells in topological order. Each cell includes source, definitions,
references, and direct parent IDs. Control relevance follows referenced symbol
names. Controls defined by selected outputs rank first. Remaining controls rank
by nearest reference distance and runtime order.

`LensContext.images` contains one `SelectionImage` per successful or retained
outdated capture in selection order. `SelectionImage.selection_id` joins an
image to its reference and `SelectionImage.outdated` identifies retained
capture-time evidence.

## Python ownership

- `context.py` defines `LensContext` and `SelectionImage`.
- `widget.py` composes state, protocol, image storage, runtime reads, and export.
- `_runtime.py` reads current cells, direct DAG parents, and controls.
- `_provenance.py` resolves the bounded upstream closure.
- `_context.py` builds references and standalone text from one snapshot.
- `_images.py` validates and owns PNG bytes.
- `_protocol.py` parses commands and creates responses.

Graph operations and context rendering stay pure. Widget lifecycle code stays
in `widget.py`.

## Browser ownership

- `model.ts` reads authoritative `_state` and exposes protocol operations.
- `protocol.ts` owns request correlation and binary custom messages.
- `state.ts` owns the interaction reducer.
- `selection-actions.ts` owns serialized mutations and background capture.
- `capture/output-root.ts` resolves canonical marimo outputs.
- `capture/anchor.ts` maps pointer coordinates to normalized geometry.
- `capture/dom-hint.ts` records bounded capture-time evidence.
- `capture/image.ts` captures and composes marked PNG evidence.
- `reveal.ts` reveals the owning output for explicit list activation.
- `components/` owns the bottom-center dock, selection sheet, marker-local
  actions, exact snapshot preview, overlay, and note editor.

The browser performs no notebook graph work. Python performs no DOM work.

## Resource limits

The product contract fixes these limits:

- 64 selections
- 40,000 bytes across synchronized selection state
- 45,000 bytes per references object
- 64,000 characters per standalone text context
- 64 relevant cells
- 16 reported omitted cell IDs with an exact omitted count
- 24,000 source characters across standalone text
- 16 relevant controls
- 8,000 compact JSON characters across control state
- 512 inspected control-state nodes
- 16 definition cell IDs per control
- 1,000 characters per serialized control string
- 4,000 UTF-16 code units per selection note
- 240 UTF-16 code units per DOM text hint
- 2048 pixels per final image edge
- 4 megapixels per final image
- 8 MiB per PNG
- 64 MiB per Lens image store

Capture and provenance report explicit failure or truncation states when a
limit applies. Text section budgets keep every selection and relevant cell
reference represented while bounding notes, DOM evidence, controls, metadata,
and source independently.

## Artifact boundary

`anywidget.json` names the bootstrap, stylesheet, app module, and complete
module allowlist. Hatch packages that graph into the wheel and sdist. Building
a wheel from the sdist proves that the archive carries the browser application
required at runtime.
