---
title: Why Lens?
description: How Lens connects a visible notebook question to computation an agent can change and evidence a person can review.
---

# Why Lens?

A person looking at a chart can point to one spike and ask, “What happened
here?” The point makes “here” obvious to the person. A notebook agent works
through cells, dependencies, values, and execution, so it also needs a route
from that visible spike to the computation that produced it.

Lens keeps both views connected. The selection preserves what drew the person's
attention. The notebook graph gives the agent a place to inspect and act. Lens
then brings the result back into view so the person can judge what happened and
decide what to ask next.

::: details A name for “this” and “here”

Words such as “this” and “here” depend on the situation in which someone uses
them. This kind of reference is called
[deixis](https://doi.org/10.1109/TVCG.2024.3456351). A point or region gives the
words a visible referent. A note explains what the person wants to know or
change.

Lens stores the mark and note together as a selection, so the reference remains
inspectable after the pointer gesture ends.

:::

## One notebook question has two views

For a notebook output, the person and agent need different information about
the same question:

| Human view                              | Agent view                                                    |
| --------------------------------------- | ------------------------------------------------------------- |
| The rendered target                     | The producing cell                                            |
| The point or region that drew attention | Relevant upstream cells in the dependency graph               |
| The person's note                       | Bounded notebook code and eligible control values             |
| A selection image when capture succeeds | A current cell-output image when visual verification needs it |

The human view answers, “What do you mean?” Lens calls this **visual
grounding**. The agent view answers, “Where did this result come from?” Lens
calls this **computational grounding**.

These terms describe a relationship, not additional API objects. A
`SelectionReference` carries the target, point or region, note, and producing
cell IDs when the target has them. `LensContext.text` adds bounded source and
runtime context from those cells and their relevant upstream dependencies.
Available image evidence keeps the marked view beside that computation.

Consider the spike again. Its location distinguishes one part of the chart. Its
producing cell identifies the code that created the chart. Upstream cells show
how the relevant data reached that code. The note tells the agent whether to
explain the spike, test a hypothesis, or change the result.

## Point, revise, review

<div class="lens-mental-model" role="img" aria-label="A person points and asks. Lens connects the selection to notebook computation. An agent revises the notebook. Lens returns evidence. The person reviews the result and can ask again.">
  <div><strong>Point and ask</strong><span>The person marks visible evidence and states the question.</span></div>
  <span aria-hidden="true">→</span>
  <div><strong>Connect</strong><span>Lens links the selection to its producing computation.</span></div>
  <span aria-hidden="true">→</span>
  <div><strong>Revise</strong><span>The agent changes cells, and marimo reruns affected results.</span></div>
  <span aria-hidden="true">→</span>
  <div><strong>Return evidence</strong><span>Lens brings the relevant result into view.</span></div>
  <span aria-hidden="true">→</span>
  <div><strong>Review and continue</strong><span>The person judges the evidence and directs the next step.</span></div>
</div>

<llm-only>

1. The person marks visible evidence and states the question.
2. Lens connects the selection to its producing computation.
3. The agent changes cells, and marimo reruns affected results.
4. Lens brings the relevant result into view.
5. The person judges the evidence and directs the next step.

</llm-only>

The person owns analytical direction and judgment. The agent extends the
person's computational reach by inspecting and revising the live notebook. Lens
carries the visible reference into that work and returns the resulting evidence
to the notebook.

This division of roles keeps the interaction inspectable. Activity shows where
the agent is working. Reveal brings a verified result into view. Resolution
records which selections the agent addressed. History gives the person a review
point that can be reopened when the result needs another pass.

## Review is part of the analysis

`resolve()` records that the agent addressed an Open selection. The person
still decides whether the returned evidence answers the question. Reopening
restores the mark and note when the target is available, which lets the person
inspect the result again, refine the question, or redirect the work.

Each returned notebook result can also become the target of another selection.
The person can review and redirect the analysis between questions while keeping
each question linked to visible evidence and notebook computation.

## Grounding sets a starting point

Lens preserves the target, mark, note, producing-cell identity, and bounded
graph context. The agent still interprets what the person means within the
selected region, and it may need to inspect more of the notebook when relevant
information falls outside the context bounds.

A notebook can also change before a selection is reopened. Check that the mark
still refers to the intended visual feature before continuing the analysis.
Grounding makes the request and handoff inspectable. Analytical correctness
still depends on agent verification and human review.

## Continue

- [Getting started](./getting-started) creates the first selection.
- [How Lens works](./how-lens-works) shows the complete collaboration loop.
- [Context and evidence](./concepts/evidence) defines what the agent receives.
- [Feedback and History](./concepts/feedback) explains review and reopening.
