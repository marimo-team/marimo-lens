# Dependencies

The repository uses one [uv](https://docs.astral.sh/uv/) workspace and one
[pnpm](https://pnpm.io/) workspace. Root manifests own
shared policy. Each package manifest owns the dependencies it imports and the
scripts it runs.

Read this page before changing `pyproject.toml`, a package manifest,
`pnpm-workspace.yaml`, `uv.lock`, `pnpm-lock.yaml`, or the `html-to-image` patch.

## Workspace ownership

| Surface                                                               | Owner                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| Python workspace and shared development tools                         | Root `pyproject.toml`                                   |
| Published Python requirements and build backend                       | `packages/marimo-lens/pyproject.toml`                   |
| JavaScript package discovery, catalog, patches, trust, and age policy | `pnpm-workspace.yaml`                                   |
| Shared JavaScript development tools and recursive scripts             | Root `package.json`                                     |
| Package runtime and development dependencies                          | Each `apps/*/package.json` or `packages/*/package.json` |
| Resolved Python environment                                           | `uv.lock`                                               |
| Resolved JavaScript workspace                                         | `pnpm-lock.yaml`                                        |

Add a dependency to the narrowest package that consumes it. A dependency used
only by the docs app, widget, image capture, protocol, or Python bundle belongs
in that package manifest.

## Python policy

The root uv configuration excludes releases newer than three days. It exempts
`agent-plugins` and marimo from that age rule because this project integrates
their current capability and runtime contracts.

The published package currently requires:

- `agent-plugins>=0.2` for packaged agent resources.
- `anywidget>=0.9` and `traitlets>=5` for the widget model and transport.
- `marimo>=0.24` for notebook runtime and agent capability integration.
- `pydantic>=2` for transport validation.
- `typing-extensions>=4.4` for public types on Python 3.10.

The build backend requires `agent-plugins>=0.2` and `hatchling>=1.26.3`, which
supports the package's license metadata. Runtime and build requirements use
lower bounds, with resolved versions recorded in `uv.lock` for development.
The package supports Python 3.10 through 3.14.

The development environment uses plain marimo. Add dependencies for examples
and tests individually when they need packages beyond the runtime requirements.

Use `uv sync --locked` for an exact existing environment. A manifest change
requires an intentional lockfile update and review of package names, versions,
indexes, source archives, and transitive changes.

## pnpm catalog

`pnpm-workspace.yaml` centralizes shared JavaScript versions in the catalog.
Package manifests use `catalog:` for shared external dependencies and
`workspace:*` for internal package edges.

`catalogMode: prefer` lets package manifests resolve matching dependencies from
the workspace catalog. Root overrides keep the Vite alias and VitePress runtime
compatible with the current Vite+ setup.

Use the catalog when more than one workspace package consumes the dependency.
Keep a package-local dependency in the consuming manifest when no shared policy
is needed.

## pnpm supply-chain policy

The workspace config applies:

- `minimumReleaseAge: 20160`, which admits package releases after 14 days.
- `verifyDepsBeforeRun: install`, which verifies dependencies before scripts
  execute.
- `blockExoticSubdeps: true`, which rejects unexpected non-registry dependency
  sources.
- `trustPolicy: no-downgrade`, with explicit versioned exceptions for known
  packages.
- Scoped release-age exceptions for current `@marimo-team/*` integrations and
  the pinned StyleX compiler packages.
- Explicit build permission for `@manzt/uv` and `esbuild`.

When pnpm blocks an install, report the package, version, policy, and required
project decision. Do not weaken the workspace policy as an incidental part of a
feature change.

Review `pnpm-lock.yaml` for registry sources, integrity values, peer changes,
patch resolution, and unexpected dependency growth.

The widget imports `@stylexjs/stylex`. The widget package and Python browser
bundle use `@stylexjs/unplugin` so Vite+ and esbuild emit the same
atomic rules into `widget.css`.

## Patched `html-to-image`

`@marimo-lens/image-capture` depends on exact `html-to-image@1.11.13`. The
workspace applies `patches/html-to-image@1.11.13.patch`.

The patch adapts upstream DOM cloning and rasterization to Lens's document and
iframe contract. It covers owner-realm constructors, computed styles, canvas and
image creation, same-origin iframe cloning, nested resource URLs, open shadow
roots, scroll geometry, hidden documents, and cross-realm failures.

The compatibility suite is
`packages/image-capture/tests/evidence/html-to-image-patch.test.ts`. Read
[Browser and host](browser-and-host.md#rasterization-and-the-html-to-image-patch)
for the behavior and real-browser matrix.

An update requires:

1. Inspect the exact upstream source and release notes.
2. Determine which patch hunks upstream now provides.
3. Rebase every remaining hunk onto the exact new version.
4. Update the patched-dependency key and catalog version together.
5. Install with the frozen workspace policy after the lockfile update.
6. Run the dedicated patch tests and all image-capture tests.
7. Run owner-document, iframe, scroll, shadow-root, and cancellation scenarios
   in a real browser.
8. Rebuild the Python browser resources.
9. Run `make check` and `make package`.

## Add or update a Python dependency

1. Confirm the dependency is needed at runtime, build time, or development time.
2. Add it to the narrowest owning manifest.
3. Apply the project's version policy explicitly.
4. Update `uv.lock` once.
5. Inspect the resolved packages and source indexes.
6. Run the importing package's focused tests and type checks.
7. Run `uv lock --check` and `make check`.
8. Run `make package` for a published or build dependency.
9. Verify the direct wheel and source-distribution rebuild.

If the project release-age policy blocks the selected version, stop and report
the exact package and version. A one-command exception requires an explicit
review decision.

## Add or update a JavaScript dependency

1. Find the package that imports the dependency.
2. Reuse the workspace catalog when the dependency is shared.
3. Check maintenance, license, package contents, install scripts, and release
   age.
4. Update the manifest and `pnpm-lock.yaml` together.
5. Inspect added transitive packages and lifecycle-build requests.
6. Run the owning package check, test, and build.
7. Run `pnpm check`, `pnpm test`, and `pnpm build`.
8. Rebuild `@marimo-lens/python` when the dependency enters the browser bundle.
9. Run `make package` when distribution contents change.

Ask before expanding `allowBuilds`, trust exclusions, release-age exclusions,
or patch scope. Each entry changes the workspace supply-chain boundary.

## Lockfile contract

`uv.lock` and `pnpm-lock.yaml` are required repository artifacts. Use locked or
frozen installs for normal development and CI.

A dependency patch should contain:

- The owning manifest change.
- The reviewed lockfile change.
- The source and tests that use the dependency.
- Build or package evidence when the dependency ships.
- A focused explanation for a new policy exception or patch.

Avoid unrelated lockfile refreshes. They make provenance and behavior changes
harder to review.
