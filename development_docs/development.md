# Development

Set up the uv and pnpm workspaces, build the browser resources, and run the
example notebook before changing Lens behavior.

Read [Architecture](architecture.md) for the ownership model. Use
[Testing](testing.md) to choose the checks required by a change.

## Prerequisites

| Tool                                                 | Project contract                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Python](https://www.python.org/)                    | `.python-version` selects Python 3.12 for local development. The package supports Python 3.10 through 3.14. |
| [uv](https://docs.astral.sh/uv/)                     | Resolves the Python workspace, runs Python tools, and builds distributions.                                 |
| [Node.js](https://nodejs.org/)                       | The root manifest requires Node.js 24 or newer.                                                             |
| [pnpm](https://pnpm.io/)                             | Use the Corepack-managed version declared in the root `package.json`.                                       |
| [ShellCheck](https://www.shellcheck.net/)            | Required after changing `scripts/*.sh`. CI runs it for every change.                                        |
| Git and [GitHub CLI](https://cli.github.com/manual/) | Required for the release workflow. Release commands require authenticated repository access.                |

Enable the repository pnpm version, then install both workspaces:

```sh
corepack enable
uv sync --locked
pnpm install --frozen-lockfile
```

CI installs Node.js and pnpm from the root manifest through the shared
`.github/actions/setup-js` action. Vite+ comes from the frozen workspace install.

Install the Chromium browser used by the end-to-end suite:

```sh
pnpm --filter @marimo-lens/e2e install-browser
```

The installs can access package indexes. Dependency age gates and the patched
image dependency are documented in [Dependencies](dependencies.md).

## Build the browser resources

`Lens` loads generated `widget.js` and `widget.css` files when its Python model
is created. Build them before Python tests or the example notebook:

```sh
pnpm --filter @marimo-lens/python build
```

esbuild writes the resources to
`packages/marimo-lens/src/marimo_lens/static/`. The directory is generated and
ignored by Git. Edit the TypeScript and CSS sources, then rebuild it.

## Reach first success

Run the example notebook:

```sh
uv run marimo run examples/lens.py --port 28889 --headless
```

Open the printed local URL. The notebook should display the Lens dock. Press
**Select**, then click a point or drag a region on rendered output. The new
selection should appear in the **Open** list with an image status.

If Python reports missing `widget.js` or `widget.css`, rebuild
`@marimo-lens/python` and restart the notebook process.

## Watch mode

Start the browser build in one shell:

```sh
pnpm dev
```

Start the example notebook in another:

```sh
uv run marimo run examples/lens.py --port 28889 --headless
```

esbuild writes `widget.js` and `widget.css` after each source change. AnyWidget
watches both files and reloads the displayed widget.

Restart the notebook when a Python module, package dependency, or environment
change cannot be picked up by the current kernel.

## Contributor loop

1. Identify the owning package and contract in the change table.
2. Reproduce the current behavior through the nearest public or runtime
   boundary.
3. Make the smallest source change that preserves the ownership rules.
4. Run the owning package check, test, and build commands.
5. Rebuild the Python browser resources before Python integration tests.
6. Verify browser-visible changes in a real browser.
7. Run `make check` before handoff. Run `make package` when distribution
   contents or build behavior changed.

| Change                          | Primary source                                                                         | Required companion evidence                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Public Python API               | `widget.py`, `context.py`, `errors.py`                                                 | API docs and Python boundary tests                                         |
| Selection lifecycle or History  | `_selection_state.py`, `_protocol*.py`, `packages/protocol/`, widget selection modules | Python and browser contract tests, context projection, rebuilt assets      |
| Runtime context                 | `_runtime.py`, `_marimo_*.py`, `_provenance.py`, `_context.py`                         | Context, control, and runtime tests                                        |
| Agent capture or feedback       | `_output_capture.py`, `_protocol*.py`, widget AnyWidget and transient modules          | Transport, image, agent, and browser checks                                |
| Browser interaction             | Widget `app/`, `notebook/`, `selection/`, `transient/`, `ui/`, and `styles/`           | Widget tests, build, and real-browser evidence                             |
| PNG composition                 | `packages/image-capture/`                                                              | Image-capture tests and real-browser capture                               |
| Documentation                   | `docs/` and `apps/docs/`                                                               | Docs build, links, generated text views, desktop and narrow browser checks |
| Bundling, packaging, or release | Build files, manifests, `Makefile`, and `scripts/`                                     | Rebuilt assets, `make package`, shell checks, and contributor docs         |

## Focused commands

Use package filters while iterating:

```sh
pnpm --filter @marimo-lens/protocol check
pnpm --filter @marimo-lens/protocol test
pnpm --filter @marimo-lens/image-capture test
pnpm --filter @marimo-lens/widget check
pnpm --filter @marimo-lens/widget test
pnpm --filter @marimo-lens/widget build
```

Build the Python browser resources before focused Python tests:

```sh
pnpm --filter @marimo-lens/python build
uv run pytest -q
```

Run the repository gate before handoff:

```sh
make check
```

`make check` validates the lockfile, checks and tests the TypeScript workspace,
builds packages and documentation, checks Python formatting and types, runs
Python tests, runs the Chromium end-to-end suite and ShellCheck, and checks
whitespace. Run `make package` separately for distribution changes.

Run the shell check after changing release scripts:

```sh
shellcheck scripts/*.sh
```

See [Testing](testing.md) for the complete test and CI matrix.

## Documentation and packaging

Serve or build the public site with:

```sh
make docs-serve
make docs
```

Read [Documentation](documentation.md) before changing public pages,
interactive examples, navigation, or brand assets.

Build and validate the Python archives with:

```sh
make package
```

This command replaces the ignored root `dist/` directory and can resolve build
and verification dependencies from package indexes. Read
[Build and distribution](build-and-distribution.md) for its artifact and
verification contract.

## Next routes

- Use [Dependencies](dependencies.md) before changing manifests or lockfiles.
- Use [Release](release.md) to prepare or publish a package version.
- Use [Documentation](documentation.md) for VitePress and interactive marimo
  authoring.
- Use [Testing](testing.md) to match a source change to its validation boundary.
