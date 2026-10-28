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

The file holds no run results or control values, so every cell reads as idle.
Edit the file, then run the command again to read the brief against your
edit.
