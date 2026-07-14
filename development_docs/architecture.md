# Architecture

`marimo-lens` turns live notebook state and a browser selection into one
feedback packet. Python owns notebook discovery and lineage. The widget owns
visible selection and annotation. The bundle layer carries the widget module
graph inside the Python distribution.

## Package graph

```text
@marimo-lens/anywidget-bundle
          |
          +-------------------+
                              v
@marimo-lens/widget --> @marimo-lens/python --> PyPI marimo-lens
                                                 |
                                                 v
                                           marimo notebook
```

`@marimo-lens/anywidget-bundle` is product-agnostic. It accepts one anywidget
app module and emits a manifest-backed resource graph. It has no dependency on
Lens selection, marimo runtime state, or React components.

`@marimo-lens/widget` is the browser app. It consumes synchronized model state,
resolves visible semantic targets, stores interaction state, and writes
annotations back to the model. `@marimo-lens/python` owns packaging and Python
resource loading.

`@marimo-lens/python` is the composition root. Its Vite config selects the
widget app and writes the final assets into the Python package. Its Python
source exposes `Lens`, collects notebook state, formats feedback, and serves
manifest modules to the browser.

## Data flow

1. `Lens` reads the active marimo runtime or an explicit snapshot.
2. The Python pipeline resolves the graph, targets, inspectors, metadata, and
   feedback fields into synchronized traits.
3. Anywidget evaluates `index.js` for the model.
4. The bootstrap requests `chunks/app.js` and referenced chunks through the
   model custom-message channel.
5. The Python bundle handler serves exact manifest-listed modules as binary
   buffers.
6. The browser loader rewrites relative module imports to model-scoped Blob
   URLs and instantiates the widget app.
7. Selection plugins resolve a visible element into a semantic target with
   evidence. The widget writes annotations and refresh requests to traits.
8. Python rebuilds `pair_feedback` and `pair_prompt` from current notebook and
   annotation state.

Model teardown aborts module requests, revokes Blob URLs, removes listeners,
and runs widget cleanup. Development HMR restarts the app generation while
preserving the anywidget model and mounted views.

## Composition boundaries

Python inspectors add domain knowledge before targets cross the wire. Browser
selection plugins add target behavior after synchronized targets reach the DOM.
Chart adapters exist on both sides for those separate responsibilities.

The wire contract joins the two runtimes. Change Python validators, TypeScript
schemas, trait names, manifest fields, or custom-message envelopes as one
coherent change. Exercise the behavior through packet parsing, trait updates,
bundle messages, and browser selection.

The workbench composes controls, dataframes, charts, media, SVG, and nested
anywidgets. It proves integration behavior and stays outside package runtime
code.

## Artifact boundary

`anywidget.json` names the bootstrap, stylesheet, app module, and complete
module allowlist. Hatch packages that graph into the wheel and sdist. Building
a wheel from the sdist proves the Python archive is self-contained.
