# Architecture

`marimo-lens` turns a gesture on a rendered marimo output into a durable,
cell-backed selection. The output cell is the semantic unit. Point and region
geometry narrow human attention within that unit. The marimo dataflow graph
provides code lineage, and an optional marked PNG preserves capture-time visual
evidence.

The [package README](../packages/marimo-lens/README.md) owns the public Python
contract. This document owns package direction, state authority, private
transport, and host integration.

## Product boundary

Lens resolves one canonical `output-<cell-id>` root for text, tables, charts,
SVG, canvas, layouts, media, and widgets. It records a bounded DOM hint and
keeps renderer interpretation with the agent. Chart marks and arbitrary DOM
semantics remain outside the Lens model.

Human selections and their optional notes are durable attention. Marked
selection images are durable evidence. Agent-requested output capture,
activity, reveal, and resolution presentation are bounded transfers or
transient effects.

## Package graph

```text
@marimo-lens/protocol
├── @marimo-lens/image-capture
└── @marimo-lens/widget
    └── @marimo-lens/python
```

The widget also depends on image capture. The Python package bundles the widget
and publishes as `marimo-lens`.

- `@marimo-lens/protocol` owns shared state contracts, private browser
  transport schemas, and bounded text primitives.
- `@marimo-lens/image-capture` owns renderer-neutral evidence acquisition,
  rasterization, and PNG composition.
- `@marimo-lens/widget` owns AnyWidget transport, notebook host integration,
  selection interaction, the document-scoped dock, and transient effects.
- `@marimo-lens/python` owns the public API, durable state, runtime context,
  output-capture mailbox, and packaged browser resources.
- `examples/lens.py` is the product example.

Dependencies point toward the protocol package. Cross-package TypeScript
imports use package names. Python performs no DOM work, and the browser performs
no notebook graph work.

## State ownership

| State                                      | Authority                         | Lifetime                                           |
| ------------------------------------------ | --------------------------------- | -------------------------------------------------- |
| Open selections and marked PNG bytes       | Python `SelectionStore`           | Until delete, clear, resolve, or teardown          |
| Current selection and activation order     | Python `SelectionStore`           | Until activation or current-selection fallback     |
| Addressed selection receipts               | Python `SelectionStore`           | Until History clear, bounded eviction, or teardown |
| Selection gesture and sheet workflow       | Browser reducer                   | Current mounted owner view                         |
| Marked PNG capture job                     | Browser `SelectionCapture`        | Until commit, supersession, removal, or teardown   |
| Shared snapshot preview read               | Browser `SelectionSnapshotLoader` | While a preview holds a lease                      |
| Agent output-capture request and result    | Python `OutputCaptureMailbox`     | Until consumption, supersession, or teardown       |
| Active output raster                       | Browser output-capture transport  | Until reply, timeout, replacement, or teardown     |
| Cell activity, reveal, and receipt display | Browser transient effects         | Until replacement, presentation end, or teardown   |
| Request interpretation and notebook edits  | Agent client                      | Agent task                                         |

The synchronized `_state` trait projects open selections, addressed History,
the current selection, the next stable label, and the revision. Activation
order and PNG bytes remain in Python.

## Selection lifecycle

`SelectionState` is an immutable aggregate. Pure transitions validate a
revision and return the next aggregate. `SelectionStore.commit()` publishes one
trait value and restores the previous aggregate if publication fails. Each
successful selection mutation advances the revision once.

A new selection follows this sequence:

1. The user arms a one-shot selection session.
2. Pointer or keyboard input resolves the output and normalized point or
   region.
3. Pointer release sends `selection.put` with an empty note and pending snapshot
   state.
4. Python validates the expected revision and selection admission bounds.
5. Python commits the aggregate and publishes `_state`.
6. The browser returns to rest and starts marked PNG capture.
7. Successful capture replaces the pending snapshot with one validated PNG
   buffer. Failure records image status while preserving the cell-backed
   selection.

Each capture owns an `AbortController` and a commit fence. Replacement,
selection removal, output disappearance, and teardown abort affected work.
Note edits preserve the image. Moving or resizing the anchor marks the current
image outdated and starts replacement capture. A failed replacement retains the
outdated image.

A detached output keeps its cell ID, note, anchor, image, and actions. The same
cell ID reattaches it. Removing the current selection promotes the most recently
active remaining selection.

Resolve validates one or more selection IDs against one expected revision,
then releases their marked PNGs and appends their addressed receipts in one
commit. Every receipt in a batch shares the resulting revision and summary.
Reopen validates the selection ID and resolution revision, restores the
original attention as current, and starts fresh marked PNG capture. The History
receipt remains available. Clearing History preserves open selections and
their images.

## Runtime context

`Lens.context()` reads one bounded runtime snapshot for the union of selected
output closures. The marimo dataflow graph supplies current cells, source,
direct edges, and relevant native controls.

Compact references build immediately. Standalone text builds when
`LensContext.text` is first read. Each projection has an independent budget.
Bounds apply before expensive source and control reads when the host exposes
enough metadata. The [public API reference](../packages/marimo-lens/README.md#limits)
owns exact user-visible limits.

Context contains open selections. Addressed History stays outside references
and standalone text. A reopened current selection may include its prior
addressed timestamp and summary so an agent can understand the previous
attempt.

Marked selection images are exposed separately through `LensContext.images`.
PNG bytes never enter synchronized trait state, compact references, standalone
text, or local storage.

## Image paths

### Marked selection evidence

Selection capture resolves the canonical output root, excludes
`[data-marimo-lens-ui]`, composes the point or region annotation, and sends one
validated PNG buffer to Python. The image shares the selection lifecycle.

Raster work uses the output document. Visible documents wait for the next
animation frame with a bounded fallback. Hidden documents continue from the
current browser callback because background tabs can suspend animation frames.
Iframe accessibility is checked before and after rasterization.

### Agent output capture

Full-cell capture is a one-use agent transfer independent from selection state,
selection revision, and `LensContext`.

`OutputCaptureMailbox` accepts one pending request per Lens, correlates an
opaque request ID with the exact cell ID, and retains one terminal result until
the first terminal read. Reading pending state preserves the request. Reading
available or failed state consumes it. A new request can supersede an unread
terminal result. The request snapshots every open selection on that cell. The
browser draws those point and region markers into one overview raster.

The browser transport resolves the displayed Lens handler, enforces its raster
deadline, and replies with a validated PNG buffer or bounded failure. Pair
writes consumed bytes to a task-scoped temporary directory and removes that
directory after inspection.

## Agent feedback

`Lens.activity()` and `Lens.reveal()` validate exact graph membership, preserve
selection state, and send best-effort events.

Activity keeps the current scroll position and remains until a later activity,
reveal, or teardown replaces it. A short caller-supplied label can describe the
current task. Reveal replaces the active presentation, scrolls once, and exits
after its presentation. Both use one cell-attention controller.

Resolution commits one durable state transition before sending its best-effort
browser receipt. One receipt event can represent every selection in an atomic
batch. Event delivery failure never rolls back the committed selections.

## Notebook host integration

`NotebookDomAdapter` derives its document and window from the widget element's
`ownerDocument`. It owns output lookup, portals, focus restoration, viewport
work, cell attention, and layout observation.

`output-root-rules.ts` maps each supported host root to an exact cell ID and a
rendered element. The built-in rules cover `#output-<cell-id>`,
`marimo-island[data-cell-id]`, and
`[data-marimo-lens-output-cell-id="<cell-id>"]`. Selection, capture, output
availability, layout observation, and transient cell attention consume the
same resolved element.

Gesture targeting attaches to the active document, same-origin iframe
documents, and open shadow roots. One shared layout subscription coordinates
scroll, resize, output resize, and output-tree changes. Anchored surfaces use
that subscription for positioning and viewport clamping.

The first Lens view registered in a document owns interaction and portal
effects. Later views render the same conflict surface until ownership passes
after teardown. Another document has an independent owner registry.

## Private widget transport

Python and the browser exchange Lens messages through the AnyWidget custom
message channel. Commands, responses, and events carry a protocol
discriminator, version 1, a type, and a bounded payload. Correlated requests
also carry a request ID.

Selection and History mutations carry `expectedRevision`. Python validates
buffer cardinality before accepting image bytes. Selection image replacement
commands, snapshot responses, and successful full-cell captures carry one PNG
buffer. Other Lens messages carry none. Python and TypeScript schemas must
change together.

AnyWidget resource messages share the custom-message channel and use their own
discriminator. The Lens parser ignores them.

## Host adapter seams

Lens keeps host-specific behavior behind narrow seams that can be replaced by
native marimo or anywidget contracts.

| Capability                   | Lens seam                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Widget-aware disposal        | `Lens._bind_comm_close()`                                                                             |
| Native control state         | `_marimo_control_state.py`                                                                            |
| Exact-cell navigation        | `packages/widget/src/notebook/notebook-dom.tsx` and `packages/widget/src/transient/cell-attention.ts` |
| Canonical output capture     | `packages/widget/src/notebook/output-root.ts`, `NotebookDomAdapter`, and `@marimo-lens/image-capture` |
| Browser-to-Python invocation | `packages/widget/src/anywidget/request-client.ts`                                                     |

Native adoption should replace one seam at a time while preserving the public
Python API and the remaining transport contracts.

## Artifact boundary

`packages/marimo-lens/src/marimo_lens/static/widget.js` and `widget.css` are the
packaged browser resource contract. esbuild bundles the widget and its
dependencies into the ESM file. Hatch validates and packages both files into
the wheel and source distribution.

A wheel built from the source distribution must load the browser resources
carried by that archive.
