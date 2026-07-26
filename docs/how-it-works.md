---
title: How it works
description: How marimo-lens connects a browser selection to live notebook context.
---

# How it works

`marimo-lens` connects a point or region on a rendered output to the
[marimo](https://marimo.io/) cell that produced it. Lens uses
[anywidget](https://anywidget.dev/) to connect its browser interface to a
Python model in the notebook kernel.

<ol class="lens-context-flow" aria-label="Lens human-agent workflow">
  <li>
    <strong>Select an output</strong>
    <span>You mark a point or region and describe the requested change.</span>
  </li>
  <li>
    <strong>Connect to the notebook</strong>
    <span>Lens links the mark to its cell, related cells, and image.</span>
  </li>
  <li>
    <strong>Revise the code</strong>
    <span>The agent changes notebook code and checks the updated output.</span>
  </li>
  <li>
    <strong>Review the result</strong>
    <span>Lens shows progress and returns the result to the notebook.</span>
  </li>
</ol>

## Browser and Python responsibilities

| Browser                                                      | Python                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Finds rendered outputs and handles pointer or keyboard input | Stores open selections and completed History items            |
| Positions markers, the selection sheet, and agent feedback   | Reads the live marimo runtime and builds `LensContext`        |
| Captures marked images of selected outputs                   | Validates selection changes, activity, reveal, and resolution |

The two sides exchange compact selection records and explicit commands through
the widget connection. PNG bytes travel separately from ordinary selection
state.

## Selection context

1. Pointer release records the exact output cell ID and a normalized point or
   rectangle. The cell ID keeps the selection attached when the output
   rerenders.
2. Python validates and stores the selection. The browser captures a marked PNG
   separately when the output can be captured.
3. `lens.context()` reads one snapshot from the marimo kernel.
   marimo already tracks which cells depend on which other cells, so Lens can
   gather the selected cell and its relevant upstream cells.
4. Lens returns compact selection records immediately. When `context.text` is
   read, it adds cell source and relevant control values within a fixed size
   limit.

The note and cell context give the agent text it can read. The marked PNG keeps
the visual focus that motivated the request. An integration can load either
form independently.

## What an agent receives

An agent runs against the same notebook kernel and starts from the current
selection:

1. The selection reference identifies the cell, point or region, and optional
   note.
2. The notebook context supplies the selected cell and related upstream
   structure.
3. An image of the selection or current output supplies pixel-level detail when
   the task depends on what was rendered.

Images stay outside the text context. The agent can start with notebook
structure and load pixels when visual detail affects the task.

## Agent feedback

Notebook agents work through four Python methods:

- `context()` reads the current selections and notebook context.
- `activity()` marks the cell being changed or checked.
- `resolve()` moves completed selections into History with an optional summary.
- `reveal()` brings one verified or explanatory result into view.

The Python adapter reads cells, dataflow relationships, source, and relevant
controls from the active kernel. The browser adapter finds rendered output
roots and keeps markers attached as outputs change.

Try the methods in the [live Python API example](./api#try-the-methods). The
rest of the API page defines their lifecycle, errors, and limits. The
[Pair integration guide](./pair) shows the workflow with
[marimo Pair](https://marimo.io/pair).
