# Development

Use the Node version declared in `.node-version` and the Corepack-managed pnpm
version declared in `package.json`.

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

Start the workbench in another shell:

```sh
MARIMO_LENS_VITE_DEV_SERVER=http://localhost:5173 \
  uv run --all-packages --group workbench \
  marimo run workbench/demo.py --port 28889 --headless
```

Development CSS is injected by Vite. Production CSS comes from the generated
resource graph and is synchronized for the portal mounted under
`document.body`.

## Checks

Run the complete local gate:

```sh
make check
```

Use package commands while iterating:

```sh
pnpm --filter @marimo-lens/widget test
pnpm --filter @marimo-lens/python build
uv run --locked --all-packages --all-groups \
  pytest -q packages/marimo-lens/tests
```

Frontend changes also require:

```sh
pnpm dlx react-doctor@latest . --verbose --scope changed
```

## Packaging

Build browser assets before Python distributions:

```sh
pnpm --filter @marimo-lens/python build
uv build --no-sources --package marimo-lens --out-dir dist
```

Validate the archive boundary:

```sh
uvx twine check dist/marimo_lens-*.whl dist/marimo_lens-*.tar.gz
uv build --no-sources --wheel dist/marimo_lens-*.tar.gz --out-dir dist/from-sdist
uv run --no-project --with dist/from-sdist/marimo_lens-*.whl \
  python -c "from marimo_lens import Lens, LensContext, SelectionImage; Lens()"
```

The sdist build uses its packaged browser assets. Hatch reports each required
manifest artifact when the graph is incomplete.

## Release

Create a release commit and annotated tag from a clean `main` branch:

```sh
./scripts/release.sh minor
```

Use `major`, `minor`, or `patch` for a final-version bump. Use `stable` to
finish a prerelease. The script runs `make check`, updates the package version
and `uv.lock`, creates the release commit and `vX.Y.Z` tag, then prints the
exact push command.

Pushing the tag starts `.github/workflows/publish.yml`. The workflow checks the
tag against the package version, rebuilds and validates the wheel and sdist,
then publishes through PyPI Trusted Publishing in the `pypi` environment.

## Browser checks

Start a fresh production-mode server:

```sh
env -u MARIMO_LENS_VITE_DEV_SERVER \
  uv run --locked --all-packages --all-groups \
  marimo run workbench/demo.py --port 28889 --headless
```

Use one isolated browser session:

```sh
agent-browser --session marimo-lens-e2e open http://127.0.0.1:28889
agent-browser --session marimo-lens-e2e snapshot -i
```

Exercise these contracts:

- Expanded and collapsed bottom-center dock states with explicit toggles
- Stable dock geometry on hover
- Point selection on text, table, SVG, canvas, chart, and widget outputs
- Region selection on a nested layout
- Immediate commit on pointer release with an empty note
- One-shot return to the resting dock
- Stable `S<n>` label in the captured image
- Marker-local note add and edit with image preservation
- Exact stored PNG preview from a marker and selection row
- Anchor move and resize with replacement capture
- Selection activation with output reveal, delete, clear, and current-selection
  fallback
- Output rerun with marker reconnection, fresh text context, and retained capture-time images
- **Copy** for the current reference, plus all references and standalone text
  from the actions menu
- Keyboard selection and Escape cancellation
- Narrow viewport and coarse-pointer placement
- Light, dark, and reduced-motion settings
- Explicit snapshot failure for an external iframe

Inspect console and page errors after the flow. Capture desktop and narrow
viewport screenshots. Close the session and stop the server:

```sh
agent-browser --session marimo-lens-e2e close
```

## Live Pair check

Start a fresh edit-mode server so marimo-pair can use the same kernel as the
browser:

```sh
env -u MARIMO_LENS_VITE_DEV_SERVER \
  uv run --locked --all-packages --all-groups \
  marimo edit workbench/demo.py \
  --host 127.0.0.1 --port 28889 --headless --no-token
```

Open that server with `agent-browser`, create one successful selection and one
external iframe selection, then evaluate `lens.context()` through marimo-pair's
scratchpad execution path. The scratchpad may use `marimo._code_mode` to inspect
the live cell collection. Project code and notebook cells must use public
marimo APIs.

For every selection, verify that `outputCellId` resolves through
`ctx.graph.cells[outputCellId]`. Compare
`ctx.graph.ancestors(outputCellId)` with the selected cell plus the bounded,
topologically ordered ancestor subset rendered in `context.text`.

Assert these contracts:

- References have `protocol`, `version`, `revision`, `generatedAt`, `notebook`,
  `currentSelectionId`, and `selections` as their complete top-level shape.
- `currentSelectionId` identifies the most recently created, focused, or edited
  selection.
- References contain no cell source, control state, PNG bytes, or scratchpad
  caller identity.
- Text contains each output cell reference, selected source, upstream source,
  DAG edges, and relevant current control values when notes and images are
  absent.
- A failed image capture still produces complete references and text.
- `LensContext.images` contains successful captures in selection order.
- Selection state stays at or below 40,000 bytes, references at or below 45,000
  bytes, and text at or below 64,000 characters.

Record compact references bytes and text characters. The workbench
single-selection references object must remain below 2 KiB. Close the browser
and stop the edit server after the check.
