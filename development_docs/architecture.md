# Architecture

`marimo-lens` turns a point or region in a
[marimo notebook](https://docs.marimo.io/) into a selection that
an agent can connect to its producing notebook cells. The person supplies the
visual referent and an optional note. Lens supplies the target identity,
bounded notebook context, and an optional selection image. The agent edits through the
active notebook integration, verifies the result, reveals it, and resolves the
selection. A Lens built with `Lens(record=True)` keeps the resolved request in
its record and shows it in History.

The public [Overview](../docs/overview.md) explains this workflow as a product.
This page defines the implementation model and routes maintainers to each
internal contract.

## The lifecycle of one selection

1. The browser locates a selectable target under the pointer or keyboard
   focus.
2. A point or rectangle becomes the selection anchor inside that target.
3. Python admits the selection into one revisioned `SelectionState` aggregate.
4. The browser attempts selection-image capture and sends its PNG bytes to
   Python when capture succeeds.
5. `Lens.context()` reads one private runtime snapshot and returns a detached
   `LensContext` with compact references, lazy standalone text, and available
   selection-image bytes.
6. A code-mode agent uses a `MountedLens` handle to show activity, inspect or
   edit the notebook, verify the result, and reveal the selected target.
7. `resolve()` closes chat requests and removes the resolved selections in
   one revisioned commit, then sends a `selection.resolved` event for the
   receipt. A Lens that keeps a record hands the record one line per
   resolved request, with the cells that changed since the request's
   baseline, before that commit. A Lens that shows History projects it from
   the record after the commit.

Each step has one owner. Cross-boundary data is bounded and validated before it
becomes authoritative.

## Core vocabulary

| Term               | Meaning                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Document           | One browser `Document` that displays Lens and selectable content. Each document has an opaque identity and a pathname.            |
| Target             | The rendered unit a person can select. A target is one notebook cell or one configured DOM root.                                  |
| Surface            | The current browser element found for a stored target. A target can remain stored while its surface is temporarily unavailable.   |
| Selection          | A target plus an anchor, optional note, DOM hint, stable ID and label, creation time, and selection image state.                  |
| Anchor             | Normalized point or rectangle geometry inside a target.                                                                           |
| DOM hint           | Bounded descriptive evidence about the element under the anchor, including labels, text, path, and bounds when available.         |
| Selection image    | Annotated PNG evidence captured for an open selection. Its wire field is named `snapshot`.                                        |
| Current selection  | The most recently activated open selection. It is the likely referent for requests such as “change this.”                         |
| Revision           | The monotonic number that guards a selection-state mutation against stale context.                                                |
| History entry      | One resolved request as the browser shows it from the record, with the record status of each change. It holds no PNG bytes.       |
| Request            | One instruction from the analyst, open until the agent resolves it. A selection is a request in the `selection` channel.          |
| Baseline           | The code of every notebook cell when a request opened or reopened. Lens compares it with the notebook at resolution.              |
| Record             | Resolved requests and the cells each one changed, kept when a Lens opts in with `record=`. The editor writes `__marimo__/lens/`.  |
| Runtime snapshot   | Private detached records read from the active marimo graph, cells, and relevant controls.                                         |
| `LensContext`      | A detached, revisioned agent handoff derived from selection state and one runtime snapshot. It does not update after creation.    |
| Attention address  | The tagged cell ID, or selection ID and revision, used by activity and reveal events.                                             |
| Resolution receipt | Transient browser acknowledgement for one atomic `resolve()` call. It can represent several resolved selections.                  |
| Browser view       | One rendered [AnyWidget](https://anywidget.dev/) view of a Python `Lens` model. A document grants one view interaction ownership. |
| `MountedLens`      | The agent-facing handle returned by `marimo_lens.agent.connect()`.                                                                |
| Automatic Lens     | The default Lens that marimo shows in its editor when the notebook creates none. `automatic_lens()` owns that decision.           |

Use `context` for a `LensContext` variable. Reserve `runtime snapshot` for the
private `RuntimeSnapshot` type. In prose, call `selection["snapshot"]` the
selection image status or image metadata.

## Five ownership rules

1. Python owns Lens-instance state. This includes open selections,
   selection-image bytes, request baselines, the record and its History
   projection, revision checks, runtime context, and the public API.
   `LensSession` runs every use case against two seams it does not
   implement: notebook reads (`NotebookReads`, implemented by
   `MarimoRuntimeAdapter`) and, when the Lens keeps a record, a `KeptRecord`
   whose `RecordStore` wraps a `Journal` (`FileJournal` or `MemoryJournal`).
   The `Lens` widget is the composition root: it normalizes `record=` to a
   `Record` or None, asks `MarimoRuntimeAdapter.storage()` where that record
   lives, binds it through `LensRuntime.record()`, builds the session, and
   translates browser messages into session calls. A host integration builds
   the same session with its own adapters.
2. The browser owns gestures, DOM access, selection-image composition, the
   dock, and transient activity, reveal, and resolution-receipt presentation.
3. Dependencies point from composition toward primitives. The Python build
   consumes the widget. The widget consumes image capture and protocol. Image
   capture consumes protocol.
4. Host access stays behind adapters. marimo runtime access belongs in
   `_marimo/`. Notebook DOM access belongs in
   `packages/widget/src/notebook/`.
5. Generated resources cross the language boundary through the build. StyleX
   extracts component styles, esbuild produces one ESM file and one stylesheet,
   and Hatch packages both resources and the Agent Plugin into the wheel and
   source distribution.

## Dependency graph

Arrows mean “depends on” or “builds from.”

```text
@marimo-lens/python
  -> @marimo-lens/widget
       -> @marimo-lens/image-capture
            -> @marimo-lens/protocol
       -> @marimo-lens/protocol
```

- `@marimo-lens/protocol` owns shared state contracts, private transport
  schemas, and bounded text primitives.
- `@marimo-lens/image-capture` owns document-aware DOM rasterization and PNG
  composition. It has no notebook graph or AnyWidget transport policy.
- `@marimo-lens/widget` owns AnyWidget transport, notebook host integration,
  selection interaction, the document-scoped dock, and transient presentation.
- `@marimo-lens/python` owns the public API, Lens-instance state, marimo runtime
  adaptation, agent connection, and packaged resources.
- `@marimo-lens/docs` consumes the built Python widget through interactive
  marimo examples. It is a delivery consumer, not part of the runtime package
  graph.

Cross-package TypeScript imports use package names. Python performs no DOM
queries. The browser performs no marimo graph reads.

## Python package layers

The `marimo_lens` package exports its public names from `__init__.py` and
`agent.py`. The private `_capability.py` module exposes the installed agent
briefing through marimo capability discovery. Runtime modules live in layers. A layer
imports only the layers listed above it in this table, and only `_marimo` and
`_widget` import marimo, AnyWidget, or traitlets.
`packages/marimo-lens/tests/test_package_layers.py` enforces both rules.

| Layer        | Owns                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| `_core`      | Public types including `Record`, `LensError`, `Rejection`, limits, and bounded scalars   |
| `_schema`    | Pydantic shapes for selections and History, shared by state and transport                |
| `_notebook`  | Detached runtime snapshots, statement splitting, provenance, and control serialization   |
| `_selection` | The revisioned `SelectionState` aggregate, selection images, and compact references      |
| `_record`    | Open requests, record lines, journals, the record file, record status, and History       |
| `_checks.py` | LV, LT, and LR diagnostics                                                               |
| `_context`   | `LensContext`, the brief, and standalone text                                            |
| `_session`   | `LensSession` use cases, the per-runtime `LensRuntime`, and its `RecordStore`s           |
| `_protocol`  | Validation of browser commands, responses, and events                                    |
| `_marimo`    | Kernel reads, creator-cell lifecycle, and the storage and journal for a `Record`         |
| `_widget`    | The `Lens` widget, argument validation, command dispatch, output capture, and the mounts |

`__main__.py` runs `python -m marimo_lens check` over `_marimo` and
`_checks.py`.

## Widget folders

`@marimo-lens/widget` keeps its source in folders under `packages/widget/src/`.
A folder imports only the folders listed above it, and the
`no-restricted-imports` rules in the root `vite.config.ts` enforce that order.

| Folder      | Owns                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `styles`    | StyleX tokens and shared style primitives                                                          |
| `anywidget` | The AnyWidget model, command transport, and output-capture transport                               |
| `notebook`  | Notebook DOM access, target identity, output roots, and the viewport                               |
| `ui`        | Theme, focus, anchored surfaces, the portal, the logo, and image object URLs                       |
| `selection` | The interaction reducer, selection actions, capture, and overlays                                  |
| `context`   | `LensContext`, its state, actions, and meta, and the indexed record                                |
| `history`   | History entries, the History list, earlier requests, and History images                            |
| `transient` | Activity, reveal, and resolution-receipt presentation                                              |
| `dock`      | The document-scoped dock, its position and motion, the Requests sheet, and the open-selection list |
| `app`       | View ownership, the Lens controller, and the composition into one view                             |

## State and data flow

```text
browser gesture
  -> validated command and optional PNG buffer
  -> Python LensSession transition
  -> synchronized _state trait
  -> browser views

Python selection state + marimo runtime snapshot
  -> LensContext references
  -> lazy standalone text
  -> read-only selection PNG mapping
  -> agent integration

agent feedback
  -> validated Python API call
  -> browser attention event
  -> transient activity or reveal
  -> revisioned resolve
  -> selection.resolved receipt
  -> record line, when the Lens keeps a record
  -> History entry, when the Lens shows History
```

The synchronized traits are projections of Python authority. A browser view
requests a transition with a command. Python restores `_state`, `_history`,
`_chats`, and `_selector` when a view writes them directly. `_history` is
null on a Lens that shows no History.

`useLensController` in `app` turns the traits and the interaction reducer into
one `LensContext` value with `state`, `actions`, and `meta`. Dock, History, and
receipt components read it with `useLens()`. Overlay and note components that
must work outside the dock take props.
PNG bytes travel through binary buffers and remain outside trait state,
standalone text, compact references, and local storage.

## Design decisions

### Trails are transient attention

Python normalizes single targets and ordered reveal steps into a Trail, sends one
`attention.reveal` event, and keeps one runtime lifecycle watch for validity. A
referenced cell or upstream rerun sends a matching `attention.trail.stop`.
Replacement attention and Lens close release the watch.

The browser owns the active Trail and step index, reusing target attention
for framing and the existing popover header for navigation. Next/previous and
dismissal are local. There is no catalog, synced trait, notebook serialization,
History entry, or dock tab for Trails.

### Python owns selection state

One Python aggregate gives browser views and agent calls the same revision,
selection order, and image lifetime. A successful mutation advances
the aggregate exactly once. Publication follows the commit, and a failed
publication leaves the committed aggregate in place for the next one to repair.

See [Selection state](selection-state.md).

### Targets identify rendered ownership

A notebook target identifies one cell. Its surface is the canonical output, or
the cell container when the cell renders no output. A configured DOM target
keeps a document-scoped selector and zero or more producing cells inferred from
published source records or nested `data-marimo-lens-cell-id` metadata. Value
references distinguish selectors from the same cell. Both retain the owning document identity
and pathname. The anchor narrows attention inside the target.

Lens records bounded DOM evidence and resolves a target to its producing cells
and the sources its author declares. It does not resolve a chart mark to data
rows, fields, or encodings. What a mark means is the agent's to interpret from
the image, the DOM hint, and the notebook.

See [Browser and host](browser-and-host.md).

### Context is detached and bounded

`Lens.context()` combines current selection state with one runtime snapshot.
Compact references build immediately. Standalone text builds on first access.
Each representation has its own limit and reports truncation where the contract
allows it.

See [Context and evidence](context-and-evidence.md).

### Presentation is transient

Activity, reveal, and the resolution receipt communicate agent progress without
becoming selection state. Resolve commits state before it sends the best-effort
resolution event. Each browser document projects a receipt for the resolved
targets it owns. A reveal can therefore finish before that document presents
the receipt.

See [Agent integration](agent-integration.md).

### Host dependencies stay replaceable

Private marimo and browser behavior is concentrated in narrow adapters. An
upstream replacement should change an adapter, its composition root, and its
contract tests while preserving the remaining state and protocol contracts.

See [Browser and host](browser-and-host.md), [Agent integration](agent-integration.md),
and [Protocol](protocol.md).

## Architecture pages

- [Selection state](selection-state.md) owns the authoritative aggregate and
  lifecycle transitions.
- [Context and evidence](context-and-evidence.md) owns runtime projection,
  provenance, controls, and image data.
- [Browser and host](browser-and-host.md) owns rendered targets, documents,
  capture, and presentation.
- [Agent integration](agent-integration.md) owns discovery, connection, and
  feedback boundaries.
- [Protocol](protocol.md) owns private messages and revision synchronization.
- [Build and distribution](build-and-distribution.md) owns generated and
  packaged artifacts.

Read [Testing](testing.md) before changing a boundary shared by more than one
package or runtime.
