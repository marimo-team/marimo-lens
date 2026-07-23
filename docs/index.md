---
layout: home

hero:
  text: Let Pair see what you see.
  tagline: Point at a notebook result and ask Pair about “this” without copying cell IDs, code, or screenshots. Pair starts with the selected cell and related notebook structure, then loads an image of your selection when needed.
  image:
    light: /brand/marimo-lens-lockup-stacked-light.svg
    dark: /brand/marimo-lens-lockup-stacked-dark.svg
    alt: marimo-lens
  actions:
    - theme: brand
      text: Get started
      link: ./getting-started
    - theme: alt
      text: Use with Pair
      link: ./pair

features:
  - title: Select the output
    details: Click one point or drag across a region. Add a note when the request needs more detail.
  - title: Keep the notebook context
    details: Lens ties the selection to its output cell and preserves it while the output rerenders or temporarily disappears.
  - title: Close the loop with Pair
    details: Pair can show where it is working, reveal the verified result, and move completed selections into History so you can review the outcome and reopen a selection when needed.
---

## Start in a notebook

Install Lens, then mount one widget in a marimo notebook:

```sh
uv pip install marimo-lens
```

```python
import marimo as mo
from marimo_lens import Lens

lens = mo.ui.anywidget(Lens())
lens
```

The Lens dock appears at the bottom of the notebook. Press **Select**, then
click a point or drag a region inside another cell's output.

[Getting started](./getting-started) adds a selectable result and walks through
the first selection.

[How it works](./how-it-works) explains how Lens connects that browser
selection to live notebook context.
