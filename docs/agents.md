---
title: Agent workflow
description: Connect an agent to Lens and return verified notebook work for review.
---

# Connect an agent

Lens works through a live marimo code-mode environment. The agent reads the
current Lens request, changes and runs notebook cells, and returns the verified
result for human review.

## Enter code mode

If the current agent already executes code in the live notebook kernel,
continue with the Lens workflow.

Otherwise, install the
[marimo Pair skill](https://github.com/marimo-team/marimo-pair/tree/main/skills/marimo-pair):

```console
npx skills add https://github.com/marimo-team/marimo-pair --skill marimo-pair
```

Use `$marimo-pair` to connect to or start the notebook. Resume `$marimo-lens`
after code-mode execution is available. Notebook discovery, connection,
scratchpad execution, and general notebook inspection and mutation belong to
the active code-mode integration, such as Pair. Lens owns selection grounding,
evidence, activity, reveal, and resolution.

## Use the packaged Lens skill

Installing `marimo-lens` installs the Agent Plugin and Lens skill that match the
Python package. Inspect the installed instructions from the notebook
environment:

```python
import marimo_lens.agent as lens_agent

skill = lens_agent.agent_skill()
print(skill / "SKILL.md")
```

The skill teaches a code-mode agent how to read Lens context, inspect image
evidence, show activity, verify its notebook changes, and resolve addressed
selections.

## Read the current request

Run Lens calls from the live code-mode kernel:

```python
import json

import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

ctx = cm.get_context()
mounted = lens_agent.connect(ctx)
snapshot = mounted.context()
selection = snapshot.current
activity = (
    mounted.start_activity(
        selection,
        expected_revision=snapshot.revision,
        label="Inspecting selected output",
        message="Reading the marked result and its producer context.",
    )
    if selection is not None
    else None
)

print(
    json.dumps(
        {
            "identity": mounted.identity,
            "revision": snapshot.revision,
            "activity": activity,
            "current": snapshot.current,
            "selectionCount": len(snapshot.references["selections"]),
        }
    )
)
```

`marimo._code_mode` is an internal agent-facing marimo API. Integrations are
responsible for compatibility with the installed marimo version.

Passing `ctx` lets the adapter reuse an existing Lens object from notebook
globals even when that object was created by an authored notebook cell.

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
module to code-mode agents. Its module help points to the packaged skill, and
`MountedLens` exposes the bounded handoff API. A displayed Lens registers with
its active marimo runtime when its browser view becomes ready.

:::

## Add Lens when none is mounted

After `connect(ctx)` raises `LensError(code="lens_unavailable")` without an
identity, queue one Lens cell through the active code-mode context:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

async with cm.get_context() as ctx:
    cell_id = lens_agent.add_lens_cell(ctx)
    print(cell_id)
```

The context creates and runs the collapsed cell when it exits. End that kernel
call, then call `connect(cm.get_context())` in a fresh call so the browser can
render and register Lens. Host documents can require an authored Lens mount and
a host-owned `dom_selector`. Follow that integration's skill for both.

## Keep the handle stable across calls

Each code-mode kernel call gets a fresh scratchpad. Keep these values in the
agent's working state:

- `mounted.identity` reconnects to the same Lens.
- `snapshot.revision` guards selection-addressed feedback and `resolve()`.
- The activity handle returned by `start_activity()` owns the current work mark.
- Each addressed selection ID identifies the selection to move into History.
- `selection["target"]` identifies the notebook output or DOM element.
- `selection["cells"]` lists inferred producing cells and their runtime status.

Reconnect in a later call:

```python
import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity=identity)
```

The handle's identity and Lens target remain fixed for its lifetime. Retry
without the saved identity when that Lens becomes unavailable, then read a
fresh snapshot before continuing.

## Edit and return the result

Handle one request in this order:

1. Capture `LensContext` and its revision.
2. Choose the relevant `SelectionReference`.
3. Start activity against that selection and keep the returned handle.
4. Inspect its producing cells and host source.
5. Apply the change through code mode or the host source boundary.
6. Verify against fresh runtime and browser evidence.
7. Stop the owned activity with its handle.
8. Reveal the selected target with the captured revision.
9. Wait for the reveal hold.
10. Resolve the verified selection with the captured revision.

For a notebook overview or zero-selection walkthrough, pass graph-member cell
IDs to `start_activity()` and `reveal()`.

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

| Error code            | Agent response                                                       |
| --------------------- | -------------------------------------------------------------------- |
| `lens_unavailable`    | Retry without identity, then add a Lens cell when none is mounted.   |
| `lens_ambiguous`      | Reconnect with an identity, or close or remove extra Lens instances. |
| `revision_conflict`   | Read current Lens state and reassess the requested work.             |
| `selection_not_found` | Read current selections before resolving again.                      |
| `capture_busy`        | Finish the pending cell capture before requesting another cell.      |
| `runtime_unavailable` | Keep the request open and report that the kernel cannot verify it.   |

Read the [Overview](./overview) for the human-agent interaction and the
[Python API reference](./api) for signatures, limits, and lifecycle errors.
