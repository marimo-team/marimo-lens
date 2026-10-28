---
title: Command line
description: The marimo-lens command prints Lens context for a selection on a notebook file and checks the notebook's record.
---

# Command line

The `marimo-lens` command works on notebook files and their Lens records with
no kernel or browser. Installing `marimo-lens` adds it, and
`python -m marimo_lens` runs the same commands.

| Command                           | Does                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| [`marimo-lens context`](#context) | Prints the Lens context for a selection on a notebook file. |
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
| `--note NOTE`      | The analyst's note.                                                                                                                           |
| `--mark X,Y`       | A point in fractions of the output, with `0,0` at its top-left corner. `X,Y,WIDTH,HEIGHT` marks a region. The default marks the whole output. |
| `--dom-hint JSON`  | The element under the mark in the [DOM hint shape](./context#dom-hint-shape), such as `'{"tag": "path", "ariaLabel": "region: Central"}'`.    |
| `--image PNG`      | The PNG the analyst saw.                                                                                                                      |

`--cell` is required. The options describe one [`Selection`](../api#selection),
the current request. To replay selections a widget captured, pass their
mappings to [`notebook_context()`](../api#notebook-context) from Python.

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
