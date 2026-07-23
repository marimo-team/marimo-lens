# Development

Use the Node version in `.node-version` and the Corepack-managed pnpm version
declared in `package.json`.

```sh
uv sync --locked
pnpm install --frozen-lockfile
```

Build the browser resource graph before running Python tests:

```sh
pnpm --filter @marimo-lens/python build
```

## Watch mode

Start the browser build in one shell:

```sh
pnpm dev
```

Start the example notebook in another:

```sh
MARIMO_LENS_VITE_DEV_SERVER=http://localhost:5173 \
  uv run marimo run examples/lens.py --port 28889 --headless
```

Development mode injects CSS from Vite. Production mode loads the generated
stylesheet and module graph from the packaged AnyWidget manifest.

## Documentation

Start the VitePress site with live reload:

```sh
make docs-serve
```

The local server uses `/` as its base path. `make docs` reads `BASE_PATH` when
GitHub Pages builds the site under a repository path.

Build the static site:

```sh
make docs
```

`apps/docs` owns VitePress configuration, theme code, and public brand assets.
User-facing source pages live in `docs/`.

## Checks

Run the repository gate before handoff:

```sh
make check
```

The Make target checks the lockfile, checks and tests the TypeScript workspace,
builds browser and documentation assets, checks Python format and types, runs
Python tests, and checks whitespace.

Use a package filter while iterating:

```sh
pnpm --filter @marimo-lens/protocol check
pnpm --filter @marimo-lens/image-capture test
pnpm --filter @marimo-lens/widget build
```

Build the Python resource graph before focused Python tests:

```sh
pnpm --filter @marimo-lens/python build
uv run pytest -q
```

Run the CI shell check after changing release scripts:

```sh
shellcheck scripts/*.sh
```

## Packaging

Build and validate both Python distribution formats:

```sh
make package
```

The target builds the browser resources, creates the wheel and source
distribution, checks their metadata, builds a wheel from the source
distribution, and imports the public package from that rebuilt wheel.

Hatch validates the AnyWidget manifest, bootstrap, application module,
stylesheet, and module allowlist. The source distribution must carry the
browser graph needed to build its wheel.

## Release

Complete these checks before changing the package version:

- `make check`
- `make package`
- A clean install of the built wheel

Update the version in the release-bearing pull request:

```sh
uv version --package marimo-lens --bump patch
```

Use `major`, `minor`, or `patch` for the planned release. Commit the package
metadata and `uv.lock`, merge the pull request, and wait for CI on `main`.

From a clean local `main` that matches `origin/main`, verify the release:

```sh
./scripts/release.sh --dry-run
```

Start the release:

```sh
./scripts/release.sh
```

The script requires successful CI for the current commit and pushes an
annotated `vX.Y.Z` tag. The publish workflow rebuilds and validates the
archives, publishes through PyPI Trusted Publishing, verifies the public
installation, and creates GitHub release notes.
