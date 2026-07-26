# marimo Pair integration

[marimo Pair](https://marimo.io/pair) connects an agent to a live marimo
notebook. With Lens mounted, Pair can start from the result you marked, inspect
the cells behind it, and return the verified result to the notebook.

Create a request in [Getting Started](./getting-started) before connecting an
agent.

## Install and connect Pair

Install or update Pair using the
[marimo Pair installation guide](https://github.com/marimo-team/marimo-pair#install).
It covers [Agent Skills](https://agentskills.io/) clients and the Claude Code
plugin.

The Getting Started command runs marimo with `--no-token`, so Pair can discover
the local session. Open the notebook UI before asking Pair to connect. For an
authenticated server, follow Pair's
[prerequisites](https://github.com/marimo-team/marimo-pair#prerequisites).

## Send the first request

1. Select the output you want Pair to inspect.
2. Add a note such as “Make the bars blue.”
3. Ask Pair to resolve the Lens request.

For example:

```text
Resolve my Lens request.
```

The selection identifies the exact output cell, point or region, and optional
note. Pair reads related notebook cells and opens an annotated image when the
task depends on visual detail.

## Pair workflow

Pair uses Lens to keep the work visible in the notebook:

1. An activity label marks the cell Pair is changing or checking.
2. Pair edits and runs the notebook through the live kernel.
3. Pair checks that the affected cells completed successfully.
4. Lens moves the completed selection into **History**.
5. Lens brings the verified result into view.

Working marks never scroll the notebook. Reveal scrolls once and keeps keyboard
focus in place. The working mark stays present while Pair applies, runs, and
verifies the requested change.

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
together with one summary. A current cell image can show every open point and
region on the same output.

[Selections](./selections) covers point and region behavior, annotated images,
keyboard use, and output changes. Pair setup and troubleshooting remain in the
[marimo Pair repository](https://github.com/marimo-team/marimo-pair).
