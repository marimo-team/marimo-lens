---
name: marimo-lens
description: >-
  Ground work in a user's point or region selections on rendered marimo
  outputs, inspect the selected cell and optional image, show agent activity,
  and return verified results through Lens History and reveal. Use with a live
  marimo kernel executor when the user mentions a Lens selection, asks to
  resolve a Lens request, points to "this" notebook output, or asks for a
  visual change tied to marked notebook evidence or a guided walkthrough of
  changes across notebook cells.
---

# Work with marimo Lens

Run this skill alongside a live marimo kernel executor such as
`marimo-pair`. The executor supplies session discovery, Python execution in the
active kernel, code-mode mutation, and runtime verification. This skill owns
Lens grounding, image handling, activity, resolution, and reveal policy.

Resolve every helper path from this loaded `SKILL.md`. The
`scripts/materialize-image.sh` helper accepts marked image transfers and writes
validated temporary PNGs on the client.

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

Keep the scan's `identity`, `revision`, selection IDs, and output cell IDs
together. In later kernel calls, reconnect with
`discover(ctx, identity=identity)`. An empty result means the mounted Lens
changed, so scan again before acting.

Treat the current selection as the likely referent for "this", "here", or
"the selected output". The explicit request takes priority over an older
selection note.

## Use the required evidence

Read the selected cell and its required graph neighbors before planning a
mutation. Load `handle.context(expected_revision=revision).text` when a
truncated note or omitted scan detail affects the request.

Use `selection_image()` for pixels captured with one selection. Use
`start_cell_image()` and `read_cell_image()` for the current rendered cell,
including every open Lens mark on that cell. Pipe image transfers directly to
`scripts/materialize-image.sh`, open the returned local path with the client's
image reader, then track its `imageDir` for cleanup.

Read [reference/workflow.md](reference/workflow.md) for executable kernel
snippets, image transfer commands, result handling, and the exact closeout
sequence.

## Apply and close the request

After grounding, call `activity()` on the target cell and apply one coherent
code-mode mutation. Use a fresh kernel call to verify the affected cells are
idle and free of relevant errors. For visual work, inspect a fresh cell image
after execution.

After verification, call `resolve()` for selections addressed by the same
result, then call `reveal()` on the primary result cell. Keep selections open
when verification fails or the next step requires user input.

Use `reveal()` to guide the user's attention across verified notebook results.
After changing several cells, create a short walkthrough by revealing each
result in reading order. Give each call a self-contained message that explains
the change and a readable `duration_ms`. Let one reveal finish before sending
the next because a newer call replaces the current reveal.

Remove every image directory after its final read:

```bash
bash scripts/materialize-image.sh cleanup \
  '/tmp/marimo-lens.A1b2c3' \
  '/tmp/marimo-lens.D4e5f6'
```
