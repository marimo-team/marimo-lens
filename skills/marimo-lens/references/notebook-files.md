# Read Lens context from a notebook file

When no kernel runs the notebook, describe the selection from the analyst's
message and read the brief Lens would give from the file and its record:

```console
marimo-lens context analysis.py --cell revenue_chart --note "Central looks off"
```

`--cell` takes the cell's name or ID. Add `--mark X,Y` for the point the
analyst named, in fractions of the output, and `--image PNG` for the view
they saw. `--format text` prints the cells' code, and `--format history` the
recorded requests on those cells and upstream, one JSON object per line.

Cell states come from the last run marimo saved beside the notebook: a cell
that raised reads as failed, and a cell whose code or upstream changed since
reads as stale. `marimo export session analysis.py` runs the notebook and
saves a new run. The brief names the `--format` options that fetch more. Edit
the file, then run the command again to read the brief against your edit.
