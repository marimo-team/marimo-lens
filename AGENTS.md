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

- Python owns open selections, selection-image bytes, request baselines, the
  record and its History projection, runtime context, revision checks, and the
  public API. `_widget/lens.py` is the
  composition root. Inner Python layers import only the layers below them, as
  `packages/marimo-lens/tests/test_package_layers.py` enforces.
- The browser owns gestures, selection-image composition, notebook DOM access,
  the dock, and transient activity, reveal, and resolution-receipt presentation.
- `@marimo-lens/protocol` is the innermost TypeScript package.
  `@marimo-lens/image-capture` depends on it, and `@marimo-lens/widget`
  composes both packages.
- marimo runtime access stays in `_marimo/`. Notebook DOM access stays in
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

Unqualified Python paths in this table live in
`packages/marimo-lens/src/marimo_lens/`.

| Change                          | Primary source                                                                                 | Required companions                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Public Python API               | `__init__.py`, `_widget/lens.py`, `_widget/arguments.py`, `_context/lens_context.py`, `_core/` | Package README, API docs, and Python boundary tests                          |
| Selection lifecycle or History  | `_selection/`, `_record/history.py`, `_protocol/`, `packages/protocol/`, widget selection      | Python and browser contract tests, context projection, built assets          |
| Runtime context                 | `_notebook/`, `_marimo/`, `_context/`                                                          | Context, control, and runtime tests and the public context reference         |
| Request record and status       | `_core/record.py`, `_record/`, `_session/runtime.py`, `_checks.py`, `__main__.py`              | Record choice, record, journal, and check tests                              |
| Agent capture or feedback       | `_widget/capture.py`, `_protocol/`, widget anywidget and transient modules                     | Transport, image, agent, and browser checks, and built assets                |
| Browser interaction             | `packages/widget/src/` folders                                                                 | Owning package checks, tests, build, and real-browser evidence               |
| PNG composition                 | `packages/image-capture/`                                                                      | Image-capture tests and real-browser capture                                 |
| Documentation                   | `docs/` and `apps/docs/`                                                                       | Docs build, links, generated text views, desktop and narrow browser checks   |
| Bundling, packaging, or release | Vite, Hatch, workspace manifests, `Makefile`, and `scripts/`                                   | Built assets, `make package`, archive and shell checks, and contributor docs |

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

- A target is the selectable unit. Notebook targets identify one cell through
  its output, or through its cell container when it renders no output.
  DOM targets keep a document-scoped selector and producing cell IDs inferred
  from generic runtime metadata. Both variants keep the owning document ID and
  path. A point or region narrows attention inside the target.
- Open selections live in the Lens instance. Activity and reveal are transient.
  `Lens()` keeps no record, and resolve closes its requests with a receipt.
  `Lens(record=...)` normalizes to one `Record`, and resolve writes the
  requests to that record before closing them. History projects the record
  when `Record.history` is true, and reopen restores a recorded selection with
  fresh selection-image capture.
- The marimo dataflow graph supplies graph context. Compact references and lazy
  standalone text have independent bounds.
- PNG bytes stay outside trait state, JSON references, local storage, and
  standalone text. Cell-output capture is a one-use agent transfer.
- Selection mutations are revision checked. Python and TypeScript transport
  schemas remain aligned at protocol version 9.

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
