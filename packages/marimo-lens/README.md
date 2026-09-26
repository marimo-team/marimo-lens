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
Reopen an addressed selection from History to continue the analysis.

## Install and mount

In a project managed by [uv](https://docs.astral.sh/uv/):

```sh
uv add marimo-lens
uv run marimo edit notebook.py
```

Requires Python 3.10–3.14 and marimo 0.24.0 or newer. If the notebook already
shows a Lens dock, use that instance. Otherwise mount Lens in one notebook cell
and keep it displayed:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Press **Select**, click a point or drag a region, then add a note.

Custom pages can publish [Lens target metadata](https://marimo-team.github.io/marimo-lens/custom-targets)
for notebook inputs, labels, rendering references, and image context. Lens
recognizes these source regions automatically. Add `data-marimo-lens-target`
to select authored copy or layout without notebook inputs. Each view controls
its targets through its own markup, including with automatically mounted Lens. Native
Marimo outputs remain selectable through their existing output cells.

## Connect an agent

Connect through [marimo Pair](https://marimo.io/pair) or the editor's code-mode
sidebar, select a result in Lens, and tell the agent:

> Use Lens to address my current selection.

The [quickstart](https://marimo-team.github.io/marimo-lens/getting-started)
covers the complete path from connection to a reviewed chart change.

Read the packaged briefing from a terminal:

```console
uvx --with marimo-lens agent-plugins read marimo-lens
```

In an existing notebook kernel, run `import marimo_lens` followed by
`help(marimo_lens.agent)`. The help includes the same core skill and references
from that installation. The terminal command uses an isolated tool environment
and does not connect to the notebook.

Use `marimo_lens.agent.skill()` to read individual skill resources and
`marimo_lens.agent.plugin()` to inspect the installed plugin bundle.

Agents call `marimo_lens.agent.connect()` to reuse an existing Lens, including
automatically mounted instances. When one browser-ready Lens owns the dock,
`connect()` selects it even if the code-mode context contains other Lens
objects. `discover()` lists available handles when an agent needs to inspect
availability or choose between instances.

After verification, call `resolve(..., summary="...")` with what changed or
what you found and checked. The summary appears beside the original request in
History. A batch shares one summary; resolve separately when outcomes differ.

Use `reveal(steps, duration_ms=None)` for a transient notebook walkthrough. A small stepper
in the popover header lets users move at their own pace. Nothing is saved;
referenced cell or upstream changes end the walkthrough.

Lens works with agents that can execute Python in the live notebook kernel,
including [marimo Pair](https://marimo.io/pair). The package includes the matching
agent instructions and registers its Lens capability with marimo. Follow
[Connect an agent](https://marimo-team.github.io/marimo-lens/agents) for setup
and the inspection, verification, and review workflow.

## Documentation

[What is Lens?](https://marimo-team.github.io/marimo-lens/overview) ·
[Getting started](https://marimo-team.github.io/marimo-lens/getting-started) ·
[Connect an agent](https://marimo-team.github.io/marimo-lens/agents) ·
[Custom targets](https://marimo-team.github.io/marimo-lens/custom-targets) ·
[Python API](https://marimo-team.github.io/marimo-lens/api) ·
[Data and trust](https://marimo-team.github.io/marimo-lens/data-and-trust)

Source, issue tracking, and contributor documentation live in the
[marimo-lens repository](https://github.com/marimo-team/marimo-lens).
