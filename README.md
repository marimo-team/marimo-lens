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
  <a href="https://github.com/marimo-team/marimo-lens/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/marimo-team/marimo-lens/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://pypi.org/project/marimo-lens/"><img alt="Python versions" src="https://img.shields.io/pypi/pyversions/marimo-lens.svg"></a>
  <a href="https://spdx.org/licenses/Apache-2.0.html"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
</p>

**Let your agent see what you see.**

Point to a chart, table, or other result in [marimo](https://marimo.io/), a
reactive Python notebook. Lens gives your agent the selection, your note, and
the code behind it, then brings the agent's work back into view for your review.

https://github.com/user-attachments/assets/e1975ba6-3087-485e-9360-43a99adc8795

- **Point and ask.** Mark a point or region on a chart, table, or other output.
  Lens keeps the mark, note, image, and relevant notebook context together.
- **Follow the work.** See where the agent is working and the result it brings
  into view.
- **Review and continue.** Reopen an addressed selection from History to refine
  the request against the current output.

## Try it

Open a notebook with [uv](https://docs.astral.sh/uv/), a Python environment and
package manager:

```sh
uvx --with marimo-lens marimo edit notebook.py
```

Mount Lens in one notebook cell:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Press **Select**, click a point or drag a region, and add a note. Keep the Lens
cell mounted. Requires Python 3.10–3.14 and marimo 0.24.0 or newer.

Lens works with agents that can run code in the live notebook kernel, including
[marimo Pair](https://marimo.io/pair). Follow the
[agent guide](https://marimo-team.github.io/marimo-lens/agents) to connect one.

## Documentation

[Getting started](https://marimo-team.github.io/marimo-lens/getting-started) ·
[Concepts](https://marimo-team.github.io/marimo-lens/overview) ·
[Selections](https://marimo-team.github.io/marimo-lens/selections) ·
[Python API](https://marimo-team.github.io/marimo-lens/api) ·
[Troubleshooting](https://marimo-team.github.io/marimo-lens/troubleshooting)

For development, start with [Contributing](CONTRIBUTING.md) and the
[architecture guide](development_docs/architecture.md).
[Report a bug](https://github.com/marimo-team/marimo-lens/issues) or follow the
[security policy](SECURITY.md) for a vulnerability.

[Apache 2.0](LICENSE). Inspired by [Agentation](https://github.com/benjitaylor/agentation).
