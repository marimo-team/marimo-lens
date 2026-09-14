---
title: Connect an agent
description: Give a live notebook agent Lens context and return verified work for review.
---

# Connect an agent

Lens works with agents that can run Python inside the live marimo kernel. The
agent reads the current selection, inspects and edits its producing cells, then
returns the verified result to the same target for review.

## Before connecting

Install `marimo-lens` in the notebook environment and display one Lens cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep the cell mounted. Press **Select**, mark another output, and optionally add
a note. [Getting started](./getting-started) covers installation. Run the agent
examples through the live code-mode connection, where the notebook is executing.

## Enter code mode

**Code mode** is a live connection to the notebook kernel. It lets an agent read
cells, run scratch code, apply cell edits, and inspect runtime results.

If your agent already has code-mode access, continue to
[Connect to Lens](#connect-to-lens).

[marimo Pair](https://github.com/marimo-team/marimo-pair) can provide this
connection. Ask the agent to run:

```console
npx skills use "https://github.com/marimo-team/marimo-pair" --skill "marimo-pair"
```

If `npx` is unavailable, use Deno through `uvx`:

```console
uvx deno x -y skills use "https://github.com/marimo-team/marimo-pair" --skill "marimo-pair"
```

These commands require network access and return an [Agent Skill](https://agentskills.io/home),
a set of workflow instructions. Have the agent read the complete output and
follow it now, redirecting it to a temporary file first if necessary. Resolve
relative paths from the supporting-files directory it provides.

Pair owns notebook connection, inspection, edits, and execution. Lens owns
selection grounding, visual evidence, activity, reveal, and resolution.

## Connect to Lens

The `marimo-lens` Python package includes the matching Lens Agent Skill inside
an **Agent Plugin**, the installed resource bundle that keeps the workflow and
Python version together. It also registers `marimo_lens.agent` as marimo's
`lens` **capability**, the Python module marimo advertises to code-mode agents.

Discover the installed API and read its packaged workflow in the notebook kernel:

```python
import marimo_lens.agent

help(marimo_lens.agent)
skill = marimo_lens.agent.agent_skill()
print(skill.body)
```

Follow the complete skill output. Access supporting files through `skill`, for
example `skill / "reference/workflow.md"`.

Run this inside one live code-mode kernel call:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context())
lens_context = mounted.context()

print(mounted.identity)
print(lens_context.current)
```

`connect()` returns a **mounted Lens**, the agent-facing handle for one live
`Lens` instance. Its opaque `identity` lets the agent reconnect to that same
instance in a later kernel call.

`lens_context.current` is the current selection and the likely referent for
“this” or “here.” The current user instruction takes priority over an older
selection note.

## Address the current selection

Start activity against the selection before inspecting its code:

```python
selection = lens_context.current
if selection is None:
    raise RuntimeError("Lens has no current selection")

activity = mounted.start_activity(
    selection,
    expected_revision=lens_context.revision,
    label="Inspecting selected result",
    message="Reading the selection and its producing cells.",
)
```

Keep the returned `activity` handle. Read the selection's note, target, and
producing cells. Inspect the relevant upstream cells before changing notebook
logic. Use the selection image when the request depends on the marked pixels.

Apply the change through code mode, run the affected cells, and verify the
result from fresh runtime and browser evidence.

## Return verified work

Save the Lens identity, selection ID, and activity handle in the agent's working
state before ending a kernel call. After verification, reconnect and find the
same selection ID in a fresh context. Reassess a changed note or mark before
returning the result. Stop the owned activity, reveal the selected target, wait
for the reveal hold, then resolve in a later kernel call.

```python
identity = mounted.identity
selection_id = selection["id"]
fresh_context = mounted.context()
fresh_selection = next(
    item
    for item in fresh_context.references["selections"]
    if item["id"] == selection_id
)

mounted.stop_activity(activity)
mounted.reveal(
    fresh_selection,
    expected_revision=fresh_context.revision,
    duration_ms=8_000,
    label="Updated result",
    message="Verified the change and brought the selected result into view.",
)
```

After the eight-second hold, reconnect and resolve:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity=identity)
current_context = mounted.context()
revision = mounted.resolve(
    selection_id,
    expected_revision=current_context.revision,
    summary="Updated the result and verified the affected cells.",
)
print(revision)
```

The resolution call receives `identity` and `selection_id` from the agent's
working state. Each code-mode kernel call has a fresh scratch namespace.

Resolution moves the selection to **History** and shows a resolution receipt
with the visible status **Addressed**. A person can reopen the History entry for
another pass.

## Add Lens when the notebook has none

When `connect()` raises `LensError(code="lens_unavailable")`, queue one
collapsed Lens cell through the code-mode context:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as context:
    cell_id = lens_agent.add_lens_cell(context)
    print(cell_id)
```

End that kernel call. Connect in a fresh call after the browser renders Lens.
`add_lens_cell()` reuses one existing agent-managed Lens cell and raises
`lens_ambiguous` when it finds several.

Host applications can require an authored Lens mount with a specific
`dom_selector`. Follow the host integration instead of adding a default Lens
cell in that case.

## Reconnect across kernel calls

Save `mounted.identity` in the agent's working state:

```python
mounted = lens_agent.connect(cm.get_context(), identity=saved_identity)
```

The identity belongs to one live Lens instance and lasts for that runtime. It
is not a notebook-persistent ID. Retry once without the saved identity when
that instance is gone, then read a fresh context before continuing.

When several Lens instances are available, `connect()` requires an identity.
The first displayed Lens view in each browser document owns interaction. Other
views show **Lens is already active** until ownership changes.

## Inspect current cell-output pixels

A selection image preserves the marked target at selection time. After an
agent change, `cell_image()` requests a fresh, unmarked image of one current
cell output.

```python
selection = lens_context.current
if selection is None or not selection["cells"]:
    raise RuntimeError("The selection has no producing cell")

cell_id = selection["cells"][0]["id"]
png = mounted.cell_image(
    cell_id,
    expected_revision=lens_context.revision,
)
print("ready" if png is not None else "capture_pending")
```

The first call starts browser capture and returns `None`. End the kernel call,
reconnect with the same Lens identity, and repeat the same cell ID and revision
until the call returns PNG bytes or raises a terminal `LensError`.

One Lens has one cell-output capture slot. Finish its pending cell before requesting
another. Read [Context and evidence](./concepts/evidence) for image ownership
and [Troubleshooting](./troubleshooting) for capture failures.

## Work with several selections

Read every item in `lens_context.references["selections"]` when the person asks
to address all Open selections. Several selections can point to one target
while marking different visual evidence.

Resolve selections together when one verified change addresses them. Use
separate guarded calls when the changes or summaries differ. Keep ambiguous,
blocked, or unverified selections Open and report what remains.

## Walk through a notebook with no selection

An empty selection list describes the current Lens attention state. It does not
cancel an explicit request for a notebook overview or walkthrough.

Use the code-mode context's ordered cells and graph to choose graph-member cell
IDs. Pass those IDs to `start_activity()` and `reveal()`. Cell-addressed
feedback guides the walkthrough without creating or resolving a selection.

Read [Feedback and History](./concepts/feedback) for the presentation lifecycle.
The [Python API reference](./api) defines the exact methods. [Errors and
limits](./reference/errors) covers recovery and bounds.
