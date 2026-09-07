---
title: What is Lens?
description: Lens connects a point or region on rendered notebook output to the code and context an agent needs to act on it.
---

# What is Lens?

**Let your agent see what you see.**

Lens is a widget for [marimo](https://marimo.io/), a reactive Python notebook.
Mark part of a result, ask a question, and give a live notebook agent the
selection and its producing cells. Lens shows the agent's activity and returns
results to the notebook for your review.

Mount one `Lens` in a notebook:

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Press **Select**, click a point or drag a region, then add an optional note.
Lens stores that attention as a **selection**.

## From a mark to a request

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

## Point, revise, review

1. **Point and ask.** Select a point or region and add a note such as “Explain
   this spike.” Lens connects the marked output to its producing cells and
   relevant upstream computation.
2. **Revise and verify.** Your agent reads that context, inspects the live
   notebook, and runs the changes. Lens marks where it is working and brings
   returned results into view.
3. **Review and continue.** The agent resolves the selection into **History**
   after addressing it. You judge the evidence and can reopen the request for
   another pass.

**Addressed** records the agent's handoff. Your review determines whether the
result answers the question. Reopening restores the mark and note on the
current output, which may have changed since the original selection.

## Connect your notebook agent

A **code-mode agent** can execute Python in the live notebook kernel to
inspect, edit, and run cells. [marimo Pair](https://marimo.io/pair) provides one
such connection. Lens supplies selection context and visible feedback through
that connection. The agent integration performs notebook edits and execution.

[Connect an agent](./agents) covers setup and the complete workflow.

## Choose your next step

| I want to…                                    | Start here                                  |
| --------------------------------------------- | ------------------------------------------- |
| Make my first selection                       | [Getting started](./getting-started)        |
| Understand visual and computational grounding | [Why Lens?](./why-lens)                     |
| Try the agent feedback loop                   | [How Lens works](./how-lens-works)          |
| Select a dashboard or application region      | [Targets](./concepts/targets)               |
| Inspect what an agent receives                | [Context and evidence](./concepts/evidence) |
| Look up a method or returned value            | [Python API](./api)                         |
