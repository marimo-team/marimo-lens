---
title: Command line
description: The marimo-lens command prints Lens context for a selection on a notebook file, writes past requests to a notebook's record, and checks the record.
---

# Command line

The `marimo-lens` command works on notebook files and their Lens records with
no kernel or browser. Installing `marimo-lens` adds it, and
`python -m marimo_lens` runs the same commands.

| Command                           | Does                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| [`marimo-lens context`](#context) | Prints the Lens context for a selection on a notebook file. |
| [`marimo-lens record`](#record)   | Writes past requests to a notebook's record.                |
| [`marimo-lens check`](#check)     | Prints the `LR` diagnostics of each notebook's record.      |

[Notebook files](../api#notebook-files) describes how Lens reads a file and
what the file holds.

## `context`

`marimo-lens context NOTEBOOK [options]` prints the context a Lens gives an
agent for a selection on the notebook, built by
[`notebook_context()`](../api#notebook-context):

```bash
marimo-lens context sales.py --cell revenue_chart --note "Central looks off" --mark 0.42,0.31
```

```text
# Request S1 (selection)

Note: "Central looks off"

Part: a point on the output of its producing cell, "revenue_chart".
Image: none (pending).

Trace:
- Cell `vblA` (revenue_chart): idle

Earlier requests on these cells and upstream: none recorded.

Next Lens calls:
- `--format history` output: earlier requests on its cells and upstream, with the statements each undone change lost.
- `--format text` output: the code of the selected cells and the cells upstream, with what each defines and reads.
```

The brief names this command's formats as its next calls, and the absolute
path of the `--image` file as the analyst's view. `--format history` prints what
`context.history(context.request)` returns. Cell states come from the last
run marimo saved beside the notebook, as
[Notebook files](../api#notebook-files) describes.

### Selection options

| Option             | Meaning                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--cell CELL`      | The selected cell's name or ID.                                                                                                               |
| `--note NOTE`      | The analyst's note on the `--cell` selection.                                                                                                 |
| `--mark X,Y`       | A point in fractions of the output, with `0,0` at its top-left corner. `X,Y,WIDTH,HEIGHT` marks a region. The default marks the whole output. |
| `--dom-hint JSON`  | The element under the mark in the [DOM hint shape](./context#dom-hint-shape), such as `'{"tag": "path", "ariaLabel": "region: Central"}'`.    |
| `--image PNG`      | The PNG the analyst saw. It belongs to the `--cell` selection, or else to the last `--selection`.                                             |
| `--selection FILE` | A JSON file, or `-` for standard input, holding a selection mapping as the widget sends it, or a list of them. Repeat it for more.            |

Name at least one selection. The `--cell` selection comes after every
`--selection` and is the current request. A selection mapping's `snapshot`
names its PNG by `sha256`, so pass `--image` with a mapping whose image status
is `available`.

### Record and output options

| Option             | Meaning                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `--record PATH`    | Read this record file. The default reads the record beside the notebook in `__marimo__/lens/`.                                 |
| `--no-record`      | Build the context of a Lens that keeps no record.                                                                              |
| `--format brief`   | The [brief](./context#brief), the default.                                                                                     |
| `--format text`    | The [standalone text](./context#standalone-text-structure).                                                                    |
| `--format history` | One JSON object per line for each recorded request on the current request's cells and upstream, and no lines when none exists. |
| `--format json`    | One JSON object with `request`, `references`, `brief`, `text`, and `history`, which is `null` with `--no-record`.              |

The command exits with `2` and names the change to make when marimo cannot
load the notebook, the record path names no file, `--cell` names no cell, or
a selection is invalid.

## `record`

`marimo-lens record NOTEBOOK REQUESTS` appends each selection or chat request
in `REQUESTS`, oldest first, to the record beside `NOTEBOOK`, through
[`record_request()`](../api#record-request). It prints each request's ID:

```bash
marimo-lens record wars.py requests.json
```

```json
[
  {
    "before": "states/r1-before.py",
    "after": "states/r1-after.py",
    "selection": {
      "cell": "region_chart",
      "note": "Leave the two cross-regional wars out of the charts.",
      "id": "r1"
    },
    "summary": "Filtered the Cross-Regional wars out of the wars the charts show.",
    "resolved_at": "2026-09-02T10:12:00Z"
  },
  {
    "before": "states/r1-after.py",
    "after": "states/r2-after.py",
    "chat": {
      "note": "Name the wars the charts leave out.",
      "cells": ["region_chart"],
      "id": "r2"
    },
    "summary": "Listed the two cross-regional wars under the chart.",
    "resolved_at": "2026-09-02T10:40:00Z"
  }
]
```

```text
r1
r2
```

Each request takes `before`, `after`, a `selection` or a `chat`,
`resolved_at`, and optional `summary` and `opened_at`. A selection takes the
[`Selection`](../api#selection) fields `cell`, `note`, `mark` as a list,
`dom_hint`, `image`, and `id`. A chat takes the
[`ChatRequest`](../api#chatrequest) fields `note`, `cells` as a list, and
`id`. Paths are relative to `REQUESTS`, and `-` reads the list from standard
input with paths relative to the working directory. The command stops with
exit `2` at the first request it cannot record, names it as `request N`, and
keeps the requests it already wrote. A request with an `id` that the record
already holds at the same `resolved_at` fails, so a batch whose requests carry
IDs fails on its first recorded request when it runs again. Drop the written
requests and run the rest.

## `check`

`marimo-lens check NOTEBOOK... [--json]` runs the `LR` rules on each notebook
file and its record, for example in CI:

```bash
marimo-lens check analysis.py
```

```text
analysis.py: LR001 unreadable-record-line [warning] The record holds 1 line Lens cannot read: a fragment of an interrupted write, an edit, or a newer schema.
```

[Checks](./checks#check-a-notebook-file) lists the rules, the exit codes, and
the JSON Lines output of `--json`.
