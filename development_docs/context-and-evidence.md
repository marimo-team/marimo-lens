# Context and evidence

`Lens.context()` returns one detached `LensContext` built from the current
selection aggregate and one read of the active
[marimo](https://docs.marimo.io/) runtime. The context gives
an agent three representations of the same selected work:

- Compact JSON-safe references.
- Lazy standalone text with bounded source and control state.
- Annotated selection images as PNG bytes.

The representations have independent limits and lifetimes. Reading one does
not widen another.

## Context construction

`Lens.context()` follows this sequence:

1. Read the current immutable `SelectionState` under the Lens lock.
2. Prioritize producing cell IDs from the current selection, then the remaining
   open selections.
3. Read a private `RuntimeSnapshot` from the active marimo kernel.
4. Build compact references immediately.
5. Copy stored selection image bytes into the context mapping.
6. Store a callable that builds standalone text on the first `context.text`
   read.

The returned context does not update. Read a fresh context after notebook state,
selection state, or runtime controls change.

`LensContext.revision` identifies the captured selection aggregate.
`LensContext.current` resolves `currentSelectionId` inside the captured
references. It returns `None` when no open selection was captured.

## Runtime snapshot

`MarimoRuntimeAdapter` concentrates private marimo kernel access. It reads:

- The notebook filename.
- Exact graph cell membership.
- Cell source, definitions, references, language, direct parents, runtime state,
  run result, and stale state when available.
- Relevant native marimo controls and AnyWidget identities.

The adapter reads the graph under its host lock when one is exposed. Host-owned
descriptors are treated as fallible. A missing package, absent kernel context,
missing graph, invalid graph mapping, or failing host attribute produces an
unavailable runtime snapshot with a bounded reason.

Cell IDs requested by current selections receive priority. The adapter computes
their upstream closure before it reads retained cell source and controls. It
caps the retained closure and reports omitted IDs and counts.

Runtime access belongs in:

- `packages/marimo-lens/src/marimo_lens/_marimo_runtime.py`
- `packages/marimo-lens/src/marimo_lens/_marimo_control_state.py`

Detached record types belong in `_runtime.py` and `_control_state.py`. Keep
marimo imports and private descriptor access out of context projection and the
browser packages.

## Compact references

`LensContext.references` contains:

- The captured revision and generation time.
- Notebook pathname and runtime availability.
- Current selection ID.
- One reference for every open selection.

Each selection reference preserves admission data:

- Selection ID and stable label.
- Note.
- Target kind, document identity, pathname, and producing cell IDs.
- Exact DOM selector for a configured DOM target.
- Current runtime status for each producing cell.
- Anchor geometry.
- Selection image status.
- Optional DOM hint.
- Optional previous resolution for the current reopened selection.

Target identity, selection identity, geometry, and producing cell IDs remain
intact. Reference fitting first shortens notebook path and runtime reason, then
removes optional DOM hints, then shortens notes. It processes secondary
selections before the current selection.

History entries stay outside compact references. A DOM target with no
producing cell still returns its document locator, exact selector, DOM hint,
note, anchor, and selection image status.

## Standalone text

`LensContext.text` builds at first access and is cached on that context. It
contains:

1. Notebook identity and runtime availability.
2. Every open selection with its target, note, producing-cell statuses, anchor,
   document pathname, DOM hint, and image status.
3. Relevant current controls.
4. Producing cells and retained upstream cells in topological order.
5. Explicit notices for omitted cells, truncated source, omitted controls, and
   incomplete control state.

Producing cells are mandatory evidence when they are available. Upstream cells
use the remaining cell and source budgets. Source allocation follows relevance
order so a distant large ancestor cannot consume a producing cell's entire budget.

History entries and PNG bytes never enter standalone text.

## Control selection

Lens considers graph-relevant marimo UI elements and
[AnyWidget](https://anywidget.dev/) values. It ranks
controls defined by a producing cell first, followed by referenced controls in
upstream distance and runtime order.

Control capture uses a conservative display policy:

- A native marimo UI value can be included when its metadata is complete and
  its frontend value is a supported scalar or scalar sequence.
- Direct password controls are sensitive and render as redacted.
- Composite controls, non-native UI objects, and incomplete metadata remain
  opaque.
- AnyWidget identity can be reported, but synchronized AnyWidget state remains
  sensitive.
- Nested values are bounded by item count, depth, node count, string length,
  and encoded character count.
- Attribute, collection, and mapping reads can execute application code. Lens
  catches failed reads and reports bounded unavailable or opaque descriptions.
- Lens excludes itself from the captured control inventory.

Keep the safety policy in `_marimo_control_state.py` and the renderer-neutral
bounded serialization in `_control_state.py`. A new control kind needs tests for
identity, value visibility, sensitive values, incomplete metadata, failing
descriptors, and budget behavior.

`RuntimeSnapshot` records `control_truncated_output_ids` and
`control_incomplete_output_ids`, but `build_context_lazy()` does not currently
project those collection-stage signals into `LensContext.text`. A failed or
truncated control lookup can therefore be absent from the final limit notice.
Preserve these fields until the context builder can report them end to end.

## Selection images

`LensContext.images` maps selection IDs to PNG bytes for open selections whose
image status is `available` or `outdated`. These bytes are copied from the
Python selection records into a read-only mapping for the context lifetime.

Selection image capture:

1. Resolves the target surface and the element under the anchor.
2. Excludes `[data-marimo-lens-ui]` descendants.
3. Captures an overview of the complete target.
4. Adds a detail raster for large or scrolled content when needed.
5. Draws the point or rectangle and `S<n>` label in the relevant raster.
6. Encodes and hashes a bounded PNG.
7. Sends metadata and one binary buffer to Python.

The `capturedAt` metadata value records when capture starts. It is not a
completion timestamp.

The image belongs to the open selection lifecycle. Note edits preserve it.
Anchor or DOM-hint changes make it outdated. Delete, clear, resolve, close, and
teardown release it.

## Cell-output images

`MountedLens.cell_image()` provides a separate one-use transfer of the current
canonical notebook output. It does not read the stored selection image and does
not draw Lens markers.

One `OutputCaptureSlot` exists per `Lens`:

1. The first call validates the revision and graph cell, sends a browser
   request, and returns `None`.
2. The browser captures the canonical output and replies with a validated PNG
   or bounded error.
3. A later call with the same cell and revision returns and consumes the PNG
   bytes when available.
4. The same call remains pending while the browser works.
5. A different cell receives `capture_busy` while the slot is pending.
6. A new revision supersedes an obsolete pending record.
7. A terminal read releases the slot for the next cell.

The browser deadline is 15 seconds. The Python slot deadline is 20 seconds, so
the browser has time to send its bounded terminal response before Python marks
the request stalled.

## Data and trust boundary

Lens handles notebook source, rendered output, DOM text, control values, and
captured pixels. Treat all of them as notebook data.

- A configured DOM root authorizes selection and capture inside that root.
- Open shadow-root content can be inspected and captured with its host target.
- Same-origin iframe documents can become interaction and capture surfaces.
- Cross-origin iframe bodies cannot be inspected or rasterized.
- External images, fonts, styles, and iframe resources can require browser
  network access and cross-origin permission during rasterization.
- DOM hints are descriptive locator evidence. They are not a replacement for
  pixel inspection when the task depends on appearance.
- A code-mode agent can receive cell source, supported control values, DOM
  hints, and PNG bytes. The active integration owns how those values leave the
  kernel.
- Temporary files created for an image reader must be private and removed after
  use. The kernel and image reader must share the filesystem.

Do not weaken redaction, cross-origin checks, byte validation, or context bounds
to make one renderer easier to capture.

## Limits

The public [resource limits table](../docs/reference/errors.md#resource-limits) owns exact user-visible
values. Internal owners include:

| Limit group                                                          | Source                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| Identifiers, notes, labels, messages, selectors, and protocol values | `_protocol_models.py` and `packages/protocol/src/contracts.ts` |
| Selection and History encoded state                                  | `_selection_state.py`                                          |
| Compact references                                                   | `_references.py`                                               |
| Relevant cells and source                                            | `_provenance.py`                                               |
| Controls and serialized values                                       | `_control_state.py`                                            |
| Standalone text sections                                             | `_text_context.py`                                             |
| One PNG and total stored PNG bytes                                   | `_images.py` and `packages/image-capture/src/evidence/png.ts`  |

Change a public limit in its source owners, both schema languages when
applicable, boundary tests, and `docs/reference/errors.md` in one patch.

## Source map

| Concern                             | Source                                                          |
| ----------------------------------- | --------------------------------------------------------------- |
| Compose `LensContext`               | `packages/marimo-lens/src/marimo_lens/_context.py`              |
| Public context types                | `packages/marimo-lens/src/marimo_lens/context.py`               |
| marimo graph and runtime adaptation | `packages/marimo-lens/src/marimo_lens/_marimo_runtime.py`       |
| Detached runtime records            | `packages/marimo-lens/src/marimo_lens/_runtime.py`              |
| Provenance closure and ranking      | `packages/marimo-lens/src/marimo_lens/_provenance.py`           |
| marimo control adaptation           | `packages/marimo-lens/src/marimo_lens/_marimo_control_state.py` |
| Bounded control serialization       | `packages/marimo-lens/src/marimo_lens/_control_state.py`        |
| Compact references                  | `packages/marimo-lens/src/marimo_lens/_references.py`           |
| Standalone text                     | `packages/marimo-lens/src/marimo_lens/_text_context.py`         |
| Python PNG validation               | `packages/marimo-lens/src/marimo_lens/_images.py`               |
| Browser raster and composition      | `packages/image-capture/src/evidence/`                          |
| Cell-output mailbox                 | `packages/marimo-lens/src/marimo_lens/_output_capture.py`       |
