---
name: marimo-lens
description: >-
  Use with marimo pair whenever an analyst asks about or wants changes to a
  live marimo notebook that has Lens, a `lens` capability in `help(cm)` or a
  `Lens(` cell, in chat or by pointing at an output. Lens
  records the request, reports what earlier requests decided about its cells,
  and closes it with a summary. Also adds Lens to a notebook.
---

# Work with marimo Lens

Lens holds open requests and, when it keeps a record, the code each resolved
request changed. Code mode owns cells and edits. Run `help(cm)` once per
kernel.

Each block is one kernel call. Scratchpad names disappear between calls. Save
the printed identity, request ID, and revision.

## Start: request, brief, and code together

Quote a chat instruction in `open_request()` before investigating or
editing, and read the brief: it lists what earlier requests decided. Name its
cells when known. For "address my selection", omit `open_request()`: the selection
is already a request.

```python
import marimo._code_mode as cm
import marimo_lens

ctx = cm.get_context()
mounted = marimo_lens.agent.connect(ctx)
mounted.open_request("<the analyst's message, quoted>")
context = mounted.context()
request = context.request
print({"identity": mounted.identity, "revision": context.revision, "request": request})
print(context.brief)
if request and request["cells"]:
    for reference in request["cells"]:
        cell = ctx.cells[reference["id"]]
        print(cell.id, cell.status, cell.errors, cell.code, sep="\n")
elif request is None or request["channel"] == "chat":
    for cell in ctx.cells:
        print(cell.id, cell.name, cell.status, cell.code.splitlines()[:1])
```

`context.request` is the brief's request. `context.current` is the selection.
Complete the saved request ID even if another request opens.

For a selection, append this image export to the same call. Open the printed
path if you can read images. Otherwise say you could not see the marked part.

```python
from tempfile import NamedTemporaryFile

selection = context.current
if selection is not None:
    print(selection)
    image_bytes = context.images.get(selection["id"])
    if image_bytes:
        with NamedTemporaryFile(suffix=".png", delete=False) as image_file:
            image_file.write(image_bytes)
            print(image_file.name)
    activity = mounted.start_activity(
        selection, expected_revision=context.revision, label="Checking selection"
    )
    print({"activity": activity})
```

Delete the file after reading. Kernel and image reader must share a filesystem.
Report missing image evidence. Reveal replaces activity. If blocked, call
`mounted.stop_activity(activity)` with the saved handle.

## Inspect and edit

Read bodies, errors, `ctx.graph.ancestors(cell_id)`, and needed
`ctx.globals[name]` values together. When `mounted.record` is not `None`
(otherwise `context.history()` raises `record_off`), also read `context.history(context.request)` and `context.history(cell_id)` for each
cell you edit. Preserve `in_force` changes unless asked to reverse them, then
name them in the summary. For `undone`, `missing` names lost statements and
`movedTo` the cells that hold them now. The brief names other cells the
undoing request changed. Restore where needed, except what your own edits for
the open request undid. Investigate `unknown`.

Edit the inspected full cell body and queue its run:

```python
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    ctx.edit_cell("Hbol", "revenue = sales[sales.kind != 'refund'].sum()")
    ctx.run_cell("Hbol")
```

marimo raises `StaleCellError` when the cell changed after you read it: read
it again and reassess. Verify in a fresh call after queued runs finish.

## Verify visual edits

For visual edits, capture the result in the verification call:

```python
import marimo._code_mode as cm

ctx = cm.get_context()
cell = ctx.cells["Hbol"]
assert cell.status == "idle" and not cell.errors
await ctx.screenshot(cell.id, save_to="/tmp/lens-output.png")
print("/tmp/lens-output.png")
```

Open the PNG, then delete it. Without Playwright and Chromium in the kernel
environment, use the
[Workflow](references/workflow.md#capture-a-current-cell-image) browser capture
recipe.

## Finish: verify, reveal, resolve

After verification, reveal and resolve together using the saved request ID:

```python
import marimo._code_mode as cm
import marimo_lens

ctx = cm.get_context()
mounted = marimo_lens.agent.connect(ctx, identity="F3n...")
context = mounted.context()
cell = ctx.cells["Hbol"]
assert cell.status == "idle" and not cell.errors
diagnostics = mounted.check()
print(diagnostics)
if any(
    item["severity"] == "warning"
    and (
        item["cellId"] == cell.id
        or item["requestId"] == "chat-..."
        or (item["cellId"] is None and item["requestId"] is None)
    )
    for item in diagnostics
):
    raise RuntimeError("Review affected Lens warnings before resolving")
mounted.reveal(
    cell.id,
    duration_ms=4_000,
    label="Revenue",
    message="Refunds are filtered before the total.",
)
print(
    mounted.resolve(
        "chat-...",
        expected_revision=context.revision,
        summary="Filtered refunds before summing revenue and checked the total.",
    )
)
```

Reveal a selection with `mounted.reveal(context.current,
expected_revision=context.revision, duration_ms=4_000)`. If that revision
changed, stop activity and reassess. Chat instructions override older notes.

Resolve answered requests too, even with no edit: the summary is the answer
the analyst sees. When only the analyst can decide, ask and keep the request
open, as with blocked or unverified requests.

Batch shared outcomes. Resolve others separately, passing the returned revision
onward. Selection resolution advances it. Chat leaves it unchanged. Use the
returned revision as the completion receipt and finish the task in that call.

Mention History only when `mounted.record.history` is true.

## Notebook tours

Inspect landmark cells, then reveal a Trail and resolve its chat request.
Use 1 to 16 idle graph cells with no errors:

```python
import marimo._code_mode as cm
import marimo_lens

ctx = cm.get_context()
mounted = marimo_lens.agent.connect(ctx, identity="F3n...")
mounted.reveal(
    [
        {"target": "Hbol", "label": "Inputs", "message": "Monthly revenue by region."},
        {"target": "lEQa", "label": "Revenue", "message": "Compare regions."},
    ],
    duration_ms=None,
)
```

Each step carries its label and message. Dismissal, replacement, and a rerun
or deletion of a referenced cell end the Trail.

## Mounting and deeper reference

For missing Lens, queue `marimo_lens.agent.add_lens_cell(ctx)` inside
`async with cm.get_context() as ctx`, then reconnect in a fresh call. It mounts
`Lens()` with no record. Pass `record=True` (files beside the notebook) or
`record={"keep": "session"}` only when the analyst asks. An existing agent cell
with another record raises `lens_cell_exists`: edit that cell to change it.
For `lens_ambiguous`, inspect `marimo_lens.agent.discover(ctx)` and choose by
the request and dock. Ask if unclear. For `lens_unavailable`, reconnect once
with identity omitted and inspect fresh context.

Read a packaged reference with
`marimo_lens.agent.skill().file("references/workflow.md").read_text(encoding="utf-8")`.

- [Workflow](references/workflow.md): browser capture and recovery.
- [Selections](references/selections.md): multiple selections or notebooks.
- [Setup](references/setup.md): installation and mounting.
- [Targets](references/targets.md): HTML and widgets.
