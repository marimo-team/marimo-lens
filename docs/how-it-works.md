---
title: How it works
description: How marimo-lens connects a browser selection to live notebook context.
---

# How it works

`marimo-lens` connects a point or region in the browser to the live marimo cell
that produced it. Lens is built with `anywidget`, which connects a browser view
to a Python model in the notebook kernel.

## Browser and Python share the work

| Browser                                                      | Python                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Finds rendered outputs and handles pointer or keyboard input | Stores open selections and completed History items            |
| Positions markers, the selection sheet, and agent feedback   | Reads the live marimo runtime and builds `LensContext`        |
| Captures marked images of selected outputs                   | Validates selection changes, activity, reveal, and resolution |

The two sides exchange bounded selection records and explicit commands through
the widget connection. PNG bytes travel separately from ordinary selection
state.

## From a gesture to notebook context

1. Pointer release records the exact output cell ID and a normalized point or
   rectangle. The cell ID keeps the selection attached when the output
   rerenders.
2. Python validates and stores the selection. The browser captures a marked PNG
   separately when the output can be captured.
3. `lens.context()` reads one bounded snapshot from the live marimo kernel.
   marimo already tracks which cells depend on which other cells, so Lens can
   gather the selected cell and its relevant upstream cells.
4. Lens returns compact selection references immediately. It builds bounded
   text with cell source and relevant control values when `context.text` is
   first read.

## Pair loads evidence as needed

Pair runs against the same notebook kernel and starts from the current
selection:

1. The selection reference identifies the cell, point or region, and optional
   note.
2. The notebook context supplies the selected cell and related upstream
   structure.
3. An image of the selection or current output supplies pixel-level detail when
   the task depends on what was rendered.

These layers have separate limits. Images stay outside compact references and
text, so Pair can begin with notebook structure and load pixels when they affect
the task.

## Results return to the notebook

Pair and other integrations work through four Python methods:

- `context()` reads the current selections and notebook context.
- `activity()` marks the cell being changed or checked.
- `reveal()` brings one verified or explanatory result into view.
- `resolve()` moves completed selections into History with an optional summary.

Lens keeps its use of marimo internals behind small adapters. The Python adapter
reads cells, dataflow relationships, source, and relevant controls from the
active kernel. The browser adapter finds rendered output roots and keeps
markers attached as outputs change.

The [Python API](./api) defines the public methods, lifecycle, errors, and
limits used by Pair and other integrations.
