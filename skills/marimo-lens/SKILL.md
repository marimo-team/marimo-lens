---
name: marimo-lens
description: >-
  Ground work in a user's point or region selections, or guide the user through
  existing outputs in a live marimo notebook. Inspect relevant cells and
  optional images, show agent activity, reveal results in reading order, and
  move addressed selections to Lens History. Use with a live marimo kernel
  executor when the user mentions a Lens selection, asks to resolve a Lens
  request, points to "this" notebook output, requests a notebook overview, or
  asks for a guided walkthrough across notebook cells.
---

# Work with marimo Lens

Run this skill alongside a live marimo kernel executor such as
`marimo-pair`. The executor supplies session discovery, Python execution in the
active kernel, code-mode mutation, and runtime verification. This skill owns
Lens grounding, image handling, activity, resolution, and reveal policy.

## Workflow reference

Read [reference/workflow.md](reference/workflow.md) before acting on a Lens
request. It contains executable kernel calls, image file handling, result
handling, and the closeout sequence.

## Ground the request

Import `marimo_lens.agent` inside the active kernel, then call `discover(ctx)`
inside a `marimo._code_mode.get_context()` block:

```python
import marimo_lens.agent as lens_agent
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    mounted = lens_agent.discover(ctx)
```

Inspect each handle with `scan()`.

- Report an import failure as an unavailable Lens adapter in the active
  notebook environment.
- Continue from the single mounted Lens when one is present.
- Ask the user to leave one Lens mounted when several are present.
- Report that Lens is unavailable when the request explicitly depends on Lens
  and no mounted handle is present.

Keep the scan's `identity` and `revision` together. When selections are
present, also keep their selection IDs and output cell IDs. In later kernel
calls, reconnect with
`discover(ctx, identity=identity)`. An empty result means the mounted Lens
changed, so scan again before acting.

A mounted Lens is available at any `selectionCount`. A zero count means the
request has no human point or region context. Continue from the user's explicit
request and the notebook cells.

Treat the current selection as the likely referent for "this", "here", or
"the selected output". The explicit request takes priority over an older
selection note.

## Use the required evidence

For a selection request, read the selected cell and its required graph
neighbors before planning a mutation. Load
`handle.context(expected_revision=revision).text` when a truncated note or
omitted scan detail affects the request.

For an overview or walkthrough, inspect the notebook's ordered cells and graph
through the live executor. Choose a short route through existing cells that
explains setup, inputs, transformations, and results. Reveal those cells in
notebook order even when the scan contains zero selections.

Use `selection_image()` for pixels captured with one selection. Use
`start_cell_image()` and `read_cell_image()` for the current rendered cell,
including every open Lens mark on that cell. Write an available
`AgentImage.data` to a private temporary PNG in the active kernel, open that
path with the agent's image reader, then remove the file after its final read.
This path requires the kernel and image reader to share a filesystem. When
they do not, continue from text and graph evidence and report that visual
inspection is unavailable.

## Apply and close the request

Call `activity()` when applying a notebook mutation or running an extended
check. A read-only overview can proceed directly to its walkthrough. Use a
fresh kernel call to verify changed cells are idle and free of relevant errors.
For visual work, inspect a fresh cell image after execution.

Give each activity and reveal a short contextual `label`. The label is the
heading, while `message` explains the current action or result. Name the
notebook object and the work being done, such as `Joining artist records`,
`Checking image coverage`, `Source tables`, or `Updated chart`. Generic
lifecycle headings such as `Verifying`, `Working`, and `Ready` are too vague.
Vary labels across a walkthrough so each step is recognizable at a glance.

Use `reveal()` to guide the user's attention across verified notebook results.
For an overview or a multi-cell change, create a short walkthrough by revealing
each relevant cell in reading order. Give every reveal a `duration_ms` that
lets the user orient to the highlighted cell and read its message at a
comfortable pace. Allow more time for longer or denser messages. Use one kernel
call per reveal, print the chosen hold in milliseconds, and wait for that hold
before sending the next. Keep each message concise and tied to the highlighted
cell.

Reveal the primary result before resolving its selections. Wait for the final
reveal's chosen hold, then resolve selections addressed by that verified result
against the revision captured before the work. On `revision_conflict`, leave
the selections open, scan again, and reassess the changed request. The addressed
receipt is the final presentation. The browser also queues a receipt that
arrives while a reveal is active. When the request has no selection, or the
result does not address an open selection, finish after the walkthrough and
leave selection state unchanged.

Keep selections open when verification fails or the next step requires user
input. Keep decisions, supporting details, and follow-up information the user
may need later in the agent chat.

Remove every temporary image file after its final read:

```bash
unlink '/private/tmp/marimo-lens-ab12cd34.png'
unlink '/private/tmp/marimo-lens-ef56gh78.png'
```
