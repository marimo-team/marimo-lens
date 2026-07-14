# marimo-lens

`marimo-lens` is a marimo-aware anywidget for collecting precise notebook
feedback. Python discovers notebook state and lineage. The React widget selects
visible targets and records annotations. The exported packet gives an agent the
target cells, defs, refs, control values, widget state, and DOM evidence needed
to edit the notebook.

## Commands

Use Node 22.18 or newer and the pnpm version declared in the root manifest.

| Purpose                  | Command                                                                               | Success                          |
| ------------------------ | ------------------------------------------------------------------------------------- | -------------------------------- |
| Install Python           | `uv sync --locked --all-packages --all-groups`                                        | workspace environment resolves   |
| Install JavaScript       | `pnpm install --frozen-lockfile`                                                      | all workspace packages resolve   |
| Check JavaScript         | `pnpm check`                                                                          | format, lint, and types pass     |
| Test JavaScript          | `pnpm test`                                                                           | widget and bundle tests pass     |
| Build JavaScript         | `pnpm build`                                                                          | packages and Python assets build |
| Check Python format      | `uv run --locked --all-packages --all-groups ruff format --check .`                   | no changes required              |
| Lint Python              | `uv run --locked --all-packages --all-groups ruff check .`                            | no diagnostics                   |
| Type-check Python        | `uv run --locked --all-packages --all-groups ty check packages/marimo-lens workbench` | no diagnostics                   |
| Cross-check Python types | `uv run --locked --all-packages --all-groups pyrefly check --min-severity warn`       | no diagnostics                   |
| Test Python              | `uv run --locked --all-packages --all-groups pytest -q packages/marimo-lens/tests`    | all tests pass                   |
| Full local gate          | `make check`                                                                          | every command above passes       |

Run `pnpm build` before Python tests. `Lens` loads the generated anywidget
manifest when a model is created.

## Workspace ownership

```text
packages/anywidget-bundle
        manifest, chunk transport, lifecycle, Vite plugin
                     |
                     v
packages/marimo-lens <---- packages/widget
Python API and wheel       React UI and selection
          |
          v
      workbench
```

- `packages/anywidget-bundle/` owns app-agnostic anywidget bundling. It emits
  the bootstrap, app module, chunks, stylesheet, and `anywidget.json`. It also
  owns browser module loading, custom-message transport, and development HMR.
- `packages/widget/` owns the React application, Zustand workflow state,
  selection plugins, chart-part adapters, model synchronization, and styles.
- `packages/marimo-lens/` owns the publishable Python distribution. Its Python
  code collects marimo runtime context and serves bundle modules. Its Vite
  config is the composition root that combines the widget and bundle plugin.
- `workbench/` is the browser acceptance fixture. Keep demo-specific values and
  presentation out of the reusable packages.
- `development_docs/` contains contributor contracts. The root `README.md` and
  package README contain user workflows.

Cross-package TypeScript imports use package names. The Python composition
package depends on `@marimo-lens/widget` and
`@marimo-lens/anywidget-bundle`. The widget and bundle packages remain
independent. Keep product selection logic out of the generic bundle package.

The root `package.json`, `pnpm-workspace.yaml`, `vite.config.ts`, and
`tsconfig.json` own JavaScript orchestration and shared policy. Package
manifests own runtime dependencies, tests, packing, and final asset generation.
The root `pyproject.toml` is a virtual uv workspace. Python project metadata and
Hatch configuration live in `packages/marimo-lens/pyproject.toml`.

Read [Architecture](development_docs/architecture.md) before changing an
ownership boundary. Use [Development](development_docs/development.md) for
setup, watch mode, packaging, and browser checks.

## Runtime contracts

### Python collection

`Lens()` is the primary API. It scans the active marimo runtime, dataflow graph,
globals, display cells, controls, anywidgets, traitlets state, and visible
targets. The supported extension surface is `include`, `exclude`, `targets`,
`target`, `ml.context`, `ml.targets`, `ml.inspectors`, `ml.charts`,
`ml.selection`, and `ml.pair`.

The marimo DAG is the lineage source of truth. Preserve real cell ids, defs,
refs, display provenance, and related cell ids. Python chart integrations use
`ml.charts.adapter(...)` and `ml.charts.Inspector(adapters=[...])` through
`Lens(inspectors=[...])`.

### Browser selection

Selection is plugin-like. New behavior belongs in a focused adapter or parser
with explicit `selectionEvidence`. Use the shadow DOM utilities for open shadow
roots. Chart targeting tries library adapters before generic SVG, canvas, and
visual fallbacks.

Shared workflow state belongs in Zustand. Component state is reserved for
input state local to one component. Effects connect React to model listeners,
DOM listeners, timers, browser APIs, and teardown. Derived values stay in
rendering code or `useMemo`.

Use `@/` imports inside `packages/widget`. Keep CSS tokens and local class names
under `packages/widget/src/styles`. Use lucide icons for controls that have a
matching icon.

### Feedback

`lens.pair_feedback` is the machine-readable packet.
`lens.pair_prompt` is the paste-ready form. Copying feedback refreshes the
Python context so current controls, traits, globals, and graph state reach the
packet. Collected context is trusted notebook data and stays intact.

### Bundle resources

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

- Test Python behavior through the public `marimo_lens` API, trait values,
  feedback packets, bundle messages, and built artifacts.
- Test TypeScript behavior through widget state, selection results, bundle
  lifecycle, module transport, Vite output, and DOM behavior.
- Keep each test focused on one supported contract. Avoid assertions on CSS
  literals, private helper trivia, fixture class names, or generated formatting.
- Verify visual spacing, overlays, hover behavior, responsive layout, and
  canvas targeting in a browser.
- Keep comments for lifecycle ordering, invariants, serialization boundaries,
  generated artifacts, external runtime behavior, and bailout reasons.

## Browser validation

Run the workbench:

```sh
uv run --all-packages --group workbench marimo run workbench/demo.py --port 28889 --headless
```

Use `agent-browser --session marimo-lens` for UI work. Check the dock, popover,
hover card, lineage regions, dataframe columns, Altair or Vega, Plotly,
Matplotlib, generic SVG, canvas coordinates, open shadow roots, feedback
capture, and refreshed pair packets. Inspect console and page errors. Close the
browser session and stop local servers after validation.

For frontend changes, run `pnpm check`, `pnpm test`, `pnpm build`,
`pnpm dlx react-doctor@latest . --verbose --scope changed`, and the relevant browser
flow. For Python changes, run Ruff, ty, Pyrefly, and pytest. Cross-boundary
changes require the full `make check` gate and browser validation.
