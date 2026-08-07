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

**Let your notebook agent see what you see.**

Point to a notebook result and say what should change. Lens gives your agent
the producing cell, related notebook context, and an annotated image to ground
its work in the result you marked.

While the agent works, Lens can show which cell it is changing or checking,
bring the result into view for review, and keep completed requests in
**History** for another pass.

[Read the user guide](https://marimo-team.github.io/marimo-lens/) for the
code-mode agent workflow.

## Quick start

Open a local marimo notebook with Lens available:

```sh
uvx --with marimo-lens marimo edit notebook.py
```

Mount Lens in one notebook cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Keep the cell mounted. Press **Select**, then click a point or drag a region
inside a rendered output. Add a note with what you want the agent to inspect or
change.

## Connect an agent

Install the Lens skill:

```bash
npx skills add marimo-team/marimo-lens
```

After selecting an output and adding a note, ask the agent:

```text
Resolve my Lens request.
```

See [Agent workflow](https://marimo-team.github.io/marimo-lens/agents) to
connect a code-mode agent.

## Python API

The package exports `Lens`, `LensContext`, `LensError`, `LensReferences`,
`NotebookReference`, `SelectionReference`, and `__version__`. The version string
comes from the installed `marimo-lens` distribution metadata.

Agent integrations use five methods:

| Method                                                                        | Behavior                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `lens.context()`                                                              | Returns detached selection context with lazy notebook text       |
| `lens.start_activity(cell_id, *, duration_ms=None, label=None, message=None)` | Marks current work until stopped or its optional hold ends       |
| `lens.stop_activity(cell_id)`                                                 | Stops activity attached to that exact cell                       |
| `lens.reveal(cell_id, *, duration_ms, label=None, message=None)`              | Brings one verified or explanatory cell into view                |
| `lens.resolve(selection_ids, *, expected_revision, summary=None)`             | Moves one or more selections to History in one guarded operation |

The [Python API reference](https://marimo-team.github.io/marimo-lens/api)
documents return values, errors, limits, and lifecycle behavior.

## Project

- [Documentation](https://marimo-team.github.io/marimo-lens/)
- [Source](https://github.com/marimo-team/marimo-lens)
- [Example notebook](https://github.com/marimo-team/marimo-lens/blob/main/examples/lens.py)
- [Issue tracker](https://github.com/marimo-team/marimo-lens/issues)
- [Security policy](https://github.com/marimo-team/marimo-lens/security/policy)
- [Apache License 2.0](https://github.com/marimo-team/marimo-lens/blob/main/LICENSE)
