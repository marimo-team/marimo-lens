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
the producing cell, related notebook context, and an annotated image of your
selection.

While the agent works, Lens can show which cell it is changing or checking,
bring the result into view for review, and keep completed requests in
**History** for another pass.

[Read the user guide](https://marimo-team.github.io/marimo-lens/) for the
notebook-agent workflow.

## Quick start

Open a local marimo notebook with Lens available:

```sh
uvx --with marimo-lens marimo edit --no-token notebook.py
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

`--no-token` lets [marimo Pair](https://marimo.io/pair) discover this local
notebook. [Getting started](https://marimo-team.github.io/marimo-lens/getting-started)
covers existing projects and includes a live selection example.

## Connect an agent

Connect a notebook agent that can call the Lens Python API to the same running
notebook. [marimo Pair](https://marimo.io/pair) provides a ready-made
integration.

After selecting an output and adding a note, ask the agent:

```text
Resolve my Lens request.
```

The [Pair integration guide](https://marimo-team.github.io/marimo-lens/pair)
covers the ready-made workflow. [How it works](https://marimo-team.github.io/marimo-lens/how-it-works)
shows how another agent can read the request, show its activity, return a
result, and keep completed feedback available for another pass.

## Python API

The package exports `Lens`, `LensContext`, `LensError`, and `SelectionImage`.
Agent integrations use four methods:

| Method                                                            | Behavior                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `lens.context()`                                                  | Returns detached selection context with lazy notebook text       |
| `lens.activity(cell_id, *, label=None, message=None)`             | Marks the agent's current work until its result is ready         |
| `lens.reveal(cell_id, *, message=None)`                           | Brings one verified or explanatory cell into view                |
| `lens.resolve(selection_ids, *, expected_revision, summary=None)` | Moves one or more selections to History in one guarded operation |

The [Python API reference](https://marimo-team.github.io/marimo-lens/api)
documents return values, errors, limits, and lifecycle behavior.

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
