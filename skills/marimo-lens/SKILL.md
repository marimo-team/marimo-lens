---
name: marimo-lens
description: >-
  Use Lens to turn a user's point, region, or note on a rendered notebook or
  configured DOM target into a bounded task against producing cells or host
  source. Work through a live marimo code-mode environment, using marimo-pair
  when the current agent needs that connection. Inspect the selected target,
  producer context, and available images, then show activity on that target,
  verify the result, reveal it, and resolve the selection to History. Use when
  the user refers to "this" output, asks to address Lens selections, requests a
  notebook walkthrough, co-creates HTML or anywidget output for Lens, or
  invokes `$marimo-lens address` for every open selection.
---

# Work with marimo Lens

## Work alongside the user

Default to a colleague's voice across chat, activity, popovers, and resolution
summaries. Show what you changed or found, why it matters to the shared task,
and what we could look at next. Keep it conversational and concise; assume
the user's competence. Use a teaching tone when the user asks for instruction.

Use "I" for work you actually did and "let's" for shared exploration. A
read-only walkthrough should describe existing findings without claiming you
made the changes. Prefer "I removed the duplicates and checked the totals" or
"This growth case exceeds capacity. Let's look at the trial next." Avoid lesson
framing such as "Now you will learn", quizzes, or directing the user to notice
each feature. Labels should name the change or finding, such as "Duplicates
removed" or "Growth exceeds capacity".

## Quick walkthrough

In an active code-mode session, the loaded `marimo_lens.agent` capability already
contains the complete walkthrough API. Reuse it; do not reload the same help,
full skill, or reference recipe. Route introductions and exploratory tours here,
without entering the selection/image lifecycle below.

If the landmarks are not already known, read a compact outline of `ctx.cells`
(IDs, names, statuses, and first code lines). Batch-read three to five useful
cells, their errors, and relevant live values. Explain the question, evidence,
main result, and next step in reading order. Reuse verified context from the
conversation and show the route promptly; do not audit every supporting table.

```python
mounted.show_trail(
    [
        {
            "cell_id": "<verified cell ID>",
            "label": "What we're checking",
            "message": "<what you changed or found, and why it matters>",
        },
        # Add the other verified landmarks in reading order.
    ]
)
```

Use short, concrete labels and one takeaway per step. The user controls the
reading pace through the popover stepper. No sleeps or polling are needed.
A text/data tour does not need selection context, PNG captures, or resolution.
Do not edit or rerun cells unless requested. If more investigation is required,
start meaningful activity on the first relevant landmark while verifying the
rest, then show the Trail to replace it. Return control after showing it.

## Load the installed workflow

For selection work, images, or target authoring, load the installed workflow
once in the notebook kernel:

```python
import marimo_lens.agent

help(marimo_lens.agent)
skill = marimo_lens.agent.agent_skill()
print(skill.body)
```

Read the complete output and follow the instructions that match the installed
Lens version. Resolve supporting files with `skill / "reference/workflow.md"`.
If kernel access is not available yet, connect through Pair first.

## Execution environment

Run this skill in a live marimo code-mode environment. If the current agent can
already execute code in the notebook kernel, continue with the Lens workflow.

Otherwise, run:

```console
npx skills use "https://github.com/marimo-team/marimo-pair" --skill "marimo-pair"
```

If `npx` is unavailable, use Deno through `uvx`:

```console
uvx deno x -y skills use "https://github.com/marimo-team/marimo-pair" --skill "marimo-pair"
```

Follow the generated skill instructions now. Read the complete output,
redirecting it to a temporary file first if necessary. Resolve relative paths
from the supporting-files directory it provides. Once connected, load the
[installed Lens workflow](#load-the-installed-workflow).

Notebook discovery, connection, scratchpad execution, and general notebook
inspection and mutation belong to the active code-mode integration, such as
Pair. This skill owns Lens grounding, images, activity, reveals, and resolution.

Activate this workflow after the request identifies Lens work through a
selection, output reference, overview, walkthrough, or co-creation of output
that will receive Lens feedback.

Use [reference/workflow.md](reference/workflow.md) for Lens-specific kernel-call
recipes, image-byte handling, and focused operation recovery. `SKILL.md` owns
the workflow and decision policy.

## Modes

Read the word that follows the skill invocation as the mode. `$marimo-lens`
alone routes from the request and `snapshot.current`.

`$marimo-lens address` inspects every outstanding selection in
`snapshot.references["selections"]`, including its note and cell or image
evidence. Address each actionable request, verify the result, then resolve its
selection. Keep ambiguous, blocked, or unverified selections open and report
why.

## Choose the mounted target scope

Call `lens_agent.connect(ctx)` before creating a Lens cell. Authored and
automatically mounted Lens instances are reused, including those with no named
notebook variable. Read the notebook and current browser surface when no Lens
is discoverable. If a mount is still rendering, end the kernel call and retry
after browser readiness before adding another widget.

- Use `Lens()` for an ordinary marimo notebook. Notebook outputs are selectable
  by default.
- A host integration may supply `dom_selector` for additional rendered roots.
  Read that host's skill or public API and reuse its selector policy. Do not
  copy host element names into this workflow. Choose light-DOM roots and let
  Lens follow interactions into their open shadow trees.
- Compose task-specific page regions into the host selector when feedback can
  target structure, copy, spacing, or styling. Avoid `*` and selectors that
  turn every nested wrapper into a target.

For an ordinary notebook, `lens_agent.add_lens_cell(ctx)` mounts the default
Lens. A host document may require an authored Lens cell so it can pass and
render the host-owned selector. Follow the host skill for that mount.

```python
from marimo_lens import Lens

lens = Lens()
lens
```

## Preserve meaning when co-creating outputs

When creating or revising HTML or anywidgets with the user, attach Lens metadata
to meaningful regions such as a chart, metric, or comparison panel. Encode what
each region represents, its units or grouping, and where it is produced. These
short descriptions carry the authored structure into later feedback and edits.

| Attribute                                               | Meaning                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `data-marimo-lens-label`                                | Human-readable name, up to 256 UTF-16 units.                                                             |
| `data-marimo-lens-detail`                               | Context accompanying the name, such as measure, units, grouping, or filter, up to 512 UTF-16 units.      |
| `data-marimo-lens-render-source`                        | JSON with a real project `path` and optional `symbol`, `line`, and `column` locating the rendering code. |
| `data-marimo-lens-context`                              | Preferred image-context container for a configured DOM target.                                           |
| `data-marimo-lens-cell-id`, `data-marimo-lens-selector` | A resolved producing cell ID and optional symbolic value selector. Lens does not execute the selector.   |
| `data-marimo-lens-inputs`                               | Space-separated IDs of source elements declaring the region's complete notebook inputs.                  |

For example, render this through `mo.Html` or an anywidget's renderer, replacing
the rendering reference with the actual file and symbol:

```html
<section
  id="regional-revenue"
  data-marimo-lens-label="Revenue by region"
  data-marimo-lens-detail="Monthly totals · USD · grouped by region"
  data-marimo-lens-render-source='{"path":"widgets/revenue.js","symbol":"render"}'
  data-marimo-lens-context
>
  <h3>Revenue by region</h3>
  <!-- Render the comparison here. -->
</section>
```

Labels inside ordinary notebook output can describe the whole output. To make
this region independently selectable, include `#regional-revenue` in the mounted
Lens's `dom_selector` and keep its ID unique and stable across renders. For an
anywidget, put these attributes on a light-DOM wrapper. Rendering references
must be on the selected root, even when its content lives in a shadow tree.

Use the host's resolved cell IDs and source records for notebook provenance.
Native notebook targets already identify their producing cell. Custom labels
and file references do not establish notebook inputs. Omit unresolved source
attributes, since invalid input references make a configured target unavailable.

Check the target indicator and a new selection's `description` after rendering.
Lens captures the label, detail, and rendering reference at selection time and
retains them through History and reopen. Updating metadata affects future
selections. See the [metadata guide](https://marimo-team.github.io/marimo-lens/custom-metadata)
for interactive examples and the complete host contract.

## Connect and read the request

Connect to Lens and take one detached context snapshot in the same
kernel call:

```python
import json

import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

ctx = cm.get_context()
mounted = lens_agent.connect(ctx)
snapshot = mounted.context()
print(
    json.dumps(
        {
            "identity": mounted.identity,
            "revision": snapshot.revision,
            "current": snapshot.current,
            "selections": [
                {
                    "id": selection["id"],
                    "target": selection["target"],
                    "cells": selection["cells"],
                }
                for selection in snapshot.references["selections"]
            ],
            "selectionCount": len(snapshot.references["selections"]),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
)
```

Use `ctx` for notebook cells, graph relationships, globals, and runtime status.
Use `snapshot` for Lens targets, bounded context, and captured evidence.

Keep `mounted.identity`, `snapshot.revision`, and the chosen selection ID
together. Reconnect in later kernel calls with
`connect(cm.get_context(), identity=identity)`. Retry without the saved identity
when that Lens becomes unavailable.

Passing `ctx` includes Lens objects from notebook globals alongside browser-ready
instances in the active runtime. When `connect(ctx)` reports `lens_unavailable`,
allow any pending mount to render and retry in a fresh kernel call. If none
exists, use the
[mount recipe](reference/workflow.md#mount-lens-when-unavailable) for a notebook
or follow the host integration's mount workflow. Connect again in a fresh
kernel call after the target document renders Lens.

Keep the first read compact. Print the identity, revision, current selection,
and selection count. Do not print `snapshot.text`, every cell body, or the full
notebook graph during connection. Read the selected target's producer cells and
bounded graph ancestors, then expand only when a concrete uncertainty requires
another cell.

In selection-address mode, do not iterate over `ctx.cells` or print a notebook
inventory. Notebook-order enumeration belongs to explicit overview and
walkthrough requests.

When `connect(ctx)` reports `lens_ambiguous`, use a saved identity or call
`lens_agent.discover(ctx)` to get available `MountedLens` handles. Inspect their
identities and compact current selections, then choose the instance that matches
the request. Discovery returns an empty tuple when none are available and never
mounts a widget. Order does not indicate browser ownership. Ask the user which
instance to use if the evidence cannot distinguish them. Report Lens as
unavailable when adding or rendering it fails.

`snapshot.current` is the likely referent for "this", "here", or "the selected
target". The explicit request takes priority over an older selection note. An
empty selection list describes the current attention state. Continue an
explicit overview or walkthrough through the notebook's ordered cells and
graph.

## Start meaningful activity

Choose the relevant `SelectionReference`, then start activity against that
selection. The selected surface owns presentation when its producer list is
empty, contains one cell, or contains several cells.

```python
import json

import marimo._code_mode as cm
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect(cm.get_context(), identity="F3n...")
snapshot = mounted.context()
selection = snapshot.current
if selection is None:
    raise RuntimeError(
        "Lens has no current selection; use a cell-addressed overview or walkthrough"
    )

activity = mounted.start_activity(
    selection,
    expected_revision=snapshot.revision,
    label="Checking this result",
    message="I'm checking this result against the data that produced it.",
)
print(
    json.dumps(
        {
            "activity": activity,
            "revision": snapshot.revision,
            "selectionId": selection["id"],
        },
        sort_keys=True,
    )
)
```

Keep the returned `activity` value exactly as printed. It is a JSON-safe opaque
owner for this activity. A later `stop_activity(activity)` clears the
presentation when this handle still owns it. Starting newer activity returns a
new handle, and a delayed stop for an older handle leaves the newer presentation
visible.

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
Reveal replaces activity directly, so a separate stop is unnecessary on the
successful path. Stop the owned handle when abandoning or recovering work.

## Inspect the required evidence

Route work from `selection["target"]["kind"]` before planning a mutation:

- `notebook`: Inspect the producing cell and its required graph neighbors.
- `dom`: Use `documentPath` and `domSelector` to locate the authored view region.
  Treat `cells` as related provenance. A DOM target can have no producing cell.

For a DOM target, read `target["sources"]` to distinguish exact notebook values
defined by the same cell. Match the selectors to the producing code and inspect current
values through the active notebook integration before changing notebook logic.

Read `selection.get("description")` for the captured name, detail, and rendering
reference. Use that authored context to interpret the region and locate its
implementation, then verify against current source and values. Descriptions are
optional and can be omitted from bounded context.

`documentId` is an opaque browser-document identity. Preserve it inside the
`SelectionReference`; do not construct, compare, or pass it separately.

Use the host integration's skill and source tools for authored view changes and
browser handoff. The exact selector locates the rendered element.
`domHint.path`, labels, and text provide a shorter readable description.
Inspect computed styles and nearby elements fresh in the browser when the
request needs them.

Read selected cells and required graph neighbors before changing notebook
logic. `snapshot.text` contains bounded standalone context. For an aggregate
mark, identify the plotted measure and its entity key. When an upstream join
can multiply entities, compare the row count with the distinct entity count and
name the plotted unit precisely.

For an overview, use `ctx.cells` for notebook order and `ctx.graph.cells` for
executable graph membership. Read non-graph cells when they clarify the
narrative, but do not use them as activity or reveal targets. Choose a short
graph-member route through setup, inputs, transformations, and results, and
reveal that route in notebook order when the selection list is empty too.
Use the [Trail guidance](#quick-walkthrough) to plan the route and pace it.

Selection PNGs are annotated capture-time evidence. Read the selection PNG
when it supplies the required visual context. Start a fresh cell capture when
the task depends on the current full-cell rendering, such as after a mutation.
Do not start a full-cell capture as an optional side effect.

For a point or region request about a visible mark, open the selection PNG
before naming the mark, chart interval, trend, color, layout, or activity task.
A DOM hint locates nearby rendered content. Treat its text and path as supporting
evidence, not visual truth. Make visual claims only after the image reader
returns visible pixels.

```python
selection = snapshot.current
selection_png = snapshot.images.get(selection["id"]) if selection is not None else None
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
        "selection_png": snapshot.images.get(selection["id"]),
    }
    for selection in snapshot.references["selections"]
]
```

Inspect each workset item's note, target, producing cell statuses, and snapshot status.
Open each available `selection_png` before making a visual claim about that
selection. Several selections can point to one target while marking
different evidence, so inspect each annotated image. Keep blocked or ambiguous
items in the workset until they can be reported as open.

Request a fresh cell PNG after confirming that a notebook cell is available.
Follow the [cell-image recipe](reference/workflow.md#capture-a-current-cell-image)
across kernel calls. Finish the current capture before requesting another cell.

When the image reader requires a path, use the
[image-byte recipe](reference/workflow.md#write-image-bytes-for-inspection).
Delete the private path after the image reader returns. Make visual claims only
after it returns visible pixels.

Check the available tools before requesting images. If the session exposes
only text results and no image reader, or the reader reports that it cannot
display images, treat visual inspection as unavailable. Skip capture and
image-inspection attempts that cannot inform the task. Python image objects,
dimensions, hashes, base64, and OCR do not establish visual inspection.
Delete the temporary path and skip later image-reader calls unless the reader
capability changes. Verify through code, data, cell status, and errors. State
the visual coverage limit in the final response, and attribute appearance
claims supplied by the user or a source to that observer.

## Trail lifetime

`show_trail(steps)` takes 1–16 ordered steps with `cell_id`, a short `label`
(up to 40 UTF-16 units), and an optional `message` (up to 1,000). It returns
`None` and saves nothing. Use the [quick walkthrough](#quick-walkthrough) path
for introductions and real-time exploration; a longer example is in the
[Trail recipe](reference/workflow.md#show-a-trail).

The popover holds each step until navigation or dismissal. Referenced cell or
upstream changes end the Trail. Verify changed content before showing a new
one, and refresh cell IDs after a kernel restart. Activity, timed reveal,
another Trail, or page refresh replaces or ends the presentation.

## Apply, verify, and present

Use this lifecycle for each addressed selection:

1. Capture `LensContext` and its revision.
2. Choose the relevant `SelectionReference`.
3. Start activity against that selection.
4. Inspect its producing cells and host source.
5. Apply the change.
6. Verify against fresh runtime and browser evidence.
7. Reveal the selected target, replacing activity.
8. Resolve with a summary of the outcome and verification in the same call.

Call `reveal()` before `resolve()` with the same captured revision, then end
the kernel call. History updates immediately; the browser shows the reveal
before its receipt, using the retained History target when needed. Use the
hold for independent reading or planning. Keep notebook edits and revisioned
Lens mutations ordered.

Keep selection-addressed activity visible while inspecting and editing its
producer cells or host source. The selection remains the presentation target.
Verify changed cells in a fresh kernel call. Each claimed result must be idle
and free of relevant errors. Inspect a fresh cell image for notebook visual
work.

For host view work, inspect the saved source, activate the exact view, and
collect fresh browser evidence at desktop and narrow widths. Compare the result
with the selection PNG. A notebook cell capture does not prove page layout,
CSS, or authored DOM behavior.

Give each activity and reveal a contextual `label`. Name the notebook object
and action or result, such as `Joining artist records`, `Checking image
coverage`, `Source tables`, or `Updated chart`. Use `message` for one concise
supporting sentence. Vary labels across a walkthrough.

Keep labels within 40 UTF-16 code units. Activity messages accept 240 UTF-16
code units, reveal messages accept 1,000, and resolution summaries accept 240.
Prefer short text that leaves detailed evidence in the notebook cell.

When the request asks for the next view, add the smallest view that answers the
immediate uncertainty. Verify and return that result before pursuing analyses
that belong to likely follow-up questions.

Create output-facing result cells with `hide_code=True` unless the user asks to
inspect the implementation. This keeps the result cell compact enough for
activity and reveal framing.

When an existing verified cell already answers the request, take the no-change
path. Read that cell, confirm its status and relevant errors, inspect a fresh
cell image when the claim is visual, then reveal and resolve. Do not enumerate
the full notebook or create a duplicate cell.

After verification succeeds, read fresh Lens context and find the same
selection ID. Reassess its note, target, and revision when Lens state changed.
Reveal that `SelectionReference` with the fresh captured revision. Set
`duration_ms` long enough for the user to orient to the selected surface and
read its message. Resolve the verified IDs immediately after sending the
reveal; completion needs no wait between those calls.

Let the result remain visible for its hold before starting the next activity
or reveal, since either replaces the current presentation. Read the next
request or prepare its plan during this time. The receipt's display timer does
not require an additional agent wait.

Reveal each distinct selected surface before resolving it. Selections on one
verified surface can share one reveal and batch resolve. Start with
`revision = snapshot.revision`. When results or rationales differ, assign the
revision returned by each resolve and carry it into the next call. Follow the
[presentation recipe](reference/workflow.md#present-and-resolve-across-calls)
for the kernel-call sequence.

Pass `summary=` on each resolve call so the user can read what happened beside
the original request in History. Name the concrete change or finding and what
you verified, rather than a generic "Done". For a no-change resolution, explain
why the verified result already answers the request. A batch attaches the same
summary to every History entry; resolve separately when outcomes differ.

The addressed receipt is the final presentation and shows the same summary.
Keep it to one short sentence of at most 240 UTF-16 code units. Put detailed
evidence in notebook cells and reveal messages. On `revision_conflict`, leave
selections open, stop the saved activity handle, reconnect, and reassess fresh
context. Start new activity if work continues.

An owning-document **Target unavailable** notice is transient browser state.
Keep the activity handle while the host view rebuilds and verify that the target
reattaches. Other rendered documents ignore selection-addressed feedback.

Finish after the walkthrough when no selection was addressed. Keep selections
open when verification fails or the next step needs user input. Leave activity
visible with a concrete label and message that describe that state.

Delete every temporary image path after its final image-reader call.
