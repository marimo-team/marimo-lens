# Set up Lens for a live notebook

## Execution environment

For terminal discovery, the packaged instruction entrypoint is:

```console
uvx --with marimo-lens agent-plugins read marimo-lens
```

This uses an isolated tool environment. Install `marimo-lens` in the notebook
through its dependency manager, preserving the project's version policy.
Connect to the live kernel through the host's code-mode integration, such as
[marimo Pair](https://marimo.io/pair). If kernel access is already available,
continue there.

When the notebook uses a different installation from the one that supplied
the briefing, read its instructions in that kernel:

```python
import agent_plugins as ap

print(ap.read("marimo-lens"))
```

`help(marimo_lens.agent)` supplies the same core after `import marimo_lens`.
Reuse a briefing already loaded from the same environment and installation.
Use the installed `help(marimo._code_mode)` for notebook operations when that
host contract has not been read yet.

Notebook discovery, connection, scratchpad execution, and general notebook
inspection and mutation belong to the active code-mode integration, such as
Pair. This skill owns Lens grounding, images, activity, reveals, and resolution.

Activate this workflow after the request identifies Lens work through a
selection, output reference, overview, walkthrough, or co-creation of output
that will receive Lens feedback.

The [core skill](../SKILL.md#add-lens-when-missing) covers ordinary mounting.
Use this reference for a missing package, notebook connection, or custom host.

If the browser reports that the tab is a reader, use the existing editor tab
or choose **Take over** when you intend to make this tab the editor. This
changes browser ownership while keeping the notebook kernel running.

## Install in a running notebook

When Lens is absent from the active kernel's environment, use its code-mode
package API after reading the host's installed help:

```python
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    ctx.packages.add("marimo-lens")
```

Wait for installation to complete. In a subsequent scratchpad call, check
`cm.capabilities()` and read `help(marimo_lens.agent)` after `import marimo_lens`.
Continue in the same notebook session, then follow the core skill's mount
recipe. Installation makes the package available. Displaying a Lens instance
makes the dock available.

If installation or import fails, inspect the package diagnostic and the
kernel's `sys.executable` before choosing a recovery step. Follow the project's
dependency policy for its durable package declarations.

## Choose the mounted target scope

Follow the core skill's availability check before creating a Lens cell.
Reuse authored and automatically mounted instances, including those with no
named notebook variable. Retry only while a known mount is still rendering.
Otherwise, use the notebook or host mounting policy that applies:

- Use `Lens()` for an ordinary marimo notebook. Notebook outputs are selectable
  by default.
- A host integration may supply `dom_selector` for additional rendered roots.
  Read that host's skill or public API and reuse its selector policy. Do not
  copy host element names into this workflow. Choose light-DOM roots and let
  Lens follow interactions into their open shadow trees.
- Compose task-specific page regions into the host selector when feedback can
  target structure, copy, spacing, or styling. Avoid `*` and selectors that
  turn every nested wrapper into a target.

For an ordinary notebook, `marimo_lens.agent.add_lens_cell(ctx)` mounts the default
Lens. A host document may require an authored Lens cell so it can pass and
render the host-owned selector. Follow the host skill for that mount.

```python
from marimo_lens import Lens

lens = Lens()
lens
```
