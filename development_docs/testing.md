# Testing

Test Lens through the boundary a consumer depends on. State transitions belong
in state tests, wire shapes in both protocol suites, browser behavior in widget
tests, pixels and layout in a real browser, and distribution contents in package
verification.

## Evidence layers

| Layer              | Proves                                                                                                          | Primary command or suite                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Protocol           | Python and TypeScript accept the same bounded messages and reject malformed data.                               | Protocol package tests and `test_protocol.py`          |
| Selection state    | Revisions, atomic transitions, images, History, limits, and failure behavior.                                   | `test_selection_state.py`                              |
| Context            | Runtime projection, provenance, controls, references, text, and context types.                                  | Context, runtime, control, and provenance Python tests |
| Image capture      | DOM raster geometry, composition, PNG bounds, owner realms, iframe behavior, and patch obligations.             | Image-capture package tests                            |
| Widget             | Gestures, reducers, commands, target resolution, attention, focus, and view ownership.                          | Widget package tests                                   |
| Public Python      | `Lens`, `MountedLens`, errors, argument validation, close, and agent connection.                                | Widget and agent Python tests                          |
| Bundle integration | Generated browser resources load through AnyWidget and agent-created output.                                    | `test_bundle_integration.py`                           |
| Documentation      | Interactive cells compile, routes and assets build, and base paths remain valid.                                | `make docs` and Pages workflow checks                  |
| Distribution       | Wheel, source distribution, rebuilt wheel, metadata, resources, entry point, and installed API.                 | `make package`                                         |
| Real browser       | Actual layout, pointer and keyboard behavior, scrolling, pixels, iframes, responsive UI, and docs presentation. | Manual or agent-driven browser inspection              |

One passing layer does not substitute for another. jsdom can prove a DOM
algorithm while still missing a browser raster or layout failure.

## Focused TypeScript checks

Run check, test, and build commands in the package that owns the change:

```sh
pnpm --filter @marimo-lens/protocol check
pnpm --filter @marimo-lens/protocol test
pnpm --filter @marimo-lens/protocol build

pnpm --filter @marimo-lens/image-capture check
pnpm --filter @marimo-lens/image-capture test
pnpm --filter @marimo-lens/image-capture build

pnpm --filter @marimo-lens/widget check
pnpm --filter @marimo-lens/widget test
pnpm --filter @marimo-lens/widget build
```

Protocol changes usually require all three packages because image capture and
the widget consume its source contracts.

## Focused Python checks

Build the bundled browser resources before Python tests:

```sh
pnpm --filter @marimo-lens/python build
uv run pytest -q
```

Use a direct test path while iterating:

```sh
uv run pytest -q packages/marimo-lens/tests/test_selection_state.py
uv run pytest -q packages/marimo-lens/tests/test_context_builder.py
uv run pytest -q packages/marimo-lens/tests/test_agent.py
uv run pytest -q packages/marimo-lens/tests/test_bundle_integration.py
```

Python formatting and type checks are:

```sh
uv run ruff format --check
uv run ruff check
uv run ty check
uv run pyrefly check --min-severity warn
```

## Contract-to-test map

| Change                                                   | Required evidence                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Target, anchor, selection, History entry, or event field | TypeScript protocol test, Python protocol test, owning state or widget test               |
| Revision or state mutation                               | Selection-state test and browser mutation test                                            |
| Image metadata or byte rule                              | Protocol tests, Python image test, image-capture test                                     |
| Selection capture lifecycle                              | Widget capture/action test, Python selection-state test, real browser capture             |
| Cell-output capture                                      | Python output-slot test, browser transport test, bundle integration, real browser capture |
| marimo graph or control access                           | Runtime, control, provenance, and context tests across missing and failing host values    |
| DOM target resolution                                    | Target and document-interaction tests plus real browser host scenario                     |
| Iframe, shadow-root, or owner-realm behavior             | Patch and image tests plus real browser scenario                                          |
| Activity, reveal, or resolution receipt                  | Python public API test, protocol test, target-attention test, browser sequencing check    |
| Agent discovery or mount                                 | Agent test, bundle integration, package verification                                      |
| Browser bundle or Hatch config                           | Bundle integration and `make package`                                                     |
| Agent Plugin resource                                    | Skill tests, package verification, and rebuilt wheel                                      |
| Public documentation example                             | Docs build and rendered browser verification                                              |

## Test design

- Assert supported behavior through the nearest public API, transport envelope,
  synchronized trait, image bytes, browser state, file artifact, or installed
  distribution.
- Keep one test focused on one contract.
- Use concrete expected values instead of mirroring a production constant as
  the sole assertion.
- Test a helper directly when it owns nontrivial behavior or forms a package
  contract.
- Treat fixture shape as setup unless the shape is the behavior under test.
- Keep test comments for host quirks, artificial timing, lifecycle ordering,
  security boundaries, and compatibility constraints.
- Verify spacing, color, alignment, scrolling, responsive layout, and pixels in
  a browser.

## JavaScript runtime boundary

The widget and image-capture suites use
[jsdom](https://github.com/jsdom/jsdom). The test setup supplies browser
objects and deterministic geometry needed to exercise reducers, message clients,
and DOM algorithms.

jsdom does not provide browser layout, native canvas pixels, real scrolling,
cross-document process boundaries, font loading, pointer hit testing, or actual
network and cross-origin behavior. Keep faithful unit seams, then validate the
observable result in a browser.

## Real-browser evidence

Run real-browser checks after changing browser interaction, capture, attention,
styles, host integration, or interactive documentation.

Use at least these scenarios for the affected surface:

1. Default notebook output target.
2. Point selection and dragged rectangle.
3. Note edit, current-selection change, delete, resolve, and reopen.
4. Selection image preview and image replacement after anchor movement.
5. Activity followed by reveal and final resolution receipt.
6. Target temporarily removed and restored.
7. Large or scrolled output capture.
8. Same-origin iframe content when iframe behavior changed.
9. Open shadow-root content when host traversal changed.
10. Multiple Lens views in one document and independent views in separate
    documents when ownership changed.
11. Desktop and narrow viewport.
12. Keyboard access, focus restoration, announcements, and reduced motion.

Inspect the browser console and page overflow. Capture screenshots when the
change affects visible presentation or documentation.

## Repository gate

Run:

```sh
make check
```

The gate runs, in order:

1. `uv lock --check`
2. `pnpm check`
3. `pnpm test`
4. `pnpm build`
5. Ruff format and lint checks
6. ty
7. Pyrefly
8. Python tests
9. `git diff --check`

Run `shellcheck scripts/*.sh` separately after shell changes. Run
`make package` after bundling, packaging, manifest, Agent Plugin, or release
changes.

## CI matrix

The CI workflow separates four required jobs:

- Quality checks JavaScript, Python, shell scripts, lock state, and whitespace.
- Python tests build the browser resources and run the suite on Python 3.10,
  3.11, 3.12, 3.13, and 3.14.
- JavaScript tests run package suites and build packages and documentation.
- Package builds and verifies the distribution, then checks for tracked-file
  drift.

The final required job fails when any required job did not succeed.

The Pages workflow builds the public site on pull requests and main. It verifies
selected routes and base-path asset links. Rendered browser behavior, complete
links, every heading fragment, and visual presentation still require the docs
checks in [Documentation](documentation.md#validate-the-site).

## Package gate

Run:

```sh
make package
```

The command replaces the ignored root `dist/` directory. It validates direct
archives and a wheel rebuilt from the source distribution in isolated
environments. See [Build and distribution](build-and-distribution.md#make-package)
for the exact artifact contract.
