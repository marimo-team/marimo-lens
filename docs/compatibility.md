---
title: Compatibility
description: Python, marimo, browser, code-mode, and documentation-version requirements for marimo-lens.
---

# Compatibility

Check this page before adding Lens to an existing environment or following an
agent API from the hosted documentation.

## Python and marimo

| Component     | Supported contract                                        |
| ------------- | --------------------------------------------------------- |
| Python        | 3.10 through 3.14                                         |
| marimo        | 0.25.0 or newer                                           |
| `marimo-lens` | Install a tagged release from PyPI for released behavior. |

The package declares no upper marimo version bound. Lens uses public notebook
rendering plus private marimo runtime, control-state, UI-registry, and code-mode
APIs. Run the Lens checks again after upgrading marimo when your workflow
depends on agent connection, graph context, control values, or cell-output capture.

## Mounting Lens

Lens is a separate Python package with its own releases. Install it in the
notebook's environment alongside marimo.

marimo mounts Lens
[automatically](https://github.com/marimo-team/marimo/pull/10814) when
`marimo-lens` is installed. The first cell that imports marimo shows the dock
after it runs successfully. If your notebook already shows a Lens dock, reuse
it.

## Browser

Lens requires a browser with JavaScript and current implementations of these
Web Platform APIs:

- Document Object Model events and observation.
- Canvas and PNG encoding.
- Web Crypto hashing.
- Blob URLs.
- Abort signals.
- Same-origin access for embedded documents that Lens must inspect or capture.

Lens supports keyboard and pointer interaction, coarse-pointer layouts,
reduced-motion preferences, forced colors, open shadow roots, and accessible
same-origin iframe documents. A cross-origin iframe remains outside the
document boundary and can block image capture.

## VS Code native notebooks

Lens positions its dock within the visible output webview. VS Code's code
editors can cover that webview, including the dock. The marimo VS Code extension
0.17.3 also omits graph cell IDs from its output DOM, so `Lens()` cannot discover
those outputs as notebook targets. Use marimo's browser editor for the complete
selection workflow.

## Code-mode agents

The agent workflow requires an integration that can execute Python in the live
marimo kernel. Lens calls this environment **code mode**. The same kernel must
contain the installed `marimo-lens` package and the mounted `Lens` instance.

The package registers `marimo_lens.agent` in marimo's
`marimo.agent.capability` entry-point group. An agent host can discover that
capability, read the packaged Agent Skill, and call `connect()` inside the live
kernel.

[marimo pair](https://marimo.io/pair) connects terminal agents such as Claude
Code and Codex through its `marimo pair notebook list` and
`marimo pair execute` commands. marimo's code-mode sidebar is the in-editor
integration.

Read Lens instructions through `help(marimo_lens.agent)` or
`agent_plugins.read("marimo-lens")` in the notebook's Python environment. A
terminal bootstrap with `uvx --with marimo-lens agent-plugins read marimo-lens`
reads an isolated installation and requires network access when packages are
uncached.

## Hosted docs and released packages

The hosted documentation is built from the repository's `main` branch. PyPI
publishes tagged releases. The two surfaces can differ between a merge and the
next release tag.

Check the installed package version:

```python
from marimo_lens import __version__

print(__version__)
```

Use the source tree at the matching tag when you need the exact contract for an
installed release. To test the current `main` documentation against current
source, create a disposable environment from the repository:

```sh
uvx --with "marimo-lens @ git+https://github.com/marimo-team/marimo-lens.git@main" \
  marimo edit notebook.py
```

The command requires Git and network access. Prefer a tagged PyPI release for
repeatable projects.

Read [Getting started](./getting-started) for the normal PyPI path. Read
[Troubleshooting](./troubleshooting) when capability discovery, browser capture,
or runtime access fails after an upgrade.
