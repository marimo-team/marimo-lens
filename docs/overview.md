---
title: What is Lens?
description: Lens connects a point or region on rendered notebook output to the code and context an agent needs to act on it.
---

# What is Lens?

Lens is a widget for [marimo](https://marimo.io/), a reactive Python notebook.
It lets a person mark part of a rendered result and lets a code-mode agent trace
that mark back to the notebook cells that produced it.

Mount one `Lens` in a notebook:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Press **Select**, click a point or drag a region, then add an optional note.
Lens stores that attention as a **selection**.

## One model for the product

<div class="lens-mental-model" role="img" aria-label="A rendered target and point or region become a selection. Lens combines the selection with notebook context and an optional selection image. An agent shows activity, verifies work, reveals the result, and resolves the selection into History.">
  <div><strong>Target</strong><span>Rendered notebook output or configured page region</span></div>
  <span aria-hidden="true">+</span>
  <div><strong>Point or region</strong><span>The part that deserves attention</span></div>
  <span aria-hidden="true">→</span>
  <div><strong>Selection</strong><span>Target, mark, note, producing-cell links, and image status</span></div>
  <span aria-hidden="true">→</span>
  <div><strong>Lens context</strong><span>References, bounded text, and available images</span></div>
  <span aria-hidden="true">→</span>
  <div><strong>Review</strong><span>Activity, verification, reveal, and History</span></div>
</div>

A **target** is the rendered result or page area a person can select. Most
targets are notebook outputs. Host applications can also make their own page
areas selectable.

A **selection** is one point or region inside one target. It has a stable
`S<n>` label, an optional note, producing-cell references, and selection-image
status. The **current selection** is the likely referent when a person says
“this” or “here.” One request to an agent can use several selections.

**Lens context** is a detached, revisioned handoff returned by
`lens.context()`. It keeps the selection, its producing cells, relevant notebook
context, and visual evidence together for the agent.

## Why connect both views?

A person refers through the rendered result: “explain this spike.” An agent acts
through notebook cells, dependencies, and runtime values. Lens connects the
visible reference to the computation that produced it, then returns the agent's
work to the notebook for human review.

[Why Lens?](./why-lens) explains this visual grounding, computational
grounding, and review loop in plain language.

## Choose the next page

- [Why Lens?](./why-lens) explains the ideas behind the interaction.
- [Getting started](./getting-started) mounts Lens and creates the first selection.
- [How Lens works](./how-lens-works) runs the complete collaboration loop.
- [Connect an agent](./agents) covers the live code-mode handoff.

Use the sidebar for detailed concepts, troubleshooting, and API reference.
