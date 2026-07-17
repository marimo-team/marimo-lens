# marimo-lens

`marimo-lens` records point and region selections on rendered marimo outputs.
The browser resolves the owning output cell and captures optional marked PNG
evidence. Python returns compact live references and bounded standalone text
context.

## Commands

Use Node 22.18 or newer and the pnpm version declared in the root manifest.

| Purpose                  | Command                                                                               | Success                          |
| ------------------------ | ------------------------------------------------------------------------------------- | -------------------------------- |
| Install Python           | `uv sync --locked --all-packages --all-groups`                                        | workspace environment resolves   |
| Install JavaScript       | `pnpm install --frozen-lockfile`                                                      | all workspace packages resolve   |
| Check JavaScript         | `pnpm check`                                                                          | format, lint, and types pass     |
| Test JavaScript          | `pnpm test`                                                                           | widget tests pass                |
| Build JavaScript         | `pnpm build`                                                                          | packages and Python assets build |
| Check Python format      | `uv run --locked --all-packages --all-groups ruff format --check .`                   | no changes required              |
| Lint Python              | `uv run --locked --all-packages --all-groups ruff check .`                            | no diagnostics                   |
| Type-check Python        | `uv run --locked --all-packages --all-groups ty check packages/marimo-lens workbench` | no diagnostics                   |
| Cross-check Python types | `uv run --locked --all-packages --all-groups pyrefly check --min-severity warn`       | no diagnostics                   |
| Test Python              | `uv run --locked --all-packages --all-groups pytest -q packages/marimo-lens/tests`    | all tests pass                   |
| Full local gate          | `make check`                                                                          | every command above passes       |

Run `pnpm build` before Python tests. `Lens` loads the generated anywidget
manifest when its model is created.

## Workspace ownership

```text
anywidget-bundle (npm and PyPI)
        manifest build and module transport
                     |
                     v
packages/marimo-lens <---- packages/widget
Python API and wheel       output selection UI and PNG capture
          |
          v
      workbench
```

- `anywidget-bundle` owns app-agnostic anywidget bundling. Its npm package
  emits the bootstrap, app module, chunks, stylesheet, and `anywidget.json`.
  Its Python package serves manifest modules and owns the bundle lifecycle.
- `packages/widget/` owns output-cell interaction, normalized anchors, bounded
  DOM hints, asynchronous PNG capture, protocol requests, reducer state, and
  Lens dock presentation.
- `packages/marimo-lens/` owns the publishable Python distribution. Python
  validates selection commands, stores PNG bytes, reads the marimo runtime,
  resolves provenance, and returns `LensContext`.
- `workbench/` owns browser acceptance fixtures across output technologies.
- `development_docs/` contains contributor contracts. The root and package
  READMEs contain user workflows.

Cross-package TypeScript imports use package names. The Python composition
package consumes `@marimo-lens/widget` from this workspace, `anywidget-bundle`
from npm during Vite builds, and `anywidget-bundle` from PyPI at runtime. Keep
selection and capture logic within the marimo-lens packages.

The root `package.json`, `pnpm-workspace.yaml`, `vite.config.ts`, and
`tsconfig.json` own JavaScript orchestration and shared policy. Package
manifests own runtime dependencies, tests, packing, and final asset generation.
The root `pyproject.toml` is a virtual uv workspace. Python project metadata and
Hatch configuration live in `packages/marimo-lens/pyproject.toml`.

Read [Architecture](development_docs/architecture.md) before changing an
ownership boundary. Use [Development](development_docs/development.md) for
setup, watch mode, packaging, and browser checks.

## Product invariants

- A rendered output cell is the semantic notebook unit.
- A point or rectangle is an attention hint inside that output.
- Pointer release creates a selection immediately. A note is optional.
- Selection mode is one-shot and returns to rest after each gesture.
- A selection contains a stable id, stable `S<n>` label, optional note, output
  cell id, normalized anchor, bounded DOM hint, and image state.
- Deleting or clearing selections leaves allocated labels unused.
- Creation, explicit activation, and note editing make a selection current.
- Deleting the current selection selects the most recently active remaining
  selection.
- Snapshot capture runs after selection creation. Capture failure never blocks
  the cell-backed reference.
- Editing a note preserves its image.
- Moving or resizing a selection captures a replacement image.
- A missing output keeps its selection, note, snapshot, and actions available.
- The exact output cell ID reattaches a detached selection.
- The marimo DAG is the source of truth for cell lineage.
- `Lens.context()` refreshes runtime provenance for each call.
- `Lens.resolve()` removes one completed selection and its PNG against an
  expected revision.
- A resolution receipt is transient browser feedback.
- PNG bytes stay outside trait state, JSON references, local storage, and text
  prompts.
- `LensContext.references` contains selections and live output cell references.
- `LensContext.text` is complete text context for a text-only consumer.
- `LensContext.images` contains optional successful PNG captures.
- References and text budgets are independent.
- Control relevance follows referenced variable names.
- Runtime caller identity is not exported.
- Production selection follows one renderer-neutral output-root path.
- One displayed Lens instance owns one notebook's selection state.

## Public Python API

The top-level package exports `Lens`, `LensContext`, `LensError`, and
`SelectionImage`.

```python
import marimo as mo
from marimo_lens import Lens

lens = mo.ui.anywidget(Lens())
lens

context = lens.context()
context.revision
context.current
context.references
context.text
context.images

selection = context.current
if selection is not None:
    revision = lens.resolve(
        selection["id"],
        expected_revision=context.revision,
        summary="Updated the aggregation cell and verified the chart.",
    )
```

`lens.context()` returns one detached snapshot. `current` is the current
selection reference or `None`. `references` is a compact live contract. `text`
is a standalone contract. `images` contains successful and retained outdated
captures in selection order and may be empty. `Lens()` accepts no public
configuration.

`lens.resolve(selection_id, *, expected_revision, summary=None)` atomically
removes one active selection and its stored PNG, applies current-selection
fallback, and returns the resulting revision. `summary` is trimmed and bounded
to 240 UTF-16 code units. A conflict, missing selection, or closed widget
raises `LensError` with a stable `code` and the current `revision`. Failed
resolution leaves selection state unchanged.

Python modules have focused ownership:

- `context.py` owns public result types.
- `errors.py` owns `LensError`.
- `widget.py` owns AnyWidget lifecycle and composition.
- `_runtime.py` reads the active marimo runtime.
- `_provenance.py` resolves bounded DAG context.
- `_context.py` builds references and text.
- `_images.py` validates and stores PNG bytes.
- `_protocol.py` validates commands and responses.

## Browser protocol

The private `_state` trait has this shape:

```json
{
  "revision": 0,
  "nextLabel": "S1",
  "currentSelectionId": null,
  "selections": []
}
```

Commands use `marimo-lens.command` version 1 and always include `requestId`,
`type`, and an object `payload`. Supported command types are
`selection.put`, `selection.activate`, `selection.delete`, `selections.clear`,
`context.export`, and `snapshot.get`.

Version 1 has one selection-first schema. Keep one parser and one response
shape across Python and TypeScript.

Responses use `marimo-lens.response` version 1 and always include `requestId`,
`ok`, `revision`, and an object `payload`. Failed responses include an `error`
object with `code` and `message`.

Agent resolution sends a best-effort `marimo-lens.event` version 1 message with
type `selection.resolved`, the resulting revision, selection ID, stable label,
and optional summary. The event is transient and stays outside `_state`,
context packets, and image storage. Event delivery failure never rolls back a
resolution.

Every mutation carries `expectedRevision`. `selection.put` also uses
`imageAction` with `preserve`, `replace`, or `clear`. Reject stale revisions
before processing image bytes. `replace` sends exactly one PNG binary buffer.
The remaining actions send zero buffers. Keep command correlation and bundle
resource messages independent on the shared custom-message channel.

Python owns monotonic label allocation through `_state.nextLabel`. Advance it
after a successful new selection and keep it across delete and clear.

`context.export` accepts `current`, `references`, or `text`. `snapshot.get`
accepts one selection ID and returns the exact stored PNG in one response
buffer.

## Browser interaction

The Lens dock is fixed at bottom center. It opens as a stable action bar and
stays open until the user collapses it. Hover never changes its geometry. Its
primary controls are **Select**, the selection count, and collapse.

The collapsed state is a compact Lens tab with the selection count. **Select**
changes to **Click or drag** with an **ESC** affordance while armed. The
selection count opens the selection sheet.

Clicking creates a point. Dragging creates a rectangle. Use pointer capture for
the gesture. Resolve the output through `event.composedPath()` and the canonical
`output-<cell-id>` root. Keyboard users move between output cells and press
Enter to create a centered point. Escape cancels the active layer.

The selection sheet lists selections and offers **Add note** or **Edit note**,
exact snapshot preview, removal, and **Clear selections**. Explicit row
activation makes a selection current and reveals its output cell. Row focus
alone does not mutate state. A marker exposes local note and snapshot actions
on hover or focus. The note editor never gates selection creation.

A detached selection remains in the sheet with quiet `Output unavailable`
status. Activation keeps it current and announces the same status. The note,
snapshot, and removal actions remain available. A matching output cell ID
reattaches it. A resolution event removes the row and marker through canonical
state, then shows a compact receipt in the active dock surface for several
seconds.

Use a small reducer for idle, armed, dragging, and note-editing states.
Keep input text local to the note editor. Effects connect React to model
messages, DOM listeners, timers, browser APIs, and teardown.

Use marimo theme tokens and the design vocabulary from `marimo/DESIGN.md`:

- PT Sans for controls and labels
- Fira Mono for stable IDs and compact status text
- `#0880EA` as the primary selection color
- slate borders and quiet white or dark surfaces
- red for destructive or error states
- borders before shadows
- no decorative gradients

Use 150 to 200 ms ease-out transitions for transform and opacity. Pointer
tracking is immediate. Press feedback scales controls to `0.97`. Honor reduced
motion and coarse-pointer media queries. Gate hover styles behind fine-pointer
media queries. Use lucide icons when a matching icon exists.

## Image capture

Capture the full canonical output with the pinned `html-to-image` path and the
upstream marimo patch. Exclude every `[data-marimo-lens-ui]` node. Burn the
stable selection label and geometry into the returned PNG.

For oversized output, compose a scaled overview and a high-resolution crop in
one final image. Enforce 2048 pixels per edge, 4 megapixels, 8 MiB per image,
and 64 MiB per Lens image store.

Image status is `pending`, `available`, `failed`, or `outdated`.
Retain a prior successful PNG when its metadata becomes outdated and expose
that state through `SelectionImage.outdated`.

## Context export

`LensContext.references` uses `marimo-lens.context` version 1. Its top-level
fields are `protocol`, `version`, `revision`, `generatedAt`, `notebook`,
`currentSelectionId`, and `selections`. Each selection carries its note, output
cell ID, normalized anchor, bounded DOM hint, status-only snapshot record, and cell
status. Selection state has a 40,000-byte aggregate limit. Serialized references
have a 45,000-byte limit.

`LensContext.text` materializes context from the same runtime snapshot. It
contains selections, current relevant controls, and up to 64 cells in
topological order with source, definitions, references, and direct parent IDs.
Source shares a 24,000-character budget. It reports up to 16 omitted cell IDs.
Up to 16 controls share an 8,000-character compact JSON budget and a 512-node
collection budget. Each serialized control string and control cell ID list is
bounded. Selection notes are bounded to 4,000 UTF-16 code units. DOM text hints
are bounded to 240 UTF-16 code units. Complete text is bounded to 64,000
characters.

Text rendering preserves every selection and relevant cell reference, then
truncates notes, DOM evidence, control details, cell metadata, and source within
explicit section budgets.

`LensContext.images` contains one value for each successful or retained
outdated capture. Join images to selections through
`SelectionImage.selection_id`.

marimo-pair evaluates `lens.context()` in the live kernel and resolves each
`outputCellId` through `ctx.graph.cells` and queries graph neighbors when the
request needs them. Pair-specific scratchpad and edit operations remain outside
this package.

## Bundle resources

The generated manifest is the browser resource contract. `index.js` is the
self-contained anywidget bootstrap. `chunks/app.js` and every other manifest
module are served through the Python custom-message handler. The manifest is
the module allowlist.

These paths are generated:

- `packages/*/dist/`
- `packages/marimo-lens/src/marimo_lens/static/`
- `dist/`

Change source and rebuild. Hatch validates the manifest, bootstrap, app module,
and stylesheet before building a wheel or sdist. A wheel built from the sdist
must use the assets carried by that archive.

## Test design

- Test Python behavior through public imports, `Lens.context()`,
  `Lens.resolve()`, command responses, references values, image bytes, and
  built artifacts.
- Assert that references remain source-free and text remains complete with
  empty notes and no images.
- Check live Pair interoperability by resolving output cell IDs against the
  active marimo cell collection and DAG.
- Test TypeScript behavior through reducer state, output-root resolution,
  normalized geometry, immediate creation, background PNG composition,
  protocol requests, transient resolution events, and DOM behavior.
- Test each lifecycle transition and failure path through the boundary a
  consumer observes.
- Verify layout, overlays, focus, pointer behavior, responsive placement, and
  marked pixels in a browser.

## Browser validation

Run a fresh production-mode workbench:

```sh
env -u MARIMO_LENS_VITE_DEV_SERVER \
  uv run --locked --all-packages --all-groups \
  marimo run workbench/demo.py --port 28889 --headless
```

Use `agent-browser --session marimo-lens-e2e`. Exercise point and region
selections across text, table, Altair or Vega, Plotly, Matplotlib, generic SVG,
canvas, nested layouts, open shadow roots, scrollable content, and an external
iframe failure. Verify immediate commit, one-shot mode, note editing, current
selection, moving, resizing, deletion, clear, keyboard operation, output
reruns, output detachment and exact-ID reconnection, agent resolution receipts,
light and dark themes, narrow viewports, and reduced motion. Inspect console
and page errors. Close the browser session and stop the server after
validation.

For the Pair boundary, start the notebook with `marimo edit --headless
--no-token`, create selections through the browser, then evaluate
`lens.context()` through marimo-pair. Resolve every output cell and its
ancestors from the live kernel through `ctx.graph.cells` and
`ctx.graph.ancestors`. Assert that references contain no source,
control state, or PNG bytes. Verify text with image input omitted and repeat
with a failed capture. Record compact references bytes and text characters.

Apply and verify one notebook change through marimo-pair, then resolve its
selection through the helper with the captured revision. Verify the browser
removes the row and marker, updates the count, and shows the transient receipt.
Repeat after deleting the selected output cell. Confirm the detached reference
reports `cellStatus: "missing"` before resolution. Exercise a stale revision
and confirm the helper preserves the active selection.

Frontend changes require `pnpm check`, `pnpm test`, `pnpm build`,
`pnpm dlx react-doctor@latest . --verbose --scope changed`, and the browser
flow. Python changes require Ruff, ty, Pyrefly, and pytest. Cross-boundary
changes require `make check`, package archive validation, and browser evidence.
