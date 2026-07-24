# Getting started

Mount Lens in a live marimo notebook, create one selection, and keep that
selection ready for Pair.

Lens supports Python 3.11 through 3.14.

## Install Lens

Install `marimo-lens` in the environment that runs your notebook:

```sh
uv pip install marimo-lens
```

Open an existing notebook or create a new one:

```sh
marimo edit notebook.py
```

## Add a selectable output

Render a small result in one cell:

```python
import marimo as mo

revenue = {"January": 42, "February": 58, "March": 39}
mo.md("\n".join(f"- {month}: **{value}**" for month, value in revenue.items()))
```

Mount Lens in another cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep the Lens cell mounted while you work. Lens needs the live notebook kernel
to create selections and read notebook context.

## Create the first selection

1. Press **Select** in the dock at the bottom of the notebook.
2. Click one revenue value, or drag across several values.
3. Release the pointer to create the selection.
4. Add a note when Pair needs a specific question or constraint.

Lens assigns the first selection the stable label `S1` and makes it current.
The selection sheet lists the output cell, note, marked image status, and
available actions.

Selection mode is one-shot. Press **Select** again for each new point or region.

## Keep the notebook live

Use `marimo edit` while changing the notebook or `marimo run` when the notebook
should stay read-only:

```sh
marimo run notebook.py
```

The Python kernel must remain connected while Lens and Pair read or update the
selection workflow.

Next, [connect Pair to the same notebook](./pair).
