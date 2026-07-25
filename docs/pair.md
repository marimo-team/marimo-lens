# marimo Pair integration

Point at a notebook result and ask [marimo Pair](https://marimo.io/pair) about
“this” without copying cell IDs, code, or screenshots. Pair starts with the
selected cell and related notebook structure, then loads an image of your
selection when needed.

Connect Pair to the same live notebook that contains Lens.

## Ask about a selected result

1. Select the output you want Pair to inspect.
2. Add a note when the visual mark needs more context.
3. Ask Pair about the selection.

For example:

> Why did revenue drop here?

> Check whether this region matches the filter I selected.

> Update the aggregation behind this result and verify the chart.

The selection identifies the exact output cell, point or region, and optional
note. Pair can read related notebook cells or request image evidence as the
task requires. When several open selections point into one output, the
requested cell image shows every point and region in one raster.

## Follow Pair's work

Pair can use Lens to keep the notebook workflow visible:

- **Working** marks the cell Pair is changing or checking. Pair can choose a
  short task label such as **On it** or **Checking**.
- **Reveal** brings one verified or explanatory result into view.
- **Addressed** completes the selected request and moves it into **History**.

Working marks never scroll the notebook. Reveal scrolls once and keeps keyboard
focus in place. The working mark stays present while Pair applies, runs, and
verifies the requested changes. Pair resolves all selections completed by the
same verified change in one operation, then reveals the primary result as its
final notebook action.

## Reopen a completed selection

Open **History** from the selection sheet, choose an addressed item, then press
**Reopen**.

Lens restores the original cell, note, and point or region as the current
selection. It starts a fresh marked image capture from the current output.
Pair can also see the prior completion time and summary while working on the
reopened selection.

Use **Clear History** after you finish with the History items. Open selections
and their marked images stay in place.

## Guide Pair to another selection

When several selections are open, select the row you want to make current.
Pair starts from that current selection on the next request.

Add or edit the note when the mark alone could support several interpretations.
The note stays with the selection across output rerenders and reopen.

[Selections](./selections) covers point and region behavior, marked images,
keyboard use, and output changes.
