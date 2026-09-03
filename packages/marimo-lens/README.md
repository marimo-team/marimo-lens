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

marimo-lens connects a point or region on rendered notebook output to the cells
and context behind it. A live notebook agent can inspect that selection, show
where it is working, and return the result for review.

## Install and mount

marimo-lens supports Python 3.10 through 3.14 and marimo 0.24.0 or newer.

```sh
uv add marimo-lens
```

Mount one Lens in the notebook:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Press **Select**, click a point or drag a region, then add an optional note.

## Agent adapter

Code-mode agents connect through `marimo_lens.agent`:

```python
import marimo_lens.agent as lens_agent

mounted = lens_agent.connect()
context = mounted.context()
```

`connect()` runs inside the live marimo kernel. It returns a `MountedLens` with
stable reconnection identity, context access, current cell-output capture,
activity, reveal, and resolution methods.

The distribution also installs the matching Agent Plugin and Agent Skill. Use
`lens_agent.agent_skill()` to locate its instructions from the notebook
environment.

## Documentation

- [Getting started](https://marimo-team.github.io/marimo-lens/getting-started)
- [Product model](https://marimo-team.github.io/marimo-lens/overview)
- [Agent workflow](https://marimo-team.github.io/marimo-lens/agents)
- [Targets](https://marimo-team.github.io/marimo-lens/concepts/targets)
- [Python API](https://marimo-team.github.io/marimo-lens/api)
- [Compatibility](https://marimo-team.github.io/marimo-lens/compatibility)
- [Data and trust](https://marimo-team.github.io/marimo-lens/data-and-trust)

Source, issue tracking, and contributor documentation live in the
[marimo-lens repository](https://github.com/marimo-team/marimo-lens).
