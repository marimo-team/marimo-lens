---
title: Checks
description: The LV, LT, and LR rules that Lens.check() runs, the LR rules that python -m marimo_lens check runs on notebook files, and their severities.
---

# Checks

`lens.check()` and `mounted.check()` test the evidence that an agent and the
analyst rely on against the notebook now. Each finding is a `Diagnostic`, shaped
like a [marimo lint](https://docs.marimo.io/guides/lint_rules/) diagnostic:

```python
import marimo._code_mode as cm
import marimo_lens

mounted = marimo_lens.agent.connect(cm.get_context())
for diagnostic in mounted.check():
    print(diagnostic["code"], diagnostic["severity"], diagnostic["message"])
```

```text
LV003 info S1 was selected before cell `Hbol` (revenue_chart) changed, so its note and image describe the earlier output.
```

Every Lens runs the `LV` and `LT` rules. A Lens built with `record` also runs
the `LR` rules on its record. An empty list means every check passed. Run
`check()` during a code-mode call, where marimo's notebook document lets Lens
tell a deleted cell from a cell whose code does not parse.

## `Diagnostic`

| Key         | Type                    | Meaning                                                                  |
| ----------- | ----------------------- | ------------------------------------------------------------------------ |
| `code`      | `str`                   | The rule code, such as `LV001`.                                          |
| `name`      | `str`                   | The rule name, such as `stale-output`.                                   |
| `severity`  | `"warning"` \| `"info"` | `warning` when evidence is wrong, `info` when it is older or incomplete. |
| `message`   | `str`                   | One sentence naming the selection, request, and cell.                    |
| `cellId`    | `str \| None`           | The current cell the finding is about.                                   |
| `requestId` | `str \| None`           | The selection or recorded request it is about.                           |

`check()` returns warnings first. The rows are JSON-safe, so
`pl.DataFrame(mounted.check())` works.

## Rules

| Code    | Name                     | Severity | Finds                                                                             |
| ------- | ------------------------ | -------- | --------------------------------------------------------------------------------- |
| `LV001` | `stale-output`           | warning  | An open selection shows the output of a stale cell.                               |
| `LV002` | `failed-output`          | warning  | An open selection shows the output of a cell whose last run failed.               |
| `LV003` | `changed-since-selected` | info     | A producing cell's code changed after the selection opened.                       |
| `LT001` | `missing-source-cell`    | warning  | A DOM target's published source names a cell that is not in the notebook.         |
| `LT002` | `undefined-source`       | warning  | A source's value selector starts with a name its cell does not define.            |
| `LR001` | `unreadable-record-line` | warning  | The [request record](../data-and-trust#request-record) holds unreadable lines.    |
| `LR002` | `missing-code`           | info     | The record kept no code for a change, so its status is unknown.                   |
| `LR003` | `lost-cell`              | info     | A cell that a recorded request changed or pointed at is gone.                     |
| `LR004` | `missing-image`          | info     | The record no longer holds an image that a recorded selection names.              |
| `LR005` | `unreadable-record`      | warning  | Lens could not read the record file, so no recorded request was checked.          |
| `LR006` | `partial-record`         | info     | The record is larger than one read covers, so its oldest requests went unchecked. |
| `LR007` | `undone-change`          | info     | A recorded change no longer holds in its cell. The message names what undid it.   |

`LV` rules check whether what the analyst sees matches the current code.
`LV003` is expected after an agent edits the producing cell: the note and
image describe the output before the edit. The brief lists `LV003` and `LT`
findings for the current selection.

`LT` rules check what a [custom target](../custom-targets#publish-notebook-sources)
publishes. A value selector is descriptive, so `LT002` checks it only when it
starts with a Python name, as in `summary.revenue`, and only for a cell that
parses.

`LR` rules check the record of a Lens built with `record` against the
notebook. `LR003` counts a traced cell
as gone only when the snapshot shows that the cell is absent. `LR007` names a
change that a later request or an edit not yet in the record undid, such as a refactor
that dropped an earlier fix. `context.history()` lists the statements it lost. Lens reads the newest 16 MiB
of the record, so `LR006` names a record that grew past that.

## Check a notebook file

Run the `LR` rules on notebook files and their file records without a kernel,
for example in CI:

```bash
python -m marimo_lens check analysis.py
```

```text
analysis.py: LR001 unreadable-record-line [warning] The record holds 1 line Lens cannot read: a fragment of an interrupted write, an edit, or a newer schema.
```

The command loads each file as a new kernel would and follows recorded cells
by their code. Pass `--json` for one JSON object per line. It exits with `1`
when it finds a warning, such as `LR005` for a record it cannot read, and `2`
when marimo cannot load a file. A notebook with no record passes.
