# Architecture

`marimo-lens` turns a point or region in a
[marimo notebook](https://docs.marimo.io/) into a selection that
an agent can connect to its producing notebook cells. The person supplies the
visual referent and an optional note. Lens supplies the target identity,
bounded notebook context, and an optional selection image. The agent edits through the
active notebook integration, verifies the result, reveals it, and resolves the
selection into History.

The public [Overview](../docs/overview.md) explains this workflow as a product.
This page defines the implementation model and routes maintainers to each
internal contract.

## One selection from gesture to History

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
7. `resolve()` removes the open selection, releases its image bytes, and appends
   a History entry in one revisioned commit.

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
| History entry      | Metadata recorded when an agent resolves an open selection. History entries contain no PNG bytes.                                 |
| Runtime snapshot   | Private detached records read from the active marimo graph, cells, and relevant controls.                                         |
| `LensContext`      | A detached, revisioned agent handoff derived from selection state and one runtime snapshot. It does not update after creation.    |
| Attention address  | The tagged cell ID, or selection ID and revision, used by activity and reveal events.                                             |
| Resolution receipt | Transient browser acknowledgement for one atomic `resolve()` call. It can represent several History entries.                      |
| Browser view       | One rendered [AnyWidget](https://anywidget.dev/) view of a Python `Lens` model. A document grants one view interaction ownership. |
| `MountedLens`      | The agent-facing handle returned by `marimo_lens.agent.connect()`.                                                                |

Use `context` for a `LensContext` variable. Reserve `runtime snapshot` for the
private `RuntimeSnapshot` type. In prose, call `selection["snapshot"]` the
selection image status or image metadata.

## Five ownership rules

1. Python owns Lens-instance state. This includes open selections, History,
   selection-image bytes, revision checks, runtime context, and the public API.
   `packages/marimo-lens/src/marimo_lens/widget.py` is the Python composition
   root.
2. The browser owns gestures, DOM access, selection-image composition, the
   dock, and transient activity, reveal, and resolution-receipt presentation.
3. Dependencies point from composition toward primitives. The Python build
   consumes the widget. The widget consumes image capture and protocol. Image
   capture consumes protocol.
4. Host access stays behind adapters. marimo runtime access belongs in
   `_marimo_runtime.py` and `_marimo_control_state.py`. Notebook DOM access
   belongs in `packages/widget/src/notebook/`.
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

## State and data flow

```text
browser gesture
  -> validated command and optional PNG buffer
  -> Python SelectionStore commit
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
  -> History entry
```

The synchronized trait is a projection of Python authority. A browser view can
request a transition, but it cannot replace `_state` or `_selector` directly.
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
selection order, History, and image lifetime. A successful mutation advances
the aggregate exactly once. Publication failure restores the prior aggregate.

See [Selection state](selection-state.md).

### Targets identify rendered ownership

A notebook target identifies one cell. Its surface is the canonical output, or
the cell container when the cell renders no output. A configured DOM target
keeps a document-scoped selector and zero or more producing cells inferred from
published source records or nested `data-marimo-lens-cell-id` metadata. Value
references distinguish selectors from the same cell. Both retain the owning document identity
and pathname. The anchor narrows attention inside the target.

Lens records bounded DOM evidence. Renderer-specific chart marks and
application semantics remain with the agent or host integration.

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
