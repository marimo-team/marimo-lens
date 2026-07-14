# Development

Use Node 22.18 or newer and the Corepack-managed pnpm version declared in the
root `package.json`.

Install the uv and pnpm workspaces:

```sh
uv sync --locked --all-packages --all-groups
pnpm install --frozen-lockfile
```

Build the widget resource graph:

```sh
pnpm --filter @marimo-lens/python build
```

## Watch mode

Start Vite in one shell:

```sh
pnpm dev
```

Start the workbench in another shell and point `Lens` at the Vite server:

```sh
MARIMO_LENS_VITE_DEV_SERVER=http://127.0.0.1:5173 \
  uv run --all-packages --group workbench \
  marimo run workbench/demo.py --port 28889 --headless
```

Use the URL printed by Vite if it selects another port. Development CSS is
injected by Vite. Production CSS comes from the generated bundle and is also
synchronized for the Lens portal mounted under `document.body`.

## Checks

Run the complete local gate:

```sh
make check
```

Use package commands while iterating:

```sh
pnpm --filter @marimo-lens/anywidget-bundle test
pnpm --filter @marimo-lens/widget test
pnpm --filter @marimo-lens/python build
uv run --locked --all-packages --all-groups pytest -q packages/marimo-lens/tests
```

## Packaging

Build the browser assets before the Python distributions:

```sh
pnpm --filter @marimo-lens/python build
uv build --package marimo-lens --out-dir dist
```

Validate the archive boundary:

```sh
uvx twine check dist/marimo_lens-*.whl dist/marimo_lens-*.tar.gz
uv build --wheel dist/marimo_lens-*.tar.gz --out-dir dist/from-sdist
uv run --no-project --with dist/from-sdist/marimo_lens-*.whl \
  python -c "import marimo_lens"
```

The sdist build uses its packaged browser assets. Hatch reports every required
manifest artifact when the graph is incomplete.

## Browser checks

Open the workbench with `agent-browser --session marimo-lens`. Exercise the
changed interaction, inspect the DOM and console, and capture a screenshot for
visual changes. Use element coordinates for canvas targets. Close the session
and stop both servers when the check is complete.
