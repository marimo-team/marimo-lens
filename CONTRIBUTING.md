# Contributing

Thanks for helping improve marimo-lens. Focused changes with clear verification
are the easiest to review.

## Before you start

- Read [README.md](./README.md) for the product shape.
- Read [Architecture](./development_docs/architecture.md) before changing an
  ownership boundary.
- Report suspected vulnerabilities through the
  [security policy](./SECURITY.md), not a public issue.

## Set up

Use Python 3.12 from `.python-version`, Node.js 22.18 or newer from
`.node-version`, and the pnpm version declared in `package.json`. Install Python
packages with [uv](https://docs.astral.sh/uv/) and JavaScript packages with
[pnpm](https://pnpm.io/).

```sh
corepack enable
uv sync --locked
pnpm install --frozen-lockfile
pnpm --filter @marimo-lens/python build
```

The browser build creates the widget resources loaded by the Python package.
Run it before Python tests or the example notebook.

Start the example notebook:

```sh
uv run marimo run examples/lens.py --port 28889 --headless
```

Open the printed URL and confirm that the Lens dock appears. Press **Select**,
then mark a point or region in a rendered output.

## Verify changes

Run the checks owned by the package you changed while iterating. The
[development guide](./development_docs/development.md) lists focused commands
and maps source areas to their required evidence.

Run the repository gate before opening a pull request:

```sh
make check
```

For documentation changes, also inspect the rendered site at desktop and
narrow widths:

```sh
make docs-serve
```

For bundling, packaging, manifest, or release changes, validate the Python
archives:

```sh
make package
```

## Architecture guardrails

- Python owns selections, History, runtime context, revision checks, image
  bytes, and the public API.
- The browser owns gestures, notebook document access, image composition, the
  dock, and transient feedback.
- `@marimo-lens/protocol` is the innermost TypeScript package. Image capture
  depends on the protocol, and the widget composes both packages.
- marimo runtime access stays in the Python runtime adapters. Notebook host
  access stays in `packages/widget/src/notebook/`.
- Edit source files and rebuild generated browser resources. Keep generated
  output out of commits.

Read [Architecture](./development_docs/architecture.md) for the full ownership,
state, package, and transport model.

## Documentation changes

Public documentation in `docs/` explains Lens to users. Maintainer
documentation in `development_docs/` explains implementation ownership and
contributor workflows.

Read [Documentation](./development_docs/documentation.md) for page types,
interactive marimo examples, navigation, generated text views, and browser
validation.

## Contributor License Agreement

First-time contributors are asked to sign the
[marimo Contributor License Agreement](https://marimo.io/cla). A bot will
prompt you on your first pull request.

## Pull requests

- Keep each change focused.
- Add tests for changed behavior through the nearest public or runtime
  boundary.
- Update documentation when behavior, compatibility, or contributor workflows
  change.
- Report any skipped verification command and the reason.
- Remove comments or prose that only restate the code or heading.
