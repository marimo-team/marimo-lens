# AGENTS.md

Guidance for coding agents working in this uv, pnpm, and Vite+ monorepo.
`marimo-lens` records point and region attention on notebook outputs or
configured DOM roots and exposes bounded selection and graph context to agents.

## Build, test, and lint commands

Use the Node and pnpm versions declared in `package.json`.

| Purpose                | Command                          | Expected result                 |
| ---------------------- | -------------------------------- | ------------------------------- |
| Install Python         | `uv sync --locked`               | Workspace environment resolves  |
| Install JavaScript     | `pnpm install --frozen-lockfile` | Workspace packages resolve      |
| Check JavaScript       | `pnpm check`                     | Format, lint, and types pass    |
| Test JavaScript        | `pnpm test`                      | Package tests pass              |
| Build workspace        | `pnpm build`                     | Packages and docs build         |
| Test Python            | `uv run pytest -q`               | Python tests pass               |
| Check shell scripts    | `shellcheck scripts/*.sh`        | Shell diagnostics are clear     |
| Build documentation    | `make docs`                      | VitePress site builds           |
| Validate distributions | `make package`                   | Wheel and source archive pass   |
| Run local gate         | `make check`                     | Repository checks pass in order |

Build the browser assets before Python tests. `Lens` loads the generated
`widget.js` and `widget.css` files when its model is created.

## Architecture in five rules

- Python owns Lens-instance selections, History entries, selection-image bytes, runtime
  context, revision checks, and the public API. `widget.py` is the composition
  root.
- The browser owns gestures, selection-image composition, notebook DOM access,
  the dock, and transient activity, reveal, and resolution-receipt presentation.
- `@marimo-lens/protocol` is the innermost TypeScript package.
  `@marimo-lens/image-capture` depends on it, and `@marimo-lens/widget`
  composes both packages.
- marimo runtime access stays in `_marimo_runtime.py` and
  `_marimo_control_state.py`. Notebook DOM access stays in
  `packages/widget/src/notebook/`.
- esbuild bundles the widget into one ESM file and one stylesheet. Hatch
  packages both files into the wheel and source distribution.

Read [Architecture](development_docs/architecture.md) before changing an
ownership boundary.

## Dependency rule

Dependencies point from composition toward primitives. The Python build
consumes the widget, the widget consumes image capture and protocol, and image
capture consumes protocol. Keep cross-package TypeScript imports
package-qualified. Keep DOM work out of Python and marimo graph work out of the
browser. Reject reverse package imports and direct host access outside the
runtime and notebook adapters.

## Change routing

Unqualified Python filenames in this table live in
`packages/marimo-lens/src/marimo_lens/`.

| Change                          | Primary source                                                                 | Required companions                                      |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Public Python API               | `widget.py`, `context.py`, `errors.py`                                         | Package README, API docs, and Python boundary tests      |
| Selection lifecycle or History  | `_selection_state.py`, `_protocol*.py`, `packages/protocol/`, widget selection | Python and browser contract tests, context, built assets |
| Runtime context                 | `_runtime.py`, `_marimo_*.py`, `_provenance.py`, `_context.py`                 | Context tests and public context reference               |
| Agent capture or feedback       | `_output_capture.py`, `_protocol*.py`, widget anywidget and transient modules  | Transport tests, image tests, and built assets           |
| Browser interaction             | Widget `app/`, `notebook/`, `selection/`, `transient/`, `ui/`, and `styles/`   | Owning package checks, tests, and build                  |
| PNG composition                 | `packages/image-capture/`                                                      | Image-capture checks and tests                           |
| Bundling, packaging, or release | Vite, Hatch, workspace manifests, `Makefile`, and `scripts/`                   | Built assets, archive checks, and contributor docs       |

## Conventions

- Workspace policy belongs in root manifests. Package dependencies and scripts
  belong in the package that consumes them.
- Test through public APIs, transport envelopes, trait state, image bytes,
  browser state, and built artifacts. Avoid private-helper assertions and CSS
  literal checks.
- Use marimo theme tokens, PT Sans for controls, Fira Mono for stable IDs, and
  `#0880EA` for selection emphasis. Reserve red for destructive and error
  states. Prefer borders to shadows and avoid gradients or hover-driven
  geometry changes.
- Edit source and rebuild generated paths: `packages/*/dist/`,
  `packages/marimo-lens/src/marimo_lens/static/`, and `dist/`.

## Key invariants

- A target is the selectable unit. Notebook targets identify one output cell.
  DOM targets keep a document-scoped selector and producing cell IDs inferred
  from generic runtime metadata. Both variants keep the owning document ID and
  path. A point or region narrows attention inside the target.
- Open selections live in the Lens instance. Activity and reveal are transient.
  Resolve moves one or more Open selections into bounded metadata-only History,
  and reopen restores the original attention with fresh selection-image capture.
- The marimo dataflow graph supplies graph context. Compact references and lazy
  standalone text have independent bounds.
- PNG bytes stay outside trait state, JSON references, local storage, and
  standalone text. Cell-output capture is a one-use agent transfer.
- Selection mutations are revision checked. Python and TypeScript transport
  schemas remain aligned at protocol version 6.

## Validation

- Run focused package checks while iterating and `make check` before handoff.
- Run the owning package check, test, and build commands after TypeScript
  changes.
- Run `make package` after changes to bundling, packaging, or release files.

## Reference

- [Python API](docs/api.md) owns the public API. The package README is the PyPI entry point.
- [Architecture](development_docs/architecture.md) owns state, package,
  transport, and host boundaries.
- [Maintainer documentation](development_docs/README.md) routes setup, checks,
  packaging, dependencies, documentation, and release.
