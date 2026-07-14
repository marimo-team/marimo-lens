# marimo-lens

`marimo-lens` collects precise feedback from a live marimo notebook and exports
an agent-ready packet with target, lineage, widget, and DOM context.

```sh
pip install marimo-lens
```

Mount `Lens` as an anywidget:

```python
import marimo as mo
from marimo_lens import Lens

lens = mo.ui.anywidget(Lens())
lens
```

Read the synchronized feedback packet or its paste-ready form:

```python
feedback = lens.pair_feedback
prompt = lens.pair_prompt
```

Use `include`, `exclude`, `targets`, and `target(...)` to control discovery.
Use `EntityInspector` and the chart inspector APIs for domain-specific objects.
