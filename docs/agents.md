---
title: Agent workflow
description: Connect a code-mode agent to Lens and return verified notebook work for review.
---

# Connect a code-mode agent

A code-mode agent connects to the live marimo kernel, reads the current Lens
request, changes and runs notebook cells, and returns the verified result for
human review. [marimo Pair](https://marimo.io/pair) is one code-mode agent
option.

Mount Lens in the notebook before connecting an agent. [Getting
started](./getting-started) shows the two-cell setup.

## Install the Lens skill

Install the agent guidance from this repository:

```bash
npx skills add marimo-team/marimo-lens
```

The skill teaches a code-mode agent how to read Lens context, inspect image
evidence, show activity, verify its notebook changes, and resolve addressed
selections.

## Read the current request

Run Lens calls inside the same `marimo._code_mode` context the agent uses to
inspect and edit the notebook:

```python
import json

import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx)
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
contract, and `MountedLens` exposes the bounded handoff API.

:::

## Keep the handle stable across calls

Each code-mode kernel call gets a fresh scratchpad. Keep these values in the
agent's working state:

- `mounted.identity` reconnects to the same mounted Lens.
- `snapshot.revision` guards the later `resolve()` call.
- Each addressed selection ID identifies the selection to move into History.
- `selection["outputCellId"]` identifies the work and result cell.

Reconnect in a later call:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as ctx:
    mounted = lens_agent.connect(ctx, identity=identity)
```

The handle's identity and Lens target remain fixed for its lifetime. Call
`connect()` again after `lens_unavailable`, then read a fresh snapshot before
continuing.

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
| `lens_unavailable`      | Reconnect without an identity and read a fresh snapshot.         |
| `lens_ambiguous`        | Ask the user to leave one Lens mounted.                           |
| `revision_conflict`     | Read current Lens state and reassess the requested work.          |
| `selection_not_found`   | Read current selections before resolving again.                   |
| `capture_busy`          | Finish the pending cell capture before requesting another cell.   |
| `runtime_unavailable`   | Keep the request open and report that the kernel cannot verify it. |

Read the [Overview](./overview) for the human-agent interaction and the
[Python API reference](./api) for signatures, limits, and lifecycle errors.
