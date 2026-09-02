---
title: Python API reference
description: Python API contracts for reading Lens requests and returning agent work for review.
---

# Python API reference

The Python API lets code-mode agents read the current selection, show their work
in the notebook, reveal a result, and complete a request.

The package exports `ActivityHandle`, `CellReference`, `Lens`, `LensContext`, `LensError`,
`LensReferences`, `NotebookReference`, `SelectionReference`,
`SelectionTargetReference`, and `__version__`. The version string comes from the
installed `marimo-lens` distribution metadata.

```marimo-config
requires-python = ">=3.10"
dependencies = [
    "marimo",
    "marimo-lens",
]
```

## Agent handoff adapter

`marimo_lens.agent` is the handoff interface for code-mode agents.
The package registers this module as the `lens` capability in the
`marimo.agent.capability` entry-point group. Its module help locates the Agent
Skill installed with the current package version.

Notebook cells mount Lens through the [public `Lens` API](#lens). Agent
integrations call the adapter from a live code-mode kernel call:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

ctx = cm.get_context()
mounted = lens_agent.connect(ctx)
snapshot = mounted.context()
```

### `agent_plugin() -> agent_plugins.Plugin`

Returns the Agent Plugin installed by the `marimo-lens` distribution. The
plugin contains the manifest, Lens skill, and every packaged skill resource.

### `agent_skill() -> agent_plugins.Skill`

Returns the packaged `marimo-lens` skill. Use `skill / "SKILL.md"` for its
instructions, `skill.body` for the Markdown body, and `skill.files` for its
resource inventory.

### `add_lens_cell(ctx) -> str`

Returns the notebook's agent-created Lens cell ID. With an existing generated
cell, the method returns that ID and queues no mutation. Otherwise, it queues a
collapsed cell that constructs and appends a Lens, then queues that cell to run.
The code-mode context applies a new cell when its async context manager exits.
The cell uses private bindings and introduces no public notebook definitions.

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as ctx:
    cell_id = lens_agent.add_lens_cell(ctx)
```

End the kernel call after adding the cell. Call `connect(ctx)` in a later call
after the browser renders Lens. `ctx` must expose `create_cell()` and
`run_cell()` as well as `cells.find()`. Other objects raise `TypeError`.
Several agent-created Lens cells raise `LensError(code="lens_ambiguous")`.

### `connect(context=None, *, identity=None) -> MountedLens`

Returns a Lens from the active marimo runtime. Pass a code-mode `context` to
include existing Lens objects from its kernel globals, including objects
created by authored notebook cells before browser-ready registration. When
`context` is omitted, discovery uses browser-ready Lens registrations. Pass an
earlier handle's `identity` to reconnect to that exact Lens in a later kernel
call.

`connect()` raises `LensError(code="lens_unavailable")` when the requested Lens
cannot be found. It raises `LensError(code="lens_ambiguous")` when several Lens
instances are available and no identity selects one. Reconnect with an identity,
or close or remove extra Lens instances.

A context without a globals mapping or a non-string identity raises `TypeError`.
An empty identity raises `ValueError`.

### `MountedLens`

The handle's `identity` property is an opaque, read-only string. Pass it to
`connect()` to reconnect to the same Lens in another kernel call. The
identity and Lens target remain fixed for the handle's lifetime.

| Member                                                                                          | Behavior                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `identity`                                                                                      | Reconnects to this Lens across kernel calls                  |
| `context()`                                                                                     | Returns the current detached `LensContext`                   |
| `cell_image(cell_id, *, expected_revision)`                                                     | Returns fresh cell PNG bytes after browser capture completes |
| `start_activity(target, *, expected_revision=None, duration_ms=None, label=None, message=None)` | Shows the current agent work target and returns its owner    |
| `stop_activity(activity)`                                                                       | Stops activity owned by that handle                          |
| `reveal(target, *, expected_revision=None, duration_ms, label=None, message=None)`              | Brings the addressed target into view                        |
| `resolve(selection_ids, *, expected_revision, summary=None)`                                    | Moves verified selections to History                         |

`context.images` maps selection IDs to annotated capture-time PNG bytes. The
matching selection reports `selection["snapshot"]["status"] == "outdated"`
when its marker changed after those bytes were captured. `cell_image()`
captures the current rendered output without Lens markers.

### `mounted.cell_image(cell_id, *, expected_revision) -> bytes | None`

Returns a fresh, unannotated PNG of `cell_id`. The first call starts browser
capture and returns `None`. End that kernel execution so marimo can deliver the
browser response, then repeat the call with the same cell and revision. The
completed call returns and consumes the PNG bytes.

```python
png = mounted.cell_image("BYtC", expected_revision=revision)
```

A call for another cell during capture raises `LensError(code="capture_busy")`.
Poll the first cell until it returns bytes or a terminal error, then request the
next cell. Other failures use `revision_conflict`, `runtime_unavailable`,
`cell_not_found`, `browser_unavailable`, `capture_timeout`,
`output_unavailable`, `capture_failed`, or `lens_closed`.

Write returned PNG bytes to a private temporary path when the agent image reader
requires one. The kernel and image reader must share a filesystem. Remove the
path after the final read.

The [Agent workflow](./agents) covers the complete handoff. The
[Overview demo](./overview#try-the-collaboration-loop) lets you call each
handoff method on a selectable chart.

## `Lens`

### `Lens(*, dom_selector=None)`

Creates a Lens for notebook outputs and optional DOM roots.

- `dom_selector`: A CSS selector for additional authored page roots. Each DOM
  selection records an opaque document ID, the current document path, an exact
  selector for the chosen element, and producer cell IDs inferred from nested
  `data-runtime-cell-id` metadata. Matching roots live in the widget owner's
  light DOM. Interactions inside their open shadow trees remain attached to the selected root.
  The selector accepts at most 1,024 UTF-16 code units.

An empty selector raises `ValueError`. A selector with another type raises
`TypeError`. The browser reports invalid CSS syntax when Lens mounts.

Mount one `Lens` through marimo:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep the mounted value available while calling its methods from other cells.

### `lens.context() -> LensContext`

Captures the current selection revision and one bounded snapshot of the marimo
runtime, then returns a detached `LensContext`.

```python
context = lens.context()
selection = context.current

if selection is not None:
    available_cells = [
        cell["id"] for cell in selection["cells"] if cell["status"] == "available"
    ]
```

A `LensContext` does not update. Call `lens.context()` again after the notebook
or its selections change.

Compact references and annotated images are ready when `context()` returns.
Standalone text renders and caches when `context.text` is first read from the
captured runtime snapshot.

`context()` raises `LensError(code="lens_closed")` after Lens closes. Contexts
created before closing remain readable.

### `lens.start_activity(target, *, expected_revision=None, duration_ms=None, label=None, message=None) -> ActivityHandle`

Marks `target` as the current work surface and returns the opaque owner accepted
by `stop_activity()`.

Pass a `SelectionReference` and its captured revision to address the selected
surface. Lens validates that the selection still exists at that revision. The
browser resolves its stored `SelectionTarget`, so DOM selections can have zero
or several producing cells and repeated projections remain distinct.

```python
context = lens.context()
selection = context.current

if selection is not None:
    activity = lens.start_activity(
        selection,
        expected_revision=context.revision,
        label="Updating aggregation",
        message="Updating the selected result.",
    )
```

Pass a cell ID string for notebook walkthrough activity that has no selection.
Lens validates cell IDs against the current marimo graph. `expected_revision`
is required for selection targets and optional for cell targets.

Activity preserves selection state. It keeps the current scroll position for a
visible target, frames an offscreen target, and re-resolves the surface after
document or layout changes. An unavailable selection target shows a bounded
notice in its owning document until the target returns. Other documents ignore
the event.

Each call creates a new activity owner and replaces the visible presentation.
A delayed stop for an earlier handle leaves newer activity intact.
`duration_ms=None` keeps activity visible until a matching stop, replacement,
or teardown. A positive integer up to 300,000 expires the activity after that
hold. `label` defaults to **Working** and accepts at most 40 UTF-16 code units.

Selection targets can raise `LensError` codes `revision_conflict`,
`selection_not_found`, or `lens_closed`. Cell targets can raise
`runtime_unavailable`, `cell_not_found`, `revision_conflict`, or `lens_closed`.
Browser delivery is best effort after validation succeeds.

### `lens.stop_activity(activity) -> None`

Sends a best-effort stop for one `ActivityHandle`. The browser clears activity
when the handle still owns the current presentation.

```python
lens.stop_activity(activity)
```

Pass the handle returned by `start_activity()`. Handles remain strings across a
JSON round trip. A non-current handle has no effect. A non-string value raises
`TypeError`, and an empty or oversized value raises `ValueError`. Closing Lens
before the stop raises `LensError(code="lens_closed")`.

### `lens.reveal(target, *, expected_revision=None, duration_ms, label=None, message=None) -> None`

Brings one stored selection or notebook cell into view for `duration_ms`.

```python
context = lens.context()
selection = context.current

if selection is not None:
    lens.reveal(
        selection,
        expected_revision=context.revision,
        duration_ms=10_000,
        label="Updated chart",
        message="Updated the aggregation and verified the selected result.",
    )
```

Selection reveal resolves the same stored `SelectionTarget` used for capture,
availability, and reattachment. Cell reveal accepts a cell ID string for
walkthroughs. `expected_revision` follows the same rules as
`start_activity()`.

`duration_ms` accepts a positive integer up to 300,000 milliseconds. Reveal
messages accept up to 1,000 UTF-16 code units. `label` accepts up to 40 UTF-16
code units. Reveal preserves keyboard focus and selection state. A later
attention event replaces the current presentation.

Wait for `duration_ms` before resolving the addressed selection. The browser
queues the resolution receipt until reveal exits. Selection and cell targets
raise the same validation errors listed for `start_activity()`.

### `lens.resolve(selection_ids, *, expected_revision, summary=None) -> int`

Moves one or more selections into addressed History against the revision
captured by `context()`, releases their annotated PNGs, and returns the resulting
revision.

```python
context = lens.context()
selection_ids = [
    str(selection["id"])
    for selection in context.references["selections"]
    if any(cell["id"] == "BYtC" for cell in selection["cells"])
]

if selection_ids:
    revision = lens.resolve(
        selection_ids,
        expected_revision=context.revision,
        summary="Updated the aggregation and verified the chart.",
    )
```

Pass one selection ID as a string or several unique IDs as a sequence. Lens
validates every ID before changing state. The batch receives one resulting
revision and one shared summary. A missing ID leaves the full batch open.

The expected revision prevents an integration from completing a selection
after the user has changed the selection state. Call `lens.context()` again
after `LensError(code="revision_conflict")`.

The state change commits before Lens sends the best-effort **Addressed**
presentation event. A browser delivery failure does not roll back the completed
selection. When a reveal is active, the browser holds the receipt until
the reveal exits so the two presentations remain sequential.

Expected `LensError.code` values are `lens_closed`, `revision_conflict`, and
`selection_not_found`.

### `lens.close() -> None`

Closes Lens, cancels pending full-cell capture, and releases Lens-owned
annotated images. Calling `close()` more than once has no effect.

Later calls to `context()`, `start_activity()`, `stop_activity()`, `reveal()`, and
`resolve()` raise `LensError(code="lens_closed")`.

## `LensContext`

`LensContext` is a detached snapshot with five main properties:

| Property     | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| `revision`   | Selection revision for a guarded `resolve()` call                 |
| `current`    | Current compact selection reference, or `None`                    |
| `references` | JSON-safe selection references for a live notebook integration    |
| `text`       | Bounded text for selected cells and their relevant upstream cells |
| `images`     | Read-only mapping from selection IDs to captured PNG bytes        |

Each compact selection reference includes its stable ID and label, note,
`target`, producing `cells`, point or region, and annotated image status.

`target.kind` is `notebook` or `dom`. Both variants carry the originating
document ID and path. Notebook targets carry one cell ID. DOM targets also
carry an exact DOM selector and zero or more inferred producing cell IDs.
Producer IDs are sorted and their order has no semantic meaning.

Each `CellReference` in `cells` contains `id` and `status`. Status is
`available` when the current graph contains the cell, `missing` when the runtime
is available and the ID is absent, and `unavailable` when Lens cannot inspect
the current marimo runtime.

## Typed context references

`LensContext.references` returns a `LensReferences` dictionary.
`LensContext.current` returns its current `SelectionReference`, or `None` when
no selection is current. These `TypedDict` contracts are exported from
`marimo_lens` for type checking and editor completion.

`LensReferences` contains:

| Key                  | Value                               |
| -------------------- | ----------------------------------- |
| `revision`           | Captured selection revision         |
| `generatedAt`        | Context generation timestamp        |
| `notebook`           | `NotebookReference` metadata        |
| `currentSelectionId` | Current selection ID, or `None`     |
| `selections`         | List of `SelectionReference` values |

`SelectionReference` contains `id`, `label`, `note`, a
`SelectionTargetReference` in `target`, `cells`, `anchor`, and `snapshot`.
`domHint` and `previousResolution` appear when that evidence is available for
the selection.

`CellReference` contains a producing cell `id` and its current runtime `status`.

`NotebookReference` contains `path` and `available`. It includes `reason` when
the active marimo runtime is unavailable.

Standalone text includes selected cell source, relevant upstream cell source,
definitions, references, direct parent IDs, notes, and safely displayable native
marimo control values. Passwords, file payloads, custom controls, AnyWidgets,
and opaque state render as `[redacted]` or `[unavailable]`.

## Selection PNG bytes

`context.images` contains successful capture-time PNGs indexed by selection ID.
The corresponding selection reference reports
`selection["snapshot"]["status"] == "outdated"` when the marker changed after
capture.

Render one captured image as a marimo output:

```python
import marimo as mo

context = lens.context()
png = context.images.get("selection-1")
mo.image(png, width=640, alt="Selected chart region") if png is not None else None
```

## `LensError`

Expected Lens operation failures raise `LensError`.

- `code` is the stable machine-readable failure code.
- `revision` is the current Lens selection revision, or `None` when connection
  failed before a Lens instance was available.

Invalid argument types and values raise `TypeError` or `ValueError` before a
Lens operation begins.

## Limits

| Resource                             | Limit                                      |
| ------------------------------------ | ------------------------------------------ |
| Open selections                      | 64                                         |
| Selection note                       | 4,000 UTF-16 code units                    |
| Cell ID or selection ID              | 128 UTF-16 code units                      |
| Configured or exact DOM selector     | 1,024 UTF-16 code units                    |
| Producing cell IDs per DOM target    | 64                                         |
| Activity or reveal label             | 40 UTF-16 code units                       |
| Activity message or resolve summary  | 240 UTF-16 code units                      |
| Reveal message                       | 1,000 UTF-16 code units                    |
| Reveal duration                      | 1 to 300,000 milliseconds                  |
| Selections per resolution            | 64 unique IDs                              |
| Active synchronized state            | 48,000 UTF-8 bytes                         |
| Addressed History                    | 64 items and 64,000 UTF-8 bytes            |
| Compact references                   | 60,000 UTF-8 bytes                         |
| Standalone text                      | 64,000 characters                          |
| Relevant runtime cells               | 64                                         |
| Reported omitted cell IDs            | 16 plus the exact omitted count            |
| Controls included in standalone text | 16                                         |
| One annotated PNG                    | 8 MiB, 2,048 pixels per edge, 4 megapixels |
| Stored annotated PNG bytes per Lens  | 64 MiB                                     |

A mutation that cannot fit the synchronized selection state or required
reference fields raises `LensError(code="selection_context_limit")` before the
state changes.
