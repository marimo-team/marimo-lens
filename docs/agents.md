---
title: Agent workflow
description: Connect a code-mode agent to Lens and return verified notebook work for review.
---

# Connect a code-mode agent

A code-mode agent connects to the live marimo kernel, reads the current Lens
request, changes and runs notebook cells, and returns the verified result for
human review. [marimo Pair](https://marimo.io/pair) is one code-mode agent
option.

Connect to the notebook's mounted Lens before reading a request. When the
notebook has no mounted Lens, the agent can add a collapsed Lens cell and
reconnect after the browser renders it.

## Install the Lens skill

Install the agent guidance from this repository:

```bash
npx skills add marimo-team/marimo-lens
```

The skill teaches a code-mode agent how to read Lens context, inspect image
evidence, show activity, verify its notebook changes, and resolve addressed
selections.

## Read the current request

Run Lens calls from the live code-mode kernel:

```python
import json

import marimo_lens.agent as lens_agent

mounted = lens_agent.connect()
snapshot = mounted.context()
selection = snapshot.current

if selection is not None and selection["cellStatus"] == "available":
    mounted.start_activity(
        selection["outputCellId"],
        label="Inspecting selected output",
        message="Reading the marked result and its producing cell.",
    )

print(
    json.dumps(
        {
            "identity": mounted.identity,
            "revision": snapshot.revision,
            "current": snapshot.current,
            "selectionCount": len(snapshot.references["selections"]),
        }
    )
)
```

`marimo._code_mode` is an internal agent-facing marimo API. Integrations are
responsible for compatibility with the installed marimo version.

`snapshot.current` is the likely referent for requests such as "change this"
or "inspect here." The current user instruction takes priority over an older
selection note.

`snapshot.text` contains bounded code and graph context for the producing cell
and its relevant upstream cells. `snapshot.images` maps selection IDs to
annotated PNG bytes. The agent can begin from notebook structure, then inspect
the image when a visual claim or edit depends on the marked pixels.

::: details How agents discover Lens

Lens registers `marimo_lens.agent` as the `lens` capability in the
`marimo.agent.capability` entry-point group. Marimo advertises the installed
module to code-mode agents. Its module docstring defines the collaboration
contract, and `MountedLens` exposes the bounded handoff API. A displayed Lens
registers with its active marimo runtime when its browser view becomes ready.

:::

## Add Lens when none is mounted

After `connect()` raises `LensError(code="lens_unavailable")` without an
identity, queue one Lens cell through the active code-mode context:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as ctx:
    cell_id = lens_agent.add_lens_cell(ctx)
    print(cell_id)
```

The context creates and runs the collapsed cell when it exits. End that kernel
call, then call `connect()` in a fresh call so the browser can render and
register Lens.

## Keep the handle stable across calls

Each code-mode kernel call gets a fresh scratchpad. Keep these values in the
agent's working state:

- `mounted.identity` reconnects to the same mounted Lens.
- `snapshot.revision` guards the later `resolve()` call.
- Each addressed selection ID identifies the selection to move into History.
- `selection["outputCellId"]` identifies the work and result cell.

Reconnect in a later call:

```python
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(identity=identity)
```

The handle's identity and Lens target remain fixed for its lifetime. Retry
without the saved identity when that Lens becomes unavailable, then read a
fresh snapshot before continuing.

## Edit and return the result

Handle one request in this order:

1. Call `context()` and identify the selected output and graph-grounded code.
2. Call `start_activity()` as soon as the primary work cell is known.
3. Inspect, edit, and run cells through code mode while activity remains
   visible.
4. Verify the affected cells in a fresh kernel call. Inspect a fresh cell image
   when the result depends on appearance.
5. Call `stop_activity()`, then `reveal()` the verified result for a readable
   hold.
6. After the reveal hold, call `resolve()` with the captured revision and a
   concise summary.

`reveal()` preserves the user's focus while bringing the result into view.
`resolve()` moves addressed selections into **History**. A user can reopen one
for another pass, which restores the selection and starts a fresh annotated
image capture.

## Inspect current cell pixels

`snapshot.images` preserves the selection marker from capture time.
`cell_image()` requests a fresh, unannotated PNG of the whole rendered cell:

```python
png = mounted.cell_image(
    cell_id,
    expected_revision=snapshot.revision,
)
```

The first call starts browser capture and returns `None`. End that kernel
execution so the browser can respond, then repeat the same call with the saved
identity, cell ID, and revision. A completed call returns and consumes the PNG
bytes.

Write image bytes to a private temporary file when the agent's image reader
requires a path. Remove the file after the final read. The kernel and image
reader must share a filesystem.

## Address several selections

Read every item in `snapshot.references["selections"]` when the user asks to
address all open selections. Several selections can point to one output while
marking different evidence.

Resolve selections together when one verified change addresses them. Use
separate guarded calls when their changes or summaries differ. Keep ambiguous,
blocked, or unverified selections open and report what remains.

## Handle expected failures

| Error code              | Agent response                                                   |
| ----------------------- | ---------------------------------------------------------------- |
| `lens_unavailable`      | Retry without identity, then add a Lens cell when none is mounted. |
| `lens_ambiguous`        | Ask the user to leave one Lens mounted.                           |
| `revision_conflict`     | Read current Lens state and reassess the requested work.          |
| `selection_not_found`   | Read current selections before resolving again.                   |
| `capture_busy`          | Finish the pending cell capture before requesting another cell.   |
| `runtime_unavailable`   | Keep the request open and report that the kernel cannot verify it. |

Read the [Overview](./overview) for the human-agent interaction and the
[Python API reference](./api) for signatures, limits, and lifecycle errors.
