# Build and distribution

The Python distribution contains the public Python package, one bundled browser
module, one stylesheet, and the matching Agent Plugin. The build derives every
distributed resource from repository source and verifies both direct and
source-distribution builds.

[`esbuild`](https://esbuild.github.io/) creates the browser bundle.
[`Hatchling`](https://hatch.pypa.io/latest/) builds Python archives, and
[`agent-plugins`](https://github.com/peter-gy/agent-plugins) extends that build
with the installed Agent Plugin resources.

## Workspace build graph

```text
packages/protocol/src
  -> packages/image-capture/src
  -> packages/widget/src
  -> packages/marimo-lens/src/marimo_lens/static/widget.js
  -> wheel and source distribution

plugin.json + skills/marimo-lens
  -> agent-plugins build backend
  -> wheel and source distribution
```

The TypeScript packages are private workspace packages. The published product
is the `marimo-lens` Python distribution.

## Workspace packages

| Package                      | Build role                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| `@marimo-lens/protocol`      | Builds shared schema and bounded-text declarations.                        |
| `@marimo-lens/image-capture` | Builds the DOM raster and PNG composition library.                         |
| `@marimo-lens/widget`        | Builds the AnyWidget browser application.                                  |
| `@marimo-lens/python`        | Runs esbuild against the widget entry and writes Python package resources. |
| `@marimo-lens/docs`          | Builds the VitePress site and interactive examples.                        |

The root Vite+ configuration owns workspace formatting, linting, type-aware
checks, and recursive build orchestration. Package manifests own the
dependencies and scripts used by that package.

## Browser bundle

`packages/marimo-lens/build.mjs` runs esbuild with:

- `packages/widget/src/widget.tsx` as the entry point.
- ESM output.
- Bundling and minification for normal builds.
- An inline source map in watch mode.
- `widget.js` and imported CSS written to
  `packages/marimo-lens/src/marimo_lens/static/`.

The output directory is removed before a normal bundle build. Watch mode keeps
the esbuild context alive and writes after source changes.

The static directory is generated and ignored by Git. Source changes belong in
the TypeScript packages and their CSS. Python tests that construct `Lens` need
the generated files present locally.

## Python build

`packages/marimo-lens/pyproject.toml` uses the `agent-plugins` Hatchling backend
and a custom Hatch hook.

The custom hook:

- Skips generated-resource validation for editable builds.
- Requires `widget.js` and `widget.css` for wheel and source-distribution builds.
- Keeps Hatch's forced workspace `.gitignore` out of the source distribution.

Hatch packages `src/marimo_lens` into the wheel and includes the generated
static directory as an artifact. The source distribution includes the package
source, build hook, package README, and package manifest. The Agent Plugin
backend adds its resources from the repository root.

## Agent Plugin resources

The authored Agent Plugin contract consists of:

- `plugin.json`
- `skills/marimo-lens/SKILL.md`
- `skills/marimo-lens/agents/openai.yaml`
- `skills/marimo-lens/reference/workflow.md`

The package manifest points `[tool.agent-plugins].root` to the repository root.
The build backend packages the plugin tree and records its installed location
in distribution metadata.

`marimo_lens.agent.agent_plugin()` and `agent_skill()` resolve these installed
resources. Their returned paths must identify the same distribution version as
the imported Python API.

## `make package`

Run:

```sh
make package
```

The target performs these steps:

1. Deletes and recreates the ignored root `dist/` artifact directory.
2. Builds the Python browser resources.
3. Builds a wheel and source distribution with uv.
4. Checks both archives with Twine.
5. Builds a second wheel from the source distribution.
6. Installs each wheel in a fresh isolated uv environment.
7. Runs `scripts/verify_release.py` against both installations.

The command can access Python package indexes for build and verification
dependencies. It applies the repository uv age gate while allowing the explicit
`agent-plugins` and marimo exceptions configured by the project.

The validated outputs are:

```text
dist/marimo_lens-<version>-py3-none-any.whl
dist/marimo_lens-<version>.tar.gz
dist/from-sdist/marimo_lens-<version>-py3-none-any.whl
```

The direct wheel and rebuilt wheel prove different boundaries. The direct wheel
proves the checkout build. The rebuilt wheel proves that the source distribution
contains the build hook, browser resources, Python source, and Agent Plugin
inputs required to reconstruct an installable wheel.

## Installed verification

`scripts/verify_release.py` checks:

- Installed distribution version and `marimo_lens.__version__` parity.
- Required `agent-plugins` metadata.
- The `marimo.agent.capability` entry point and module import.
- marimo code-mode capability discovery.
- Installed Agent Plugin name, versioned path, skill membership, and required
  skill files.
- Module help paths for installed resources.
- Installed license bytes.
- Public Python types and callables.
- JSON-safe `ActivityHandle` values.
- `Lens` construction, empty context, agent connection, and close.

Python bundle integration tests separately prove that marimo formats `Lens` as
AnyWidget output, an agent-created Lens cell becomes discoverable, and the
generated browser source handles a Lens message.

## Generated paths

| Path                                           | Owner                       | Git status                             |
| ---------------------------------------------- | --------------------------- | -------------------------------------- |
| `packages/protocol/dist/`                      | Protocol package build      | Ignored                                |
| `packages/image-capture/dist/`                 | Image-capture package build | Ignored                                |
| `packages/widget/dist/`                        | Widget package build        | Ignored                                |
| `packages/marimo-lens/src/marimo_lens/static/` | Python browser build        | Ignored                                |
| `apps/docs/.vitepress/dist/`                   | Documentation build         | Ignored by the root `.gitignore`       |
| `dist/`                                        | Python package target       | Ignored and replaced by `make package` |

Generated artifacts are evidence, not editing surfaces. Rebuild them through
their owning command.

## Build commands

| Outcome                                           | Command                                   |
| ------------------------------------------------- | ----------------------------------------- |
| Build all workspace packages and docs             | `pnpm build`                              |
| Build the Python browser resources                | `pnpm --filter @marimo-lens/python build` |
| Watch the Python browser resources                | `pnpm dev`                                |
| Build public documentation with browser resources | `make docs`                               |
| Build and validate Python archives                | `make package`                            |

## Change checklist

For a bundle, Hatch, package manifest, Agent Plugin, or release-verification
change:

1. Update the source owner and its focused tests.
2. Build the Python browser resources.
3. Run Python bundle and package tests.
4. Run `make check`.
5. Run `make package`.
6. Inspect the direct wheel, source distribution, and rebuilt wheel paths.
7. Confirm the worktree contains no generated noise.

Read [Dependencies](dependencies.md) before changing a build dependency and
[Release](release.md) before publishing the validated archives.
