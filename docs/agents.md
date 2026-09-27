---
title: Connect an agent
description: Give a code-mode agent Lens context, show its work in the notebook, and return verified results for review.
---

# Connect an agent

Lens works with agents that can run Python inside the live marimo kernel. Lens
calls that environment **code mode**. The agent reads the current selection,
inspects and edits its producing cells, verifies the result, and returns it to
the same target for review. This page is for agents and integration authors.
Run its Python examples through the notebook's code-mode execution channel.

Notebook users need none of this. Use marimo's AI sidebar in **Code Mode
(beta)**, or connect your own agent through **Settings → Pair with an agent**.
Then select a result, add a note, and say:

> Use Lens to address my current selection.

[Getting started](./getting-started) walks through that path.

## Read the packaged briefing

The `marimo-lens` package ships its own Agent Skill inside an **Agent Plugin**,
so the instructions always match the installed version. It also registers
`marimo_lens.agent` as marimo's `lens` **capability**, which code-mode hosts
advertise to agents.

In the notebook kernel, read the core skill with either form:

```python
import marimo_lens

help(marimo_lens.agent)
```

```python
import agent_plugins as ap

print(ap.read("marimo-lens"))
```

`help()` prints the skill followed by the API reference for `connect()`,
`discover()`, and `MountedLens`. `ap.read()` returns the skill alone as a
string, so print it.

Read a reference only when its workflow applies:

```python
import marimo_lens

print(
    marimo_lens.agent.skill()
    .file("references/selections.md")
    .read_text(encoding="utf-8")
)
```

[marimo pair](https://marimo.io/pair) reads the skill from the kernel that runs
your calls. marimo's `help(cm)` lists `lens`
under installed capabilities and points to this module:

```bash
marimo pair execute --url http://localhost:2718 --file notebook.py \
  -c 'import marimo_lens; help(marimo_lens.agent)'
```

Before a notebook connection exists,
`uvx --with marimo-lens agent-plugins read marimo-lens` prints the same core
skill from an isolated installation, which can differ from the notebook's.

## Connect to Lens

`connect()` reuses an available Lens. It never creates a widget or a notebook
cell. It finds browser-ready instances in the active runtime, including
automatically mounted ones, plus Lens objects in the supplied code-mode
globals. When one browser-ready Lens owns the visible dock, `connect()` selects
it even if the globals contain other Lens objects. Run this inside one
code-mode kernel call:

```python
import marimo._code_mode as cm
import marimo_lens

mounted = marimo_lens.agent.connect(cm.get_context())
lens_context = mounted.context()

print(mounted.identity)
print(lens_context.current)
```

`connect()` returns a **mounted Lens**, the agent-facing handle for one live
`Lens` instance. `lens_context.current` is the current selection and the likely
referent for "this" or "here." The person's current instruction takes priority
over an older selection note.

Each kernel call has a fresh scratchpad. Save `mounted.identity` in your
working state and pass it back to select the same Lens later:

```python
mounted = marimo_lens.agent.connect(cm.get_context(), identity=saved_identity)
```

The identity belongs to one live Lens instance and lasts for that runtime. When
it is gone, retry once without it and read fresh context before continuing.

### Run through marimo pair

From a terminal, each kernel call is one `marimo pair execute`. Pass the Python
on stdin and read printed results from the JSON result's `stdout`:

```bash
marimo pair execute --url http://localhost:2718 --file notebook.py --code-file - <<'PY'
import json

import marimo._code_mode as cm
import marimo_lens

mounted = marimo_lens.agent.connect(cm.get_context())
print(json.dumps({"identity": mounted.identity, "current": mounted.context().current}))
PY
```

- Pass `--file` on every call. The session ID changes when the page reloads,
  while the kernel, its Lens, and the saved identity remain.
- An uncaught `LensError` sets `success` to `false`. The last `stderr` line
  names its code, as in `LensError: lens_unavailable: No Lens is available in
the active notebook.`
- When `marimo pair` reports an unknown outcome, read fresh Lens context before
  repeating a mutation. A committed `resolve()` has already moved its
  selections to History.
- One session runs one execution at a time. Calls to different notebooks can
  run concurrently.

`marimo pair --help` covers server discovery, authentication, and session
selection.

### Several or no instances

Use `discover()` to check availability or inspect candidates:

```python
import marimo._code_mode as cm
import marimo_lens

available = marimo_lens.agent.discover(cm.get_context())
for candidate in available:
    print(candidate.identity, candidate.context().current)
```

| Result          | Next action                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| One handle      | Use it, or call `connect()` to select it.                                                                                             |
| Several handles | Call `connect(ctx)` to select a unique browser-ready Lens. If that is ambiguous, inspect candidates and pass the intended `identity`. |
| Empty tuple     | Let a pending mount finish rendering and retry in a fresh call. Add Lens only when none exists.                                       |

Discovery order does not indicate which instance owns the visible dock. When
several browser-ready instances exist, inspect their contexts before selecting
an identity. An automatically mounted Lens appears after its browser view
reports ready, so an empty result during startup does not prove that the
notebook needs another Lens.

When discovery stays empty after the notebook has rendered, queue one collapsed
Lens cell:

```python
import marimo._code_mode as cm
import marimo_lens

async with cm.get_context() as context:
    cell_id = marimo_lens.agent.add_lens_cell(context)
    print(cell_id)
```

End that kernel call so the cell can run and the browser can render the dock,
then connect in a fresh call. `add_lens_cell()` reuses one agent-managed Lens
cell, reruns it when it holds no live Lens, and raises `lens_ambiguous` when it
finds several. A host that mounts Lens with its own `dom_selector` policy owns
mounting. Follow the host integration instead.

A reopened notebook whose cells have not run in the new kernel has no Lens yet.
Run the cell that mounts Lens with `ctx.run_cell(cell_id)`: a cell that imports
marimo, or an authored Lens cell.

### Selections in other notebooks

A Lens belongs to one notebook session and its kernel, so `connect()` and
`discover()` see only the session that runs the call. When the person refers to
selections that this Lens does not hold, list the server's live sessions
through the code-mode integration, such as `marimo pair notebook list`, and
read `discover()` in each session concurrently.

Address a selection through the session that holds it. When its note asks for
work in another notebook, edit and verify through that notebook's session, then
reveal and resolve the selection with the Lens that holds it.

## Address a selection

Start activity on the selection before inspecting its code, so the person sees
where you are working:

```python
selection = lens_context.current
if selection is None:
    raise RuntimeError("Lens has no current selection")

identity = mounted.identity
selection_id = selection["id"]
activity = mounted.start_activity(
    selection,
    expected_revision=lens_context.revision,
    label="Inspecting selected result",
    message="Reading the selection and its producing cells.",
)
```

Keep the returned handle. Read the note, target, DOM hint, and producing cells
from the reference. Read `lens_context.text` for the producing cells and their
relevant upstream source and control values. Inspect
`lens_context.images.get(selection["id"])` before making a claim about the
marked pixels. Then apply the change through code mode, run the affected cells,
and verify the result from fresh runtime evidence.

Producing cells are provenance and edit locations, not necessarily where the
fix belongs. A change to a chart often belongs in the data or an earlier step.
A configured DOM target can have zero or several producing cells.

## Verify with a cell-output image

After changing and running a cell, request a fresh, unannotated PNG of its
current output:

```python
if not selection["cells"]:
    raise RuntimeError("The selection has no producing cell")

cell_id = selection["cells"][0]["id"]
png = mounted.cell_image(cell_id, expected_revision=lens_context.revision)
print("ready" if png is not None else "capture_pending")
```

The first call starts browser capture and returns `None`. End the kernel call,
reconnect with the saved identity, and repeat the same cell ID and revision
until the call returns bytes or raises a terminal `LensError`. One Lens has one
capture slot, so finish the pending cell before requesting another. The bytes
are consumed on return and are not stored by Lens.

## Return the result

Save the identity, selection ID, and activity handle before the kernel call
ends. After verification, reconnect, find the same selection in fresh context,
and reassess a changed note or mark. Then reveal the target and resolve with
the same captured revision in one call:

```python
import marimo._code_mode as cm
import marimo_lens

# Replace these with the strings saved in agent working state from the earlier call.
identity = "<saved Lens identity>"
selection_id = "<saved selection ID>"
mounted = marimo_lens.agent.connect(cm.get_context(), identity=identity)
fresh_context = mounted.context()
fresh_selection = next(
    item
    for item in fresh_context.references["selections"]
    if item["id"] == selection_id
)

mounted.reveal(
    fresh_selection,
    expected_revision=fresh_context.revision,
    duration_ms=4_000,
    label="Updated result",
    message="Verified the change and brought the selected result into view.",
)
revision = mounted.resolve(
    selection_id,
    expected_revision=fresh_context.revision,
    summary="Updated the result and verified the affected cells.",
)
```

Reveal replaces your activity. Resolution moves the selection to **History**
immediately, and the browser shows the **Addressed** receipt after the reveal
ends. Write the summary as a colleague would: what changed or what you found,
and how you checked it. On `revision_conflict`, read fresh context and reassess
before resolving. Keep ambiguous, blocked, or unverified selections Open and
report what remains.

### Several selections

Read every item in `lens_context.references["selections"]` when the person asks
to address all Open selections. Several selections can mark different evidence
on one target. Resolve them together when one verified change addresses them
all. Resolve separately with distinct summaries when the outcomes differ,
passing the returned revision to the next call.

## Explain the notebook with a Trail

A **Trail** is a multi-step reveal: an ordered explanation attached to notebook
cells that the person pages through at their own pace. It needs no selection,
which makes it the right tool for "walk me through this notebook" or "explain
these results."

Inspect the relevant cells and values first. Then choose a short route through
the question, evidence, main result, and next step, and put the explanation in
each step's message:

```python
steps = [
    {
        "target": "BYtC",
        "label": "Inputs",
        "message": "Start with the values used by this notebook.",
    },
    {
        "target": "rAqT",
        "label": "Calculation",
        "message": "Follow how the inputs become a result.",
    },
    {
        "target": "mNwP",
        "label": "Conclusion",
        "message": "Review the result and what it supports.",
    },
]
mounted.reveal(steps, duration_ms=None)
```

Each target must be a current graph member. Verify that the cell is idle and
free of relevant errors before presenting its result. Trails accept 1–16 steps
and are transient: dismissal, another attention event, or a change to a
referenced cell or its upstream inputs ends the route. Return control after
showing it. A walkthrough request is not permission to edit or resolve
existing selections.

Cell-addressed `start_activity()` works the same way when you want to show work
on a cell that has no selection.

## Next

- [How Lens works](./how-lens-works) explains the lifecycle behind these calls.
- [Python API](./api) defines every signature, and [`LensContext`](./reference/context) defines the returned shapes.
- [Errors and limits](./reference/errors) lists error codes and bounds, and [Troubleshooting](./troubleshooting) maps symptoms to recovery.
