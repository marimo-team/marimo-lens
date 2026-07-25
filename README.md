<p align="center">
  <a href="https://marimo-team.github.io/marimo-lens/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://marimo-team.github.io/marimo-lens/brand/marimo-lens-lockup-horizontal-dark.svg">
      <img alt="marimo-lens" src="https://marimo-team.github.io/marimo-lens/brand/marimo-lens-lockup-horizontal-light.svg" width="620">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://pypi.org/project/marimo-lens/"><img alt="PyPI" src="https://img.shields.io/pypi/v/marimo-lens.svg"></a>
  <a href="https://spdx.org/licenses/Apache-2.0.html"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
</p>

**Let Pair see what you see.**

Point at a notebook result and ask [marimo Pair](https://marimo.io/pair) about
“this” without copying cell IDs, code, or screenshots. Pair starts with the
selected cell and related notebook structure, then loads an image of your
selection when needed.

Pair can inspect the related code, show where it is working, and bring the
verified result back into view.

[Read the documentation](https://marimo-team.github.io/marimo-lens/) for the
complete notebook and Pair workflow.

## Quickstart

`marimo-lens` supports Python 3.11 through 3.14.

```sh
uv pip install marimo-lens
```

Open a marimo notebook:

```sh
marimo edit notebook.py
```

Add a small output in one cell:

```python
import marimo as mo

revenue = {"January": 42, "February": 58, "March": 39}
mo.md("\n".join(f"- {month}: **{value}**" for month, value in revenue.items()))
```

Mount one Lens in another cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

The Lens dock appears at the bottom of the notebook. Press **Select**, then
click a point or drag a region inside any rendered output. The selection is
ready when you release the pointer.

Run the notebook with `marimo run` or `marimo edit` so Lens stays connected to
the Python kernel.

## Use with Pair

[Connect Pair](https://marimo.io/pair) to the same running notebook, then:

1. Select the output you want Pair to inspect.
2. Add a note when the request needs more detail.
3. Ask Pair about the selection, for example: “Why did revenue drop here?”

Pair starts from the current selection when a request refers to “this” or
“here.” It reads the selected cell and related notebook context as needed.
While Pair works, Lens can mark the active cell. After verification, Pair can
reveal the result and mark the selection **Addressed**. Addressed selections
move to **History** with Pair's completion summary. Select **Reopen** to restore
the original cell, note, and location for another pass.

## What a selection keeps

Each selection records:

- The notebook output cell
- A point or region within that output
- An optional note
- A marked PNG when browser capture succeeds

Addressing a selection keeps its cell, point or region, note, timestamps, and
optional completion summary in **History**. Its marked PNG is released.
Reopening the item starts a fresh marked PNG capture from the current output.

The selection stays available if its output temporarily disappears and
reattaches when the same cell returns. Cross-origin images and external
iframes can block PNG capture. The cell reference and note remain available in
that case.

## Python API

Agent integrations use four workflow methods:

| Method                                                            | Behavior                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `lens.context()`                                                  | Returns detached selection context with lazy notebook text       |
| `lens.activity(cell_id, *, label=None, message=None)`             | Marks the agent's current work until its result is ready         |
| `lens.reveal(cell_id, *, message=None)`                           | Brings one verified or explanatory cell into view                |
| `lens.resolve(selection_ids, *, expected_revision, summary=None)` | Moves one or more selections to History in one guarded operation |

Read the [Python API reference](https://marimo-team.github.io/marimo-lens/api)
for return values, errors, limits, and lifecycle behavior.

## Development

The [example notebook](examples/lens.py) provides a small workflow for local
testing. Read the [user documentation](https://marimo-team.github.io/marimo-lens/),
[Development](development_docs/development.md) for setup, checks, packaging,
and release, and
[Architecture](development_docs/architecture.md) for package ownership and
internal boundaries.

Report bugs through
[GitHub Issues](https://github.com/marimo-team/marimo-lens/issues). Report
security vulnerabilities through the [security policy](SECURITY.md).
`marimo-lens` is available under the [Apache License 2.0](LICENSE).

## Acknowledgements

`marimo-lens` was inspired by
[Agentation](https://github.com/benjitaylor/agentation).
