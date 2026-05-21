# marimo-lens Agent Guide

## Purpose

`marimo-lens` is a marimo-aware anywidget for collecting precise, agent-ready
feedback from a live notebook. A default `Lens()` should need no manually passed
inputs: it scans the active marimo runtime, notebook dataflow graph, globals,
display cells, UI controls, anywidgets, traitlets state, and visible DOM targets.

The widget is meant to be useful to both a human reviewer and an agent. Its
output must be rich enough to pipe back into `marimo-pair`: target cells,
defs/refs, display provenance, selected DOM evidence, chart/column/widget
context, current control state, and a concise instruction packet.

## Architecture Principles

- This is a greenfield project. When assumptions change, make the new shape
  explicit and delete the old path. Do not add compatibility shims, migration
  branches, deprecated aliases, broad `**kwargs` catch-alls, or removed-API
  adapter errors.
- Breaking refactors are preferred over carrying historical API contracts.
  Update notebooks, tests, docs, workbench examples, and generated artifacts to
  the new contract in the same change.
- Keep the public API ergonomic. `Lens()` is the primary path; `include`,
  `exclude`, `targets`, `target`, `ml.context`, `ml.targets`,
  `ml.inspectors`, `ml.charts`, `ml.selection`, and `ml.pair` are the
  supported extension surface. Treat whole-pipeline replacement as internal
  implementation detail.
- Treat the marimo DAG as the source of truth for lineage. Prefer real
  `defs`, `refs`, display cell ids, and related cell ids over metadata blobs.
- Keep the React surface composable. Avoid large stateful components; move
  behavior into focused hooks, small components, and Zustand store actions.
- Use `@/` TypeScript path aliases. Do not add new relative import ladders.
- Keep selection plugin-like. New targeting behavior should be a small adapter
  or parser with explicit evidence, not a special case embedded in UI code.
- Preserve a clean greenfield shape. Do not add compatibility shims, legacy
  aliases, re-export layers, transition modules, or old-API error wrappers.
- Separate generic logic from demo/workbench wiring. Workbench examples prove
  behavior; they must not leak into the core runtime.
- Rebuild bundled widget assets after frontend changes. `src/marimo_lens/static`
  is a generated distribution surface and must match `js/`.

## Frontend Standards

- State management belongs in Zustand when it is shared or workflow-level.
  Component-local `useState` is fine only for truly local input state.
- Follow React best practices: derived values should usually be calculated
  during render or with `useMemo`, not synchronized through `useEffect`.
- Effects are for external systems: DOM listeners, timers, model sync,
  browser APIs, and cleanup-bound subscriptions.
- Use lucide icons for controls when an icon exists.
- Use CSS tokens and local class names under `js/styles/`. Keep z-index values
  centralized as variables and verify overlays against marimo controls.
- The popover, hover card, dock, markers, and lineage hints must stay subtle,
  legible, and non-overlapping on desktop and mobile.

## Selection And Context

- Selection must work across normal DOM, marimo tables, chart renderers, and
  open shadow roots. Use the shadow-DOM utilities before adding DOM traversal.
- Column targeting should inspect semantic table/grid attributes, headers,
  `data-column` style attributes, and point-based shadow traversal.
- Chart targeting should prefer library-specific adapters first, then generic
  SVG/canvas/visual fallback behavior.
- Python chart library support belongs to the inspector system: implement
  `ml.charts.adapter(...)`, then pass
  `ml.charts.Inspector(adapters=[...])` through `Lens(inspectors=[...])`. Do
  not add chart-specific constructor shortcuts.
- Generic SVG parsing should infer semantic scene parts from structure:
  explicit roles/classes/ARIA, aligned tick labels and tick marks, legend
  swatch-label pairs, marks, traces, titles, annotations, and `data-*` datum
  evidence. Use outside projects such as `uwdata/divi` only as conceptual
  inspiration; reimplement locally.
- Every annotation should preserve enough `selectionEvidence` for an agent to
  understand why Lens selected that target.

## marimo-pair Feedback Contract

- `lens.pair_feedback` is the machine-readable packet.
- `lens.pair_prompt` is the paste-ready form of the same packet.
- Copying feedback should refresh Python-side context first so sliders,
  dropdowns, anywidget traits, globals, and graph snapshots are current.
- Do not redact collected context. The project assumes trusted notebooks,
  trusted local machines, and trusted agent sessions.
- Keep packet wording direct and actionable. It should identify target cells,
  target variables, selected chart/column/widget parts, DOM evidence, and
  suggested marimo-pair edit boundaries.

## Development Flow

Install dependencies:

```sh
uv sync --dev
pnpm install
```

Run the workbench:

```sh
uv run marimo run workbench/demo.py --port 28889 --headless
```

Frontend watch mode:

```sh
pnpm run dev
```

Prefer small, behavior-shaped changes:

- Read the current module before editing.
- Add or update focused tests around the behavior you changed.
- Keep generated static assets in sync by running the frontend build or full QA.
- Do not leave marimo servers or browser sessions running after validation.

## Required QA Gates

Before handoff after meaningful changes, run the full stack unless there is a
clear, stated blocker:

```sh
uv run ruff format
uv run ruff check
uv run ty check
uv run pytest
pnpm run fmt
pnpm run qa
pnpm dlx react-doctor@latest . --verbose --diff
```

What these cover:

- `ruff format` and `ruff check`: Python formatting and linting.
- `ty check`: Python type checking.
- `pytest`: Python API, protocol, inspector, packaging, and context tests.
- `pnpm run fmt`: Oxfmt over the configured frontend/config/docs surfaces.
- `pnpm run qa`: Oxfmt check, Oxlint, TypeScript, Vitest, and esbuild bundle.
- `react-doctor`: React-specific quality scan.

For frontend-only edits, `pnpm run qa` and React Doctor are mandatory. For
Python-only edits, the `uv run ruff`, `uv run ty`, and `uv run pytest` gates are
mandatory. For cross-boundary widget work, run everything.

Never claim success from only a plausible code path. Report any skipped gate
with the exact reason.

## Browser Validation With agent-browser

Use `$agent-browser` for UI, widget, overlay, selection, z-index, and workbench
behavior. Static tests are not enough for visual/runtime behavior.

Core workflow:

```sh
agent-browser --session marimo-lens open http://localhost:28889
agent-browser --session marimo-lens wait --load networkidle
agent-browser --session marimo-lens snapshot -i
# interact using refs or coordinates
agent-browser --session marimo-lens snapshot -i
agent-browser --session marimo-lens close
```

Use `agent-browser eval --stdin` for complex DOM inspection to avoid shell
quoting problems.

Always use `--session marimo-lens` for this project so browser state is isolated
and repeatable. Do not replace real agent-browser validation with a
fixed-sleep DOM smoke script; write down the browser steps and evidence instead.

Representative checks after UI/selection changes:

- Lens dock renders above marimo controls and can be dragged.
- Popover is not hidden by marimo chrome and stays within viewport bounds.
- Hover highlight, subtle DAG lineage regions, and hover card render without
  incoherent overlap.
- Dataframe/table column selection works.
- Altair/Vega, Plotly, Matplotlib, and generic SVG chart parts resolve.
- Shadow-DOM anywidget headers and nested controls resolve through open shadow
  roots.
- Feedback popup records the selected target and chart/column/widget context.
- Copy/scan refreshes context and the pair packet includes current control and
  anywidget state.

For canvas or spatial chart behavior, use coordinates and DOM `getBoundingClientRect`
through `agent-browser eval`; accessibility snapshots often cannot see canvas
internals.

## Workbench Expectations

`workbench/demo.py` is the living acceptance fixture. Keep it representative:

- marimo UI controls
- dataframes and summary dataframes
- Altair/Vega chart output
- generic SVG chart output
- custom anywidgets with nested open shadow roots
- Lens mounted as `mo.ui.anywidget(Lens())`
- visible pair-feedback preview

When adding a new selection class, add a workbench example if unit tests cannot
exercise the browser/runtime behavior convincingly.

## Dependencies

- Use `uv add --group dev ...` for Python dev tools.
- Use `pnpm add` / `pnpm add -D` for frontend packages.
- Prefer robust, focused packages when they remove real implementation risk.
  Do not add a dependency for a tiny helper or to avoid understanding the local
  code.
- Keep dependency additions reflected in lockfiles and verified by QA.

## File Ownership Hints

- Python public export barrel: `src/marimo_lens/__init__.py`
- Python widget API: `src/marimo_lens/widget.py`
- Internal Python collection pipeline: `src/marimo_lens/_pipeline.py`
- Python notebook/runtime collection: `src/marimo_lens/context.py`
- Python target collection and wrapper: `src/marimo_lens/targets.py`
- Python object inspectors and chart adapters: `src/marimo_lens/inspectors/`
- Python chart adapter protocol: `src/marimo_lens/inspectors/charts/`
- Python metadata envelope helpers: `src/marimo_lens/metadata.py`
- marimo-pair packet formatting: `src/marimo_lens/_pair_feedback.py`
- React entrypoint and model sync: `js/widget.tsx`, `js/hooks/use-lens-model.ts`
- Shared frontend state: `js/store.ts`
- Overlay, dock, popup, identity UI: `js/components/`
- Selection registry and plugins: `js/selection/`
- Chart adapters/parsers: `js/selection/chart-parts/`
- Styling: `js/styles/`
- Browser/runtime fixture: `workbench/demo.py`
- Python tests: `tests/`
- Frontend tests: `js/**/*.test.ts`
