---
title: Data and trust
description: What Lens reads, retains, redacts, captures, and exposes to a connected notebook agent.
---

# Data and trust

Lens runs inside the notebook browser document and Python kernel. It collects
selection details and notebook context so a connected agent can act on the
selected result. Review the notebook and agent environment with the same care
you apply to source code, data, and rendered output.

`Lens()` writes nothing to disk. It holds open selections, notes, and their
images in kernel memory. `Lens(record=True)` also keeps a
[request record](#request-record), which in the marimo editor writes files to
the notebook's `__marimo__/lens/` folder.

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
| Cell code and states of a notebook file      | The file and marimo's saved run   | `notebook_context()` and the CLI |
| Resolved requests and the code they changed  | `resolve()` with a record         | `context.history()` and the file |
| Past requests written from notebook files    | `record_request()`                | `context.history()` and the file |

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

Open selections and selection-image bytes live in the Python `Lens` instance.
Lens keeps them out of the notebook file and browser local storage.

- Delete or **Clear selections** releases the affected selection images.
- `resolve()` on a `Lens()` closes the resolved requests and releases their
  images.
- `resolve()` on a Lens with a record moves the resolved requests, with each
  selection's annotated image unless the record sets `images=False`, into the
  [request record](#request-record).
- `lens.close()` and notebook-runtime teardown release Lens-owned selection
  state and images.

`LensContext` is a detached copy. Code that receives a context can retain its
references, rendered text, or copied image bytes after the Lens instance
changes or closes.

## Request record

A Lens keeps a record when you construct it with `record`, as in
[Keep a record](./getting-started#keep-a-record). The automatic Lens that
marimo shows keeps none. [`Record`](./api#record) lists every option.

In the marimo editor, a record with the default `keep="notebook"` is a
[JSON Lines](https://jsonlines.org/) file next to marimo's session files. Each
`resolve()` appends one line per resolved request to it. Each resolved
selection's annotated image goes beside it, named by its SHA-256
digest:

```text
__marimo__/lens/analysis.py.jsonl
__marimo__/lens/images/3f1c…e9.png
```

marimo places `__marimo__` beside the notebook, or under
[`sys.pycache_prefix`](https://docs.python.org/3/library/sys.html#sys.pycache_prefix)
when Python sets one. A line holds:

- The request: its ID, channel, label, note, and the agent's summary.
- When it opened and when it was resolved.
- What it pointed at: the target, anchor, and captured description of a
  selection, and the producing cells.
- The selection's image, as `trace.image` with its digest, size, capture time,
  and whether the selection moved after the image was taken. A record built
  with `images=False` leaves it out.
- Each cell that changed while it was open, with the code before and after.
- The other requests that were open at the same time.

The record keeps notes, code, and the images the analyst marked. It holds no
control values or cell outputs. Lens writes an image whole under its digest
before the line that names it, so a line never points at a half-written image.
Lens appends under a file lock, so kernels that serve the same notebook write
whole lines. A file system that offers no lock fails the write.

A line that Lens cannot write, for example because the folder is read-only,
stays in memory, and Lens writes it at the next resolution or `context()`
call. An unsaved notebook keeps its lines in memory until it has a file name.
Lens keeps up to 256 such lines. Past that, `resolve()` raises `record_full`
and leaves the requests open, so save the notebook or make its folder
writable. Lines still in memory end with the kernel, so save the notebook
before you restart it.

When marimo renames or moves the notebook, Lens moves the record to the new
name at its next read or write and copies the images its lines name into the
new folder. Rename the record file too when you rename the notebook outside
marimo.

A `keep="session"` record, a marimo app (`marimo run`), and marimo's browser
runtime, which runs Python through [Pyodide](https://pyodide.org/), keep the
record in memory until the runtime restarts and write no file. A memory record
holds 1,024 lines within 64 MiB and drops the oldest resolutions first. An app
visitor's History shows only the requests resolved in that visitor's session.

The Lenses of one kernel share one record per storage. A chat request belongs
to no Lens, so the record of the Lens that resolves it keeps it.

Lens never edits `.gitignore`. Committing `__marimo__/lens/` publishes every
recorded note, the code each request changed, and every image the analyst
marked, so review the folder before you share it. Delete the folder to clear
the record, its images, and History. Lens starts a new record with the next
resolution. Remove `record` from the Lens to stop recording.

Query the record from a notebook with [DuckDB](https://duckdb.org/), which
marimo SQL cells use:

```python
_requests = mo.sql(
    f"""
    SELECT resolvedAt, channel, label, note, len(changes) AS changed_cells,
        'images/' || trace.image.sha256 || '.png' AS image
    FROM read_json_auto('__marimo__/lens/analysis.py.jsonl')
    ORDER BY resolvedAt
    """
)
```

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
