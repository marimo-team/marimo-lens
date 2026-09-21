---
title: Data and trust
description: What Lens reads, retains, redacts, captures, and exposes to a connected notebook agent.
---

# Data and trust

Lens runs inside the notebook browser document and Python kernel. It collects
selection details and notebook context so a connected agent can act on the
selected result. Review the notebook and agent environment with the same care
you apply to source code, data, and rendered output.

## What Lens can expose

| Data                                         | Where it comes from               | Agent-facing form                |
| -------------------------------------------- | --------------------------------- | -------------------------------- |
| Selection note and geometry                  | Lens selection UI                 | Compact references and text      |
| Target identity and DOM hint                 | Rendered target                   | Compact references and text      |
| Captured description and rendering reference | Client metadata                   | Bounded references and text      |
| Producing and upstream cell source           | marimo dataflow graph             | Bounded text                     |
| Relevant native control values               | Live marimo controls              | Bounded text                     |
| Annotated selection pixels                   | Browser capture at selection time | `LensContext.images` PNG bytes   |
| Current cell-output pixels                   | Agent-requested browser capture   | One-use `cell_image()` PNG bytes |
| Notebook path and cell IDs                   | Active marimo runtime             | Compact references and text      |

A DOM hint can contain the element tag, role, accessible label, title, rendered
text, a short structural path, and normalized bounds. A configured DOM target
can therefore expose authored page text outside a notebook output.
Small DOM captures can include nearby context or a client-declared containing
element. Rendering references describe client project files and symbols. Lens
carries those references as evidence and does not open the referenced files.

## Control-value handling

Lens selects control state from variables referenced by relevant notebook
cells. It serializes bounded scalar values and scalar sequences from supported
native marimo controls.

Password controls, file payloads, composite controls, custom controls,
AnyWidget state, opaque objects, and unsafe values appear as `[redacted]` or
`[unavailable]`. This is structural protection for known control kinds. Lens
does not inspect ordinary source strings, notes, DOM text, or rendered pixels
for secrets.

Review those inputs before connecting an agent whose provider or execution
environment can transmit them outside the notebook process.

## In-memory lifetime

Open selections, History entries, and selection-image bytes live in the Python
`Lens` instance. They are not written into the notebook file or browser local
storage by Lens.

- Delete or **Clear selections** releases the affected selection images.
- `resolve()` releases images for the resolved selections and retains
  metadata-only History entries.
- **Clear history** removes History metadata.
- `lens.close()` and notebook-runtime teardown release Lens-owned selection
  state and images.

`LensContext` is a detached copy. Code that receives a context can retain its
references, rendered text, or copied image bytes after the Lens instance
changes or closes.

## Agent transfer boundary

Lens exposes context inside the live kernel. The connected agent integration
decides how to read, copy, prompt with, or transmit that context. Lens does not
control the agent provider's retention or network policy.

Some image readers require a file path. The packaged Agent Skill writes PNG
bytes to a private temporary file for that read and requires the agent to
delete the file after its final use. The notebook kernel and image reader must
share a filesystem for this path-based transfer.

## Browser document boundary

Lens can inspect and capture content in its owner document, open shadow roots,
and accessible same-origin iframe documents. Cross-origin frames are isolated
by the browser. External images, styles, fonts, canvas content, and inaccessible
frames can make capture fail or produce a bounded error.

Image failure does not discard the selection. Target identity, geometry, note,
DOM hint, producing-cell references, and available graph context remain
independent inputs.

Read [How Lens works](./how-lens-works#what-the-agent-receives) for the
context forms and image states, and [`LensContext`](./reference/context) for
their exact shapes. Read [Custom targets](./custom-targets) before widening the
`dom_selector` policy. Report security vulnerabilities through the
[security policy](https://github.com/marimo-team/marimo-lens/security/policy).
