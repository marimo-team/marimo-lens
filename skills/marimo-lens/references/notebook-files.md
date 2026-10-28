# Read Lens context from a notebook file

When no kernel runs the notebook, read the brief Lens gives for a cell's
output from the file and its record:

```console
marimo-lens context analysis.py --cell revenue_chart --note "Central looks off"
```

`--cell` takes the cell's name or ID and `--note` the analyst's words. Add
`--mark X,Y` only for a point the analyst marked, in fractions of the output,
and `--image PNG` for the view they saw. Without a mark the selection covers
the whole output. `--format text` prints the cells' code, and `--format history` the
recorded requests on those cells and upstream, one JSON object per line.

Cell states come from the last run marimo saved beside the notebook, while
the notebook still holds the code that ran: a cell that raised reads as
failed. After an edit every cell reads as idle until
`marimo export session analysis.py` runs the notebook and saves a new run.
The brief names the `--format` options that fetch more.
