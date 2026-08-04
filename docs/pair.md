---
title: Use with marimo Pair
description: Connect marimo Pair to a Lens request or guided notebook walkthrough.
---

# Use with marimo Pair

[marimo Pair](https://marimo.io/pair) connects an agent to a live marimo
notebook. With Lens mounted, Pair can start from the result you marked, inspect
the cells behind it, and return the verified result to the notebook. Pair can
also reveal a reading-order walkthrough of existing cells.

Mount Lens by following [Getting started](./getting-started) before connecting
an agent.

## Install Lens and Pair

Install the Lens and Pair skills:

```bash
npx skills add marimo-team/marimo-lens
npx skills add marimo-team/marimo-pair
```

The [marimo Pair installation guide](https://github.com/marimo-team/marimo-pair#install)
also covers upgrades, the `uvx` installation command, and the Claude Code
plugin.

The Lens skill uses Pair to inspect, change, and rerun cells in the active
notebook kernel.

The Getting Started command runs marimo with `--no-token`, so Pair can discover
the local session. Open the notebook UI before asking Pair to connect. For an
authenticated server, follow Pair's
[prerequisites](https://github.com/marimo-team/marimo-pair#prerequisites).

## Send the first request

1. Select the output you want Pair to inspect.
2. Add a note such as "Make the bars blue."
3. Ask Pair to resolve the Lens request.

For example:

```text
Resolve my Lens request.
```

The selection identifies the exact output cell, point or region, and optional
note. Pair reads related notebook cells and opens an annotated image when the
task depends on visual detail. Image inspection requires the notebook kernel
and Pair's image reader to share a filesystem. Pair continues from cell, graph,
and selection text when a remote kernel does not expose the temporary image
file.

## Request a notebook overview

Ask Pair for an overview with Lens mounted:

```text
Use Lens to give me an overview of this notebook.
```

Pair inspects the ordered notebook cells and graph, then reveals a short route
through existing inputs, transformations, and results. A selection adds a
human point or region to that context. The walkthrough also works when there
are zero selections.

## Pair workflow

For a notebook change, Pair uses Lens to keep the work visible:

1. An activity label marks the work cell as soon as Pair identifies it.
2. Pair edits and runs that cell through the live kernel while activity remains visible.
3. Pair checks that the affected cells completed successfully, then stops activity.
4. Lens brings the verified result into view.
5. Lens moves each addressed selection into **History** and presents its receipt.

Working marks preserve the current scroll position when the cell is visible and
bring an offscreen work cell into view once. Reveal follows the same scroll and
focus behavior. Activity and reveal labels sit above the target cell at its
top-right edge. The working mark stays present while Pair applies, runs, and
verifies the requested change. Their headings name the current notebook task
or result. Pair gives each reveal enough time for the user to orient to the
cell and read its message comfortably. The addressed receipt appears after the
final reveal finishes.

## Reopen a selection

Open **History** from the selection sheet, choose an addressed item, then press
**Reopen**.

Lens restores the original cell, note, and point or region as the current
selection. It starts a fresh annotated image capture from the current output.
Pair can also see the prior completion time and summary while working on the
reopened selection.

## Multiple selections

When several selections are open, select the row you want to make current.
Pair treats that selection as the likely focus of the next request.

Add or edit the note when the mark alone could support several interpretations.
When one verified change addresses several selections, Pair can complete them
together with one summary. `context.images` keeps each selection's annotated
capture, while `cell_image()` returns a fresh rendering without Lens markers.

[Selections](./selections) covers point and region behavior, annotated images,
keyboard use, and output changes. Pair setup and troubleshooting remain in the
[marimo Pair repository](https://github.com/marimo-team/marimo-pair).
