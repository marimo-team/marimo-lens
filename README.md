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

https://github.com/user-attachments/assets/7845c3b6-3ead-469f-8910-b688feb6a284

- **Point and ask.** Mark a point or region on a chart, table, or other output.
  Lens keeps the mark, note, image, and relevant notebook context together.
- **Follow the work.** See where the agent is working, or ask for a guided trail
  through the notebook's inputs and results.
- **Review and continue.** Reopen an addressed selection from History to refine
  the request against the current output.

## Get started

Use Lens with an agent connected to your notebook through
[marimo pair](https://marimo.io/pair) or marimo's code-mode sidebar. Lens is a
separate Python package, installed in the notebook's environment.

[Follow the quickstart](https://marimo-team.github.io/marimo-lens/getting-started)
to connect an agent, select a chart, and review your first change, or open the
sample notebook in molab:

[![Open in molab](https://molab.marimo.io/molab-shield.svg)](https://molab.marimo.io/notebooks/nb_MimGXwYTcvjfb1sdUdaTyn)

## For agents

Read the packaged Lens briefing:

```console
uvx --with marimo-lens agent-plugins read marimo-lens
```

With a notebook connected through marimo pair, read the guidance installed in
its kernel:

```console
marimo pair execute --url <URL> --file <notebook.py> -c 'import marimo_lens; help(marimo_lens.agent)'
```

[Connect an agent](https://marimo-team.github.io/marimo-lens/agents) covers
connection and resource access.

## Documentation

[What is Lens?](https://marimo-team.github.io/marimo-lens/overview) ·
[Getting started](https://marimo-team.github.io/marimo-lens/getting-started) ·
[Try the demo](https://marimo-team.github.io/marimo-lens/#try-lens) ·
[Connect an agent](https://marimo-team.github.io/marimo-lens/agents) ·
[Python API](https://marimo-team.github.io/marimo-lens/api)

[Contributing](CONTRIBUTING.md) ·
[Report a bug](https://github.com/marimo-team/marimo-lens/issues) ·
[Apache 2.0](LICENSE)

Inspired by [Agentation](https://github.com/benjitaylor/agentation).
