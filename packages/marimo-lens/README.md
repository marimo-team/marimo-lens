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

**Let your agent see what you see.**

marimo-lens connects a point or region on a rendered
[marimo](https://marimo.io/) notebook output to its producing cells, relevant
notebook context, and an annotated image when capture succeeds. A live notebook
agent can inspect the request, show its activity, and return results for review.
A Lens that keeps a record lists resolved requests in History with whether their
changes still hold. Reopen a selection from History to continue the analysis.

## Install and mount

In a project managed by [uv](https://docs.astral.sh/uv/):

```sh
uv add marimo-lens
uv run marimo edit notebook.py
```

Requires Python 3.10–3.14 and marimo 0.25.2 or newer. marimo mounts Lens
automatically once a cell that imports marimo runs. Mount it yourself to choose
its options:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Press **Select**, click a point or drag a region, then add a note.

`Lens()` keeps open selections, notes, and images in kernel memory. Keep a
record of resolved requests, with History and the code each request changed:

```python
lens = Lens(record=True)
```

In the marimo editor the record is a file in the notebook's `__marimo__/lens/`
folder. [`Record`](https://marimo-team.github.io/marimo-lens/api#record) lists
the options.

Custom pages can publish [Lens target metadata](https://marimo-team.github.io/marimo-lens/custom-targets)
for notebook inputs, labels, rendering references, and image context. Lens
recognizes these source regions automatically. Add `data-marimo-lens-target`
to select authored copy or layout without notebook inputs. Each view controls
its targets through its own markup, including with automatically mounted Lens. Native
Marimo outputs remain selectable through their existing output cells.

## Connect an agent

Connect through [marimo pair](https://marimo.io/pair) or the editor's code-mode
sidebar, select a result in Lens, and tell the agent:

> Use Lens to address my current selection.

The [quickstart](https://marimo-team.github.io/marimo-lens/getting-started)
covers the complete path from connection to a reviewed chart change.

In the notebook kernel, `import marimo_lens._capability` followed by
`help(marimo_lens._capability)` prints the agent briefing installed with this
package. [Connect an agent](https://marimo-team.github.io/marimo-lens/agents)
covers the briefing, `marimo_lens.agent.connect()`, and the inspection,
verification, and review workflow.

From a terminal with no kernel, print the brief Lens gives for a cell of a
notebook file and its record:

```console
uvx marimo-lens context analysis.py --cell revenue_chart --note "Central looks off"
```

`marimo_lens.notebook_context()` returns the same context in Python, and
`marimo_lens.record_request()` writes past requests to the record. The
[command line](https://marimo-team.github.io/marimo-lens/reference/cli)
reference covers each `marimo-lens` command.

## Documentation

[What is Lens?](https://marimo-team.github.io/marimo-lens/overview) ·
[Getting started](https://marimo-team.github.io/marimo-lens/getting-started) ·
[Connect an agent](https://marimo-team.github.io/marimo-lens/agents) ·
[Custom targets](https://marimo-team.github.io/marimo-lens/custom-targets) ·
[Python API](https://marimo-team.github.io/marimo-lens/api) ·
[Data and trust](https://marimo-team.github.io/marimo-lens/data-and-trust)

Source, issue tracking, and contributor documentation live in the
[marimo-lens repository](https://github.com/marimo-team/marimo-lens).
