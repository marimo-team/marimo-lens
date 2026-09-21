---
title: Python API
description: Public Python contracts for mounting Lens and connecting a code-mode agent.
---

# Python API

Use `marimo_lens.agent.connect()` in the live notebook kernel to reuse an
existing Lens. Notebook authors can mount `Lens` when the host has not already
provided one.

| Task                                       | API                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Discover existing instances                | [`discover()`](#discover)                                                                                        |
| Add the notebook interface                 | [`Lens`](#lens)                                                                                                  |
| Read selections, source, and images        | [`Lens.context()`](#lens-context), [`LensContext`](./reference/context)                                          |
| Show agent work and return a result        | [`start_activity()`](#lens-start-activity), [`stop_activity()`](#lens-stop-activity), [`reveal()`](#lens-reveal) |
| Move addressed requests to History         | [`resolve()`](#lens-resolve)                                                                                     |
| Show a user-paced notebook walkthrough     | [`reveal()`](#lens-reveal)                                                                                       |
| Connect an agent or capture current output | [`discover()`](#discover), [`connect()`](#connect), [`MountedLens`](#mountedlens)                                |
| Release a Lens instance                    | [`close()`](#lens-close)                                                                                         |

The two caller roles are:

- Notebook authors construct `Lens` and keep it mounted with the notebook.
- Code-mode agents call `marimo_lens.agent.connect()` and work through a
  `MountedLens` handle.

The two surfaces share context, activity, reveal, and resolution behavior. The
agent handle adds stable reconnection identity and current cell-output capture.

::: info Source version

This reference follows the repository's `main` branch. PyPI follows tagged
releases. Read [Compatibility](./compatibility) when the installed signatures
differ.

:::

## Notebook-author API

Install `marimo-lens` in the notebook environment. The examples use one mounted
`lens` instance, created in the [`Lens` example](#lens). For installation and a
first selection, see [Getting started](./getting-started).

The top-level package exports:

```python
from marimo_lens import (
    ActivityHandle,
    CellReference,
    Lens,
    LensContext,
    LensError,
    LensReferences,
    NotebookReference,
    SelectionReference,
    SelectionTargetReference,
    __version__,
)
```

`__version__` comes from the installed `marimo-lens` distribution metadata.

### `Lens`

```python
Lens(*, dom_selector: str | None = None) -> Lens
```

Creates the Python widget and browser UI that own one Lens instance.

- `dom_selector: str | None` adds configured DOM targets to the default
  notebook outputs and regions declared with Lens target or source attributes.
  See [Custom targets](./custom-targets). The string is stripped and accepts at
  most 1,024 UTF-16 code units.
- Returns a renderable `Lens` instance.
- Raises `TypeError` for a non-string selector.
- Raises `ValueError` for an empty or oversized selector.
- The browser reports invalid CSS syntax when the view mounts.

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep the value mounted while people create selections and agents call its
methods. Read [Custom targets](./custom-targets) before configuring host DOM
targets.

### `Lens.context`

`lens.context() -> LensContext`

Returns detached selection references, lazy graph-context text, available
selection-image bytes, and the captured selection-state revision.

```python
context = lens.context()
selection = context.current
```

The object does not update. Call `context()` again after notebook or Lens state
changes. Existing contexts remain readable after `lens.close()`.

Raises `LensError(code="lens_closed")` after the Lens closes.

Read the [`LensContext` reference](./reference/context) for every field and
degradation rule.

### `Lens.start_activity`

```python
lens.start_activity(
    target: str | SelectionReference,
    *,
    expected_revision: int | None = None,
    duration_ms: int | None = None,
    label: str | None = None,
    message: str | None = None,
) -> ActivityHandle
```

Marks one selection or cell as the current work location and returns the
opaque owner accepted by `stop_activity()`.

```python
context = lens.context()
selection = context.current

if selection is not None:
    activity = lens.start_activity(
        selection,
        expected_revision=context.revision,
        label="Updating selected result",
        message="Inspecting the target and its producing cells.",
    )
```

Pass a `SelectionReference` and its captured `expected_revision` to address the
selected target. Pass a cell ID string for a notebook walkthrough. A cell
address can omit `expected_revision` and must identify a current graph member.

`duration_ms=None` keeps activity visible until a matching stop, later
attention, or teardown. A duration from 1 through 300,000 milliseconds clears
it after that hold. `label` defaults to **Working** in the browser. Labels
accept 40 UTF-16 code units and activity messages accept 240. Selection state
does not change.

Raises `LensError` for a closed Lens, stale selection revision, missing
selection, unavailable runtime, or missing cell. Invalid inputs raise
`TypeError` or `ValueError`.

### `Lens.stop_activity`

`lens.stop_activity(activity) -> None`

Stops activity when `activity` still owns the current presentation.

```python
lens.stop_activity(activity)
```

`ActivityHandle` is a string-backed, JSON-safe opaque value. A stale handle has
no effect. A non-string value raises `TypeError`. An empty or oversized value
raises `ValueError`. A closed Lens raises `LensError(code="lens_closed")`.

### `Lens.reveal`

```python
lens.reveal(
    target: str | SelectionReference | Sequence[RevealStep],
    *,
    expected_revision: int | None = None,
    duration_ms: int | None,
    label: str | None = None,
    message: str | None = None,
) -> None
```

Brings a cell, selection, or ordered sequence of steps into view. A single
target is a one-step reveal. Multiple steps add previous/next controls in the
popover header and scroll smoothly, respecting reduced motion.

```python
context = lens.context()
selection = context.current

if selection is not None:
    lens.reveal(
        selection,
        expected_revision=context.revision,
        duration_ms=8_000,
        label="Updated result",
        message="Verified the change and brought the selected target into view.",
    )
```

For a user-paced walkthrough, pass 1–16 `RevealStep` dictionaries:

```python
lens.reveal(
    [
        {
            "target": "BYtC",
            "label": "The question",
            "message": "Compare demand with capacity.",
        },
        {"target": "rAqT", "label": "The evidence"},
        {"target": "mNwP", "label": "The next step"},
    ],
    duration_ms=None,
)
```

Each step requires `target` (a cell ID or `SelectionReference`) and accepts
optional `label` and `message`. Put explanations on the steps, rather than in
top-level `label` or `message` arguments. Selection references in the sequence
share `expected_revision` from the same captured context. The whole sequence
is validated before publication.

Pass `duration_ms=None` to hold until dismissal or replacement. A finite
duration limits the whole reveal, including time spent on previous steps.
Navigation never resets the timer or advances automatically. A held single
reveal has a dismiss button; multiple steps also have arrows and a count.
Reveals are transient and do not enter notebook state or History. In a live
notebook, rerunning or deleting a referenced cell ends the reveal.

Target and revision rules match `start_activity()`. Reveal preserves selection
state and keyboard focus, and replaces current activity. Call `reveal()` before
`resolve()` with the same captured revision in one kernel call. History retains
the target for the reveal, and the receipt appears after the reveal ends. A later
attention event replaces the reveal.

`duration_ms` accepts 1 through 300,000 milliseconds. Labels accept 40 UTF-16
code units. Reveal messages accept 1,000. See [Errors and
limits](./reference/errors) for the complete validation contract.

### `Lens.resolve`

```python
lens.resolve(
    selection_ids: str | Sequence[str],
    *,
    expected_revision: int,
    summary: str | None = None,
) -> int
```

Moves one or more Open selections into History and returns the next
selection-state revision.

```python
context = lens.context()
selection_ids = [item["id"] for item in context.references["selections"]]

if selection_ids:
    revision = lens.resolve(
        selection_ids,
        expected_revision=context.revision,
        summary="Updated the result and verified the affected cells.",
    )
```

Pass one ID string or a sequence of up to 64 unique strings. Lens validates the
entire batch before changing state. The resolved selections share one resulting
revision and optional summary of up to 240 UTF-16 code units. Their
selection-image bytes are released.

Include `summary` to tell the user what changed or what you found and how you
verified it. Lens stores it beside the original request in each History entry
and displays it in the resolution receipt. Resolve separately with distinct
summaries when requests have different outcomes, passing the returned revision
to the next call.

The state transition commits before Lens sends its best-effort resolution
receipt. A receipt delivery failure does not roll back History. Expected errors are
`lens_closed`, `revision_conflict`, `selection_not_found`, and
`selection_context_limit`.

### `Lens.close`

`lens.close() -> None`

Closes the Lens instance, cancels pending cell-output capture, and releases
Open selections, History entries, and Lens-owned selection images. Repeated
calls have no effect.

Later public operations raise `LensError(code="lens_closed")`.

## Agent adapter

Read the agent resources from the installed package:

```python
import marimo_lens.agent

plugin = marimo_lens.agent.plugin()
skill = marimo_lens.agent.skill()
```

### `plugin`

`plugin() -> agent_plugins.Plugin`

Returns the Agent Plugin resource bundle installed with the current
`marimo-lens` distribution.

Raises `agent_plugins.AgentPluginError` when distribution metadata or the
packaged plugin is unavailable. Reinstall the same `marimo-lens` version before
retrying.

### `skill`

`skill() -> agent_plugins.Skill`

Returns the packaged `marimo-lens` Agent Skill.

- `skill.file("SKILL.md")` gives the checked instruction path.
- `skill.body` gives the Markdown instruction body.
- `skill.files` gives the packaged resource inventory.

`help(marimo_lens.agent)` includes this core skill through
`agent_plugins.read("marimo-lens")`. Load linked workflows with
`skill.file("references/selections.md").read_text(encoding="utf-8")` when needed.

Raises `agent_plugins.AgentPluginError` when the plugin contains no Lens skill.

### `add_lens_cell`

`add_lens_cell(ctx) -> str`

Returns the existing agent-managed Lens cell ID or queues one collapsed Lens
cell and returns its new ID.

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as context:
    cell_id = lens_agent.add_lens_cell(context)
```

Call `connect()` or `discover()` first to reuse an authored or automatically
mounted Lens. This helper searches for agent-managed cells.

The code-mode context creates and runs a queued cell when its async context
manager exits. Connect in a later kernel call after the browser renders Lens.

`ctx` must expose `create_cell()`, `run_cell()`, and `cells.find()`. Other
objects raise `TypeError`. Several agent-managed Lens cells raise
`LensError(code="lens_ambiguous")`.

### `discover`

`discover(context=None) -> tuple[MountedLens, ...]`

Returns the available Lens handles without creating a widget or notebook cell.
An empty tuple means no instance is discoverable in this call. Multiple results
let an agent inspect their contexts and choose an identity for `connect()`.

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

available = lens_agent.discover(cm.get_context())
for candidate in available:
    print(candidate.identity, candidate.context().current)
```

Discovery combines browser-ready instances in the current runtime with Lens
objects and supported marimo wrappers in `context.globals`. Aliases of one object
produce one handle. Automatically mounted instances need no global variable,
but must finish browser registration before this path finds them. Globals can
expose an instance before it is rendered. Closed objects are excluded.

Order implies no preference or browser ownership. Handles retain the same identity
across calls while their Lens exists. Discovery does not keep an unreferenced
instance alive after its returned handles are released. A supplied context
without a globals mapping raises `TypeError`.

### `connect`

`connect(context=None, *, identity=None) -> MountedLens`

Selects one of the available handles from `discover()`. Reuses authored and
automatically mounted instances without creating another Lens.

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context())
```

`context` adds Lens objects found in code-mode globals to browser-ready Lens
registrations. `identity` selects the same Lens in a later kernel call.

Raises `LensError(code="lens_unavailable")` when no matching Lens exists.
Raises `LensError(code="lens_ambiguous")` when several candidates exist and no
identity selects one. A context without a globals mapping or a non-string
identity raises `TypeError`. An empty identity raises `ValueError`.

### `MountedLens`

`MountedLens` remains attached to one live `Lens` instance. It can address any
selection owned by that instance.

| Member                                      | Contract                                            |
| ------------------------------------------- | --------------------------------------------------- |
| `identity`                                  | Opaque string for reconnecting across kernel calls. |
| `context()`                                 | Delegates to `Lens.context()`.                      |
| `cell_image(cell_id, *, expected_revision)` | Requests a fresh, unmarked cell-output PNG.         |
| `start_activity(...)`                       | Delegates to `Lens.start_activity()`.               |
| `stop_activity(activity)`                   | Delegates to `Lens.stop_activity()`.                |
| `reveal(...)`                               | Delegates to `Lens.reveal()`.                       |
| `resolve(...)`                              | Delegates to `Lens.resolve()`.                      |

#### `mounted.cell_image(cell_id, *, expected_revision) -> bytes | None`

The first call starts browser capture and returns `None`. End that kernel call,
reconnect to the same Lens, and repeat the same cell ID and revision. The
completed call returns and consumes the PNG bytes.

```python
context = mounted.context()
selection = context.current

if selection is not None and selection["cells"]:
    cell_id = selection["cells"][0]["id"]
    png = mounted.cell_image(
        cell_id,
        expected_revision=context.revision,
    )
```

One capture can be pending per Lens. Finish it before requesting another
cell. A stale revision raises `revision_conflict`. A different cell while
capture is pending raises `capture_busy`. A terminal result consumes the
capture slot, so another call starts a new capture. Browser capture has a
15-second deadline and the Python request expires after 20 seconds. The operation requires a current graph member and a browser-ready Lens
view. Read [How Lens works](./how-lens-works#selection-images) for the
difference between a selection image and a cell-output image.

## `LensError`

`LensError` extends `RuntimeError` and exposes:

- `code: str`, a stable machine-readable failure code.
- `revision: int | None`, the current selection-state revision when available.

Read [Errors and limits](./reference/errors) for every code, recovery action,
argument rule, and bound. Read [Connect an agent](./agents) for the complete
workflow.
