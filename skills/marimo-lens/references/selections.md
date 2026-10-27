# Work from Lens selections

The [core skill](../SKILL.md) covers a single selection and ordinary edits.
Use this reference for multiple selections, cross-notebook discovery, and
revision recovery.

## Read the request

Connect and read the brief as the [core skill](../SKILL.md#start-request-brief-and-code-together)
shows. Use `ctx` for notebook cells, graph relationships, globals, and runtime
status. Use `context` for the requests, Lens targets, bounded context, and
captured evidence.

For address-all requests, also print `context.references["selections"]` so
every selection's note and target are available. Keep `mounted.identity`,
`context.revision`, and the chosen selection ID together across kernel calls.

Keep the first read compact. Do not print `context.text`, every cell body, or
the full notebook graph during connection. Read the selected target's producer
cells and bounded graph ancestors, then expand only when a concrete uncertainty
requires another cell. In selection-address mode, do not iterate over
`ctx.cells` or print a notebook inventory. Notebook-order enumeration belongs
to explicit overview and walkthrough requests.

When `connect(ctx)` reports `lens_unavailable`, retry only if a mount is
pending. If no Lens exists, use the
[core mounting workflow](../SKILL.md#mounting-and-deeper-reference) or the host
integration's mount workflow, and connect again after the target document
renders Lens. Report Lens as unavailable when adding or rendering it fails.

When `connect(ctx)` reports `lens_ambiguous`, use a saved identity or call
`marimo_lens.agent.discover(ctx)`. Inspect each handle's identity and compact
current selection, then choose the instance that matches the request.
Discovery order does not indicate browser ownership. Ask the user which
instance to use if the evidence cannot distinguish them.

`context.current` is the likely referent for "this", "here", or "the selected
target". The explicit request takes priority over an older selection note. An
empty selection list describes the current attention state. Continue an
explicit overview or walkthrough through the notebook's ordered cells and
graph.

### Selections in other notebooks

A Lens belongs to one notebook session and its kernel. `connect(ctx)` and
`discover(ctx)` see only the session that runs the call. When the request
refers to selections this Lens does not hold, list the live notebooks through
the code-mode integration. With marimo pair, `marimo pair notebook list`
reports each notebook's path and server URL. To list several servers in one
call, pass `--url` once per server. Run this read-only block in every listed
notebook concurrently:

```python
import json

import marimo._code_mode as cm
import marimo_lens

open_selections = []
for mounted in marimo_lens.agent.discover(cm.get_context()):
    context = mounted.context()
    open_selections.extend(
        {
            "identity": mounted.identity,
            "id": selection["id"],
            "label": selection["label"],
            "note": selection["note"],
        }
        for selection in context.references["selections"]
    )
print(json.dumps(open_selections, ensure_ascii=False))
```

With marimo pair, save the block to a file and start one
`marimo pair execute --url <URL> --session <session_id> --code-file <file>` per notebook,
passing that notebook's server URL, without waiting for the previous one. Each
result's `stdout` holds that notebook's list.

Address each selection through the session that holds it. A note can ask for
work in another notebook. Make and verify that change through the other
notebook's session, then reveal and resolve the selection with the Lens that
holds it, so the result appears beside the original request.

The editor's code-mode sidebar reaches only its own notebook. When the user
asks about notes or selections and this Lens has none open, tell the user that
this notebook has no open selections and that notes in another notebook are
addressed from that notebook's sidebar or through marimo pair.

## Start meaningful activity

Choose the relevant `SelectionReference`, then start activity against that
selection. The selected surface owns presentation when its producer list is
empty, contains one cell, or contains several cells.

```python
import json

import marimo._code_mode as cm
import marimo_lens

mounted = marimo_lens.agent.connect(cm.get_context(), identity="F3n...")
context = mounted.context()
selection = context.current
if selection is None:
    raise RuntimeError(
        "Lens has no current selection; use a cell-addressed overview or walkthrough"
    )

activity = mounted.start_activity(
    selection,
    expected_revision=context.revision,
    label="Checking this result",
    message="I'm checking this result against the data that produced it.",
)
print(
    json.dumps(
        {
            "activity": activity,
            "revision": context.revision,
            "selectionId": selection["id"],
        },
        sort_keys=True,
    )
)
```

Keep the returned `activity` value exactly as printed. A delayed stop for an
older handle leaves newer activity visible.

Use these addressing rules:

- Pass a `SelectionReference` with its captured revision for every human
  selection, including notebook outputs and DOM targets with zero or several
  producer cells.
- Pass a graph-member cell ID for notebook overviews and walkthroughs that have
  no selection.
- Use `selection["cells"]` as provenance and edit locations. Keep
  `selection` as the activity and reveal target.
- Treat `documentId`, `documentPath`, and `domSelector` as target evidence.
  Pass the stored selection to feedback methods so the browser resolves its
  owning document and surface.

Leave `duration_ms` unset for work spanning context, edits, execution, and
verification. Pass `duration_ms` for a bounded status that should clear itself
after its hold.

Start activity and read the needed context in the same kernel call. Keep it
visible through edits, execution, and verification. At a meaningful phase
change, start new activity with an updated label and retain its new handle.
Stop the owned handle when abandoning or recovering work.

## Inspect the required evidence

Route work from `selection["target"]["kind"]` before planning a mutation:

- `notebook`: Inspect the producing cell and its required graph neighbors.
- `dom`: Use `documentPath` and `domSelector` to locate the authored view region.
  Treat `cells` as related provenance. A DOM target can have no producing cell.

For a DOM target, `target["sources"]` names the cells and, optionally, the
values its author declared for the region. A selector is descriptive: match it
to the producing code and inspect current values through the active notebook
integration before changing notebook logic.

Read `selection.get("description")` for the captured name, detail, and rendering
reference. Use that authored context to interpret the region and locate its
implementation, then verify against current source and values. Descriptions are
optional and can be omitted from bounded context.

`documentId` is an opaque browser-document identity. Preserve it inside the
`SelectionReference`. Do not construct, compare, or pass it separately.

Use the host integration's skill and source tools for authored view changes and
browser handoff. The exact selector locates the rendered element.
`domHint.path`, labels, and text provide a shorter readable description.
Inspect computed styles and nearby elements fresh in the browser when the
request needs them.

Each entry in a request's `cells` carries `codeHash`, marimo's `code_hash`
for the code the cell held when the analyst pointed at it. A different current
`code_hash`, as marimo pair's `view_notebook` reports it, means the cell
changed since, and the note and image describe the earlier output.

For an aggregate mark, Lens names the producing cell, not the rows behind the
mark. Identify the plotted measure and its entity key from the code and values.
When an upstream join can multiply entities, compare the row count with the
distinct entity count and name the plotted unit precisely.

For an overview, use `ctx.cells` for notebook order and `ctx.graph.cells` for
executable graph membership. Read non-graph cells when they clarify the
narrative, but do not use them as activity or reveal targets. Choose a short
graph-member route through setup, inputs, transformations, and results, and
reveal that route in notebook order when the selection list is empty too.
Use the [Trail guidance](../SKILL.md#notebook-tours) to plan the route and pace it.

Selection PNGs are annotated capture-time evidence. Start a fresh cell capture
only when the task depends on the current full-cell rendering, such as after a
mutation. For a point or region request about a visible mark, open the
selection PNG before naming the mark, chart interval, trend, color, or layout.
A generic activity label such as `Checking selection` can accompany image
export. Choose a mark-specific activity label after opening the image. A DOM
hint locates nearby rendered content. Treat its text and path as supporting
evidence. Make visual claims only after the image reader returns visible
pixels.

```python
selection = context.current
selection_png = context.images.get(selection["id"]) if selection is not None else None
selection_status = selection["snapshot"]["status"] if selection is not None else None
cell_png = None
```

A `selection_status` of `outdated` means the marker moved after
`selection_png` was captured.

### Address every open selection

In address mode, build one workset from every open selection and its annotated
capture-time image:

```python
address_workset = [
    {
        "selection": selection,
        "selection_png": context.images.get(selection["id"]),
    }
    for selection in context.references["selections"]
]
```

Inspect each workset item's note, target, producing cell statuses, and snapshot
status. Several selections can point to one target while marking different
evidence, so open each available `selection_png`. Keep blocked or ambiguous
items in the workset until they can be reported as open.

Capture current output after confirming that its cell is available. Use the
core skill's host screenshot path when its browser is available. For capture
through the analyst's browser, follow the
[cell-image recipe](workflow.md#capture-a-current-cell-image). When the image
reader requires a path, write the bytes as the
[core skill's image export](../SKILL.md#start-request-brief-and-code-together)
does, and delete the path after the reader returns.

Check the available tools before requesting images. If the session exposes
only text results and no image reader, or the reader reports that it cannot
display images, treat visual inspection as unavailable. The editor's code-mode
sidebar returns `execute_code` results as text and has no image reader. Skip
capture and image-inspection attempts that cannot inform the task. Python image
objects, dimensions, hashes, base64, and OCR do not establish visual
inspection. Verify through code, data, cell status, and errors. State the
visual coverage limit in the final response, and attribute appearance claims
supplied by the user or a source to that observer.

## Apply, verify, and present

Follow the core skill's inspect, edit, verify, and finish steps for each
addressed selection. When `mounted.record` is not `None`, read
`context.history(cell_id)` for each cell you will edit, and keep earlier
changes that are in force.

Keep selection-addressed activity visible while inspecting and editing its
producer cells or host source. The selection remains the presentation target.
Informational diagnostics describe evidence age or coverage. Address warnings
on affected cells and requests, plus record failures on a Lens that keeps a
record, using the core skill's completion check.

For host view work, inspect the saved source, activate the exact view, and
collect fresh browser evidence at desktop and narrow widths. Compare the result
with the selection PNG. A notebook cell capture does not prove page layout,
CSS, or authored DOM behavior.

Give each activity and reveal a contextual `label`. Name the notebook object
and action or result, such as `Joining artist records`, `Checking image
coverage`, `Source tables`, or `Updated chart`. Use `message` for one concise
supporting sentence. Vary labels across a walkthrough. Labels accept 40 UTF-16
code units, activity messages and resolution summaries 240, and reveal messages
1,000. Keep text short and leave detailed evidence in the notebook cell.

When the request asks for the next view, add the smallest view that answers the
immediate uncertainty. Verify and return that result before pursuing analyses
that belong to likely follow-up questions.

Create output-facing result cells with `hide_code=True` unless the user asks to
inspect the implementation. This keeps the result cell compact enough for
activity and reveal framing.

When an existing verified cell already answers the request, take the no-change
path. Read that cell, confirm its status and relevant errors, inspect a fresh
cell image when the claim is visual, then reveal and resolve with a summary
that explains why the result already answers the request. Do not enumerate the
full notebook or create a duplicate cell.

After verification succeeds, read fresh Lens context and find the same
selection ID. Reassess its note, target, and revision when Lens state changed.
Reveal each distinct selected surface before resolving it. Selections on one
verified surface can share one reveal and batch resolve. Follow the
[presentation recipe](workflow.md#present-and-resolve-across-calls) for the
kernel-call sequence. Set `duration_ms` long enough for the user to orient to
the surface and read its message, and resolve in the same call without waiting.
Let the reveal hold before starting the next activity or reveal, since either
replaces the current presentation.

On `revision_conflict`, leave selections open, stop the saved activity handle,
reconnect, and reassess fresh context. Start new activity if work continues.

An owning-document **Target unavailable** notice is transient browser state.
Keep the activity handle while the host view rebuilds and verify that the target
reattaches. Other rendered documents ignore selection-addressed feedback.

Finish after the walkthrough when no selection was addressed. Keep selections
open when verification fails or the next step needs user input. Leave activity
visible with a concrete label and message that describe that state.

Delete every temporary image path after its final image-reader call.
