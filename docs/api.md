---
title: Python API
description: Public Python contracts for mounting Lens and connecting a code-mode agent.
---

# Python API

Use `marimo_lens.agent.connect()` in the live notebook kernel to reuse an
existing Lens. Notebook authors can mount `Lens` when the host has not already
provided one.

| Task                                       | API                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Discover existing instances                | [`discover()`](#discover)                                                                                          |
| Add the notebook interface                 | [`Lens`](#lens)                                                                                                    |
| Keep a record of resolved requests         | [`Lens(record=...)`](#lens), [`Record`](#record), [`RecordOptions`](#recordoptions)                                |
| Read the current request first             | [`LensContext.brief`](./reference/context#brief), [`LensContext.request`](./reference/context#request)             |
| Read selections, source, and images        | [`Lens.context()`](#lens-context), [`LensContext`](./reference/context)                                            |
| Check what recorded requests changed       | [`LensContext.history()`](./reference/context#history)                                                             |
| Check selections and the record            | [`check()`](#lens-check), [Checks](./reference/checks)                                                             |
| Show agent work and return a result        | [`start_activity()`](#lens-start-activity), [`stop_activity()`](#lens-stop-activity), [`reveal()`](#lens-reveal)   |
| Record a request the analyst made in chat  | [`open_request()`](#lens-open-request)                                                                             |
| Resolve requests                           | [`resolve()`](#lens-resolve)                                                                                       |
| Show a user-paced notebook walkthrough     | [`reveal()`](#lens-reveal)                                                                                         |
| Connect an agent or capture current output | [`discover()`](#discover), [`connect()`](#connect), [`MountedLens`](#mountedlens)                                  |
| Release a Lens instance                    | [`close()`](#lens-close)                                                                                           |
| Share the notebook's Lens with a host      | [`automatic_lens()`](#automatic-lens), [`notebook_lens()`](#notebook-lens)                                         |
| Work from a notebook file without a kernel | [`notebook_context()`](#notebook-context), [`record_request()`](#record-request), [`marimo-lens`](./reference/cli) |

The caller roles are:

- Notebook authors construct `Lens` and keep it mounted with the notebook.
- Code-mode agents call `marimo_lens.agent.connect()` and work through a
  `MountedLens` handle.
- marimo and host integrations call the [host API](#host-api) to show one Lens
  per notebook runtime.
- Evaluation harnesses, CI, and terminal agents call
  [`notebook_context()`](#notebook-context) and
  [`record_request()`](#record-request) on notebook files.

Authors and agents share context, activity, reveal, and resolution behavior.
The agent handle adds stable reconnection identity and current cell-output
capture.

::: info Source version

This reference follows `main`. Read
[Compatibility](./compatibility#hosted-docs-and-released-packages) when the
installed signatures differ.

:::

::: warning Upgrading: the record is opt-in

`Lens()` and the automatic Lens keep no record of resolved requests. A notebook
that relied on the record, its History tab, or `context.history()` writes
`Lens(record=True)` in a cell. That cell replaces the automatic Lens.

:::

## Notebook-author API

Install `marimo-lens` in the notebook environment. The examples use one mounted
`lens` instance, created in the [`Lens` example](#lens). For installation and a
first selection, see [Getting started](./getting-started).

The top-level package exports:

```python
from marimo_lens import (
    ActivityHandle,
    CellReference,
    ChatRequest,
    ChatRequestReference,
    Diagnostic,
    Lens,
    LensContext,
    LensError,
    LensReferences,
    NotebookReference,
    Record,
    RecordOptions,
    RecordedChange,
    RecordedImage,
    RecordedRequest,
    RequestReference,
    RevealStep,
    Selection,
    SelectionReference,
    SelectionTargetReference,
    __version__,
    agent,
    automatic_lens,
    notebook_context,
    notebook_lens,
    record_request,
)
```

`__version__` comes from the installed `marimo-lens` distribution metadata.

### `Lens`

```python
Lens(
    *,
    record: Record | RecordOptions | bool | None = None,
    dom_selector: str | None = None,
) -> Lens
```

Creates the Python widget and browser UI that own one Lens instance.

```python
from marimo_lens import Lens

lens = Lens()
lens
```

Every Lens holds the analyst's open selections with their notes and annotated
PNGs, opens selection and chat requests, and resolves them with a receipt in
the browser. Pass `record` to also keep a record of resolved requests:

```python
lens = Lens(record=True)
```

The [request record](./data-and-trust#request-record) keeps each resolved
request with the code of every cell it changed. It adds the History tab,
`context.history()`, and the `LR` checks.

Rerunning its creator cell in the same kernel preserves open selections, notes,
and captured images when the replacement Lens occupies the same construction
position and uses the same `dom_selector`. Changing `record` keeps them, so
adding `record=True` to the creator cell records the selections already open.
Keep construction order stable when
a cell creates several instances. The replacement has a fresh connection identity.
Reconnect before using it through an agent handle. Explicitly closing Lens,
normal creator-cell deletion, or stopping the kernel releases open selections.

marimo skips widget disposal when it deletes a creator cell that failed to
compile, so the next Lens the kernel constructs releases that cell's detached
selections. The kernel retains a bounded number of detached Lens states,
listed in [Errors and limits](./reference/errors#resource-limits), and evicting
one releases its open selections.

- `record: Record | RecordOptions | bool | None` chooses the record. `None`,
  the default, and `False` keep none. `True` keeps a full `Record()`. A
  [`RecordOptions`](#recordoptions) dict such as `{"keep": "session"}` sets the
  fields it names and leaves the rest at their defaults. A
  [`Record`](#record) applies as given.
- `dom_selector: str | None` adds configured DOM targets to the default
  notebook targets and regions declared with Lens target or source attributes.
  See [Custom targets](./custom-targets). The string is stripped and accepts at
  most 1,024 UTF-16 code units.
- Returns a renderable `Lens` instance.
- Raises `TypeError` for a `record` of another type, an unknown record option,
  an option value of the wrong type, or a non-string selector.
- Raises `ValueError` for an unknown `keep`, or an empty or oversized selector.
- The browser reports invalid CSS syntax when the view mounts.

Keep the value mounted while people create selections and agents call its
methods. Read [Custom targets](./custom-targets) before configuring host DOM
targets.

### `Record`

```python
Record(
    *,
    keep: Literal["notebook", "session"] = "notebook",
    images: bool = True,
    history: bool = True,
)
```

`Record` describes the record a Lens keeps of resolved requests. It is a
frozen, keyword-only dataclass. `Lens(record=True)` keeps `Record()`.

| Field     | Default      | Behavior                                                                                                                                                                                                                                                     |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `keep`    | `"notebook"` | `"notebook"` writes the record to the notebook's `__marimo__/lens/` folder in the marimo editor. In apps, in Pyodide, and outside marimo it keeps the record in memory until the kernel stops. `"session"` keeps it in memory everywhere and writes no file. |
| `images`  | `True`       | Stores each resolved selection's annotated PNG beside its record line. `False` writes lines without `trace.image`.                                                                                                                                           |
| `history` | `True`       | Shows the History tab, where the analyst reviews resolved requests and reopens selections. `False` hides it. Agents read the record through `context.history()` either way.                                                                                  |

```python
from marimo_lens import Lens, Record

lens = Lens(record=Record(keep="session", images=False))
```

`repr()` reads like the constructor:

```python
>>> Record(keep="session", images=False)
Record(keep='session', images=False, history=True)
```

Raises `ValueError` when `keep` is not `"notebook"` or `"session"`, and
`TypeError` when `images` or `history` is not a bool.

The Lenses of one kernel share one record per storage. Each Lens applies its
own `images` to the lines it writes and its own `history` to its dock.

### `RecordOptions`

```python
class RecordOptions(TypedDict, total=False):
    keep: Literal["notebook", "session"]
    images: bool
    history: bool
```

`RecordOptions` is the dict form of `Record`. Pass it as `Lens(record={...})`
without importing `Record`. Each key sets the field of the same name, and
missing keys keep their `Record` defaults:

```python
Lens(record={"keep": "session"})  # memory everywhere, no files
Lens(record={"images": False})  # record lines without PNGs
Lens(record={"history": False})  # no History tab
Lens(record={"keep": "session", "images": False})
```

An empty dict keeps `Record()`. An unknown key raises `TypeError` that names
it. Values raise as the `Record` constructor does.

### `Lens.record`

`lens.record -> Record | None`

Returns the normalized `Record` this Lens keeps, or `None` when it keeps none.
`Lens(record=True)` and `Lens(record={})` return `Record()`, and a dict returns
the `Record` it describes.

```python
Lens(record={"history": False}).record
# Record(keep='notebook', images=True, history=False)
```

Read it before calling `context().history()`. With `None`, `history()` raises
`record_off`, `check()` returns no `LR` diagnostics, and a resolved request
ends with its browser receipt. With `record.history` false the analyst has no
History tab, so point them at the receipt.

### `Lens.context`

`lens.context() -> LensContext`

Returns a lazy brief for the current request, detached selection and chat
request references, lazy graph-context text, available selection-image bytes,
the captured selection-state revision, and the recorded requests when the Lens
keeps a record.

```python
context = lens.context()
print(context.brief)
selection = context.current
if lens.record is not None:
    earlier = context.history(selection) if selection else context.history()
```

Read [`brief`](./reference/context#brief) first. It names the request, its
trace, and what to read next.

[`history()`](./reference/context#history) lists resolved requests with each
cell they changed and whether that change still holds.

The object does not update. Call `context()` again after notebook or Lens state
changes. Existing contexts remain readable after `lens.close()`.

Raises `LensError(code="lens_closed")` after the Lens closes.

Read the [`LensContext` reference](./reference/context) for every field and
degradation rule.

### `Lens.start_activity`

```python
lens.start_activity(
    target: str | SelectionReference,
    *,
    expected_revision: int | None = None,
    duration_ms: int | None = None,
    label: str | None = None,
    message: str | None = None,
) -> ActivityHandle
```

Marks one selection or cell as the current work location and returns the
opaque owner accepted by `stop_activity()`.

```python
context = lens.context()
selection = context.current

if selection is not None:
    activity = lens.start_activity(
        selection,
        expected_revision=context.revision,
        label="Updating selected result",
        message="Inspecting the target and its producing cells.",
    )
```

Pass a `SelectionReference` and its captured `expected_revision` to address the
selected target. Pass a cell ID string for a notebook walkthrough. A cell
address can omit `expected_revision` and must identify a current graph member.

`duration_ms=None` keeps activity visible until a matching stop, later
attention, or teardown. A duration from 1 through 300,000 milliseconds clears
it after that hold. `label` defaults to **Working** in the browser. Labels
accept 40 UTF-16 code units and activity messages accept 240. Selection state
does not change.

Raises `LensError` for a closed Lens, stale selection revision, missing
selection, unavailable runtime, or missing cell. Invalid inputs raise
`TypeError` or `ValueError`.

### `Lens.stop_activity`

`lens.stop_activity(activity) -> None`

Stops activity when `activity` still owns the current presentation.

```python
lens.stop_activity(activity)
```

`ActivityHandle` is a string-backed, JSON-safe opaque value. A stale handle has
no effect. A non-string value raises `TypeError`. An empty or oversized value
raises `ValueError`. A closed Lens raises `LensError(code="lens_closed")`.

### `Lens.reveal`

```python
lens.reveal(
    target: str | SelectionReference | Sequence[RevealStep],
    *,
    expected_revision: int | None = None,
    duration_ms: int | None,
    label: str | None = None,
    message: str | None = None,
) -> None
```

Brings a cell, selection, or ordered sequence of steps into view. A single
target is a one-step reveal. Multiple steps add previous/next controls in the
popover header and scroll smoothly, respecting reduced motion.

```python
context = lens.context()
selection = context.current

if selection is not None:
    lens.reveal(
        selection,
        expected_revision=context.revision,
        duration_ms=8_000,
        label="Updated result",
        message="Verified the change and brought the selected target into view.",
    )
```

For a user-paced walkthrough, pass 1–16 `RevealStep` dictionaries:

```python
lens.reveal(
    [
        {
            "target": "BYtC",
            "label": "The question",
            "message": "Compare demand with capacity.",
        },
        {"target": "rAqT", "label": "The evidence"},
        {"target": "mNwP", "label": "The next step"},
    ],
    duration_ms=None,
)
```

Each step requires `target` (a cell ID or `SelectionReference`) and accepts
optional `label` and `message`. Put explanations on the steps, rather than in
top-level `label` or `message` arguments. Selection references in the sequence
share `expected_revision` from the same captured context. The whole sequence
is validated before publication.

Pass `duration_ms=None` to hold until dismissal or replacement. A finite
duration limits the whole reveal, including time spent on previous steps.
Navigation never resets the timer or advances automatically. A held single
reveal has a dismiss button; multiple steps also have arrows and a count.
Reveals are transient and stay out of notebook state and History. A reveal
ends when a referenced cell or its upstream inputs rerun, or the cell is
deleted.

Target and revision rules match `start_activity()`. Reveal preserves selection
state and keyboard focus, and replaces current activity. Call `reveal()` before
`resolve()` with the same captured revision in one kernel call. The resolution
event carries each resolved selection's target, so the browser still finds the
target when the reveal arrives after the selection closed. The receipt appears
after the reveal ends. A later attention event replaces the reveal.

`duration_ms` accepts 1 through 300,000 milliseconds. Labels accept 40 UTF-16
code units. Reveal messages accept 1,000. See [Errors and
limits](./reference/errors) for the complete validation contract.

### `Lens.open_request`

```python
lens.open_request(
    note: str,
    cells: Sequence[str | CellReference] | None = None,
) -> str
```

Opens a chat request and returns its ID. An agent opens one when the analyst
asks in chat to change the notebook or explain a result in it, so the request
appears beside the open selections and resolves with a receipt like a selection.

```python
request_id = lens.open_request(
    "Drop refunds from the revenue chart",
    cells=["Hbol"],
)
```

- `note` quotes the analyst's message. It is nonblank and holds at most 4,000
  UTF-16 code units.
- `cells` names up to 16 cells the message is about, by ID or by the
  [cell references](./reference/context#cell-references) Lens returns. Each must
  be in the notebook.
- Lens takes a baseline of every cell's code now. When the resolving Lens
  keeps a record, edits made before resolution become the request's changes in
  the record.
- The request appears in `context.references["chatRequests"]` until it is
  resolved. It has no selection, image, or label.
- Opening a request leaves the selection revision unchanged, so a context read
  before the call stays valid for `resolve()`.

Raises `LensError` with `request_limit_reached` when 16 chat requests are open
or their cells overflow the 24,000-byte chat reference budget, `cell_not_found`
for a cell outside the notebook, and `runtime_unavailable` when Lens cannot
read the notebook to check named cells. More than 16 cells raises
`ValueError`. Chat requests belong to the notebook runtime. A chat request that
is still open when the Lens closes stays open, and the next Lens in the same
kernel lists it and can resolve it. The record of the Lens that resolves it
keeps it.

### `Lens.resolve`

```python
lens.resolve(
    request_ids: str | Sequence[str],
    *,
    expected_revision: int,
    summary: str | None = None,
) -> int
```

Resolves selection and chat requests and returns the selection-state revision
after the call.

```python
context = lens.context()
request_ids = [
    *(item["id"] for item in context.references["selections"]),
    *(item["id"] for item in context.references["chatRequests"]),
]

if request_ids:
    revision = lens.resolve(
        request_ids,
        expected_revision=context.revision,
        summary="Updated the result and verified the affected cells.",
    )
```

Pass one ID string or a sequence of up to 80 unique strings: selection IDs and
chat request IDs in any mix. Lens checks every ID before changing state, and
checks `expected_revision` when the batch holds a selection. Resolved
selections close and share one new revision. Resolving only chat requests
leaves the revision unchanged. A Lens without a record closes the requests and
releases their selection images. With a record, every resolved request adds
one line to the [request record](./data-and-trust#request-record), with the
selection's image when `images` is true.

Include `summary` to tell the user what changed or what you found and how you
verified it. It holds at most 240 UTF-16 code units. The browser shows it in
the resolution receipt. A record stores it beside the original request in each
line, and History shows it there. Resolve separately with distinct summaries
when requests have different outcomes, passing the returned revision to the
next call.

A record that cannot take the lines raises `record_full` and leaves every
request open. A failed write or receipt keeps the resolution, and the lines
wait in memory for the next write. Expected errors are `lens_closed`,
`revision_conflict`, `request_not_found`, and `record_full`.

### `Lens.check`

`lens.check() -> list[Diagnostic]`

Checks open selections, and the record when the Lens keeps one, against the
notebook now. Returns one `Diagnostic` per finding, warnings first, or an empty
list when every check passed. [Checks](./reference/checks) lists the rules, the
diagnostic keys, and the [`marimo-lens check`](./reference/cli#check)
command for notebook files.

```python
for diagnostic in lens.check():
    print(diagnostic["code"], diagnostic["message"])
```

Call it during a code-mode call so Lens can read marimo's notebook document.
The only expected error is `lens_closed`.

### `Lens.close`

`lens.close() -> None`

Closes the Lens instance, cancels pending cell-output capture, and releases
Open selections and Lens-owned selection images. A record keeps its resolved
requests. A file record stays on disk, and a memory record lasts until the
kernel stops. Repeated calls have no effect.

Later public operations raise `LensError(code="lens_closed")`.

## Host API

marimo and host integrations call these functions in the live notebook kernel.
Together they keep one Lens per notebook runtime.

### `automatic_lens`

`automatic_lens() -> Lens | None`

Returns a new `Lens` for marimo to show, or `None` when the notebook needs
none. marimo calls it after a notebook cell that imports marimo runs
successfully in the editor, then displays the returned Lens. The Lens belongs
to that cell and keeps no record. A notebook keeps a record with a cell that
constructs `Lens(record=True)`, which replaces the automatic Lens.

Returns `None` when:

- The kernel serves an app (`marimo run`), a script, or a test.
- The caller runs outside a notebook cell, such as a code-mode scratchpad call.
- The runtime already holds an open Lens.
- A notebook cell constructs its own Lens, as in `Lens(...)` after
  `from marimo_lens import Lens`, or `marimo_lens.Lens(...)`. The import and
  the call can sit in different cells. An import used only for type checks
  keeps the automatic Lens.

A Lens that a notebook cell creates later, such as a newly added
`Lens(dom_selector=...)` cell, closes the automatic Lens and its Open
selections. Rerunning or deleting the cell that owns the automatic Lens also
closes it. The next successful run of a cell that imports marimo shows a new
one when the notebook has no other Lens.

### `notebook_lens`

`notebook_lens() -> Lens | None`

Returns the oldest open Lens in the active marimo runtime, or `None`. A host
renders it in another browser document, such as a preview, to share the
notebook's Lens:

```python
import marimo_lens

lens = marimo_lens.notebook_lens()
```

Each browser document gives one Lens view interaction ownership, so the
notebook and the host document each show a dock for the same selections.

## Notebook files

`notebook_context()` builds a `LensContext` from a notebook file, and
`record_request()` writes a past request to a notebook's record. Neither needs
a kernel or a browser. The [`marimo-lens context`](./reference/cli#context)
command prints the context from a terminal.

A notebook file is a document with no runtime. Lens loads it as a kernel
started on the file would, without running it, and serves it to the same
session that a `Lens` widget uses. Cell IDs are the ones marimo assigns by
position when that kernel loads the file. Each cell reference's `codeHash` is
the `code_hash` a marimo host reports for the cell.

The file holds code, cell names, and the dataflow graph. Cell states come
from the last run marimo saved in `__marimo__/session/` beside the notebook,
while that run still matches the notebook:

| Cell                                          | State      |
| --------------------------------------------- | ---------- |
| It is disabled, or a cell upstream of it is   | `disabled` |
| It raised in the saved run                    | `failed`   |
| It ran in the saved run without raising       | `idle`     |
| Its code does not parse                       | `stale`    |

Lens reads the saved run only when `marimo export session` would reuse it: the
notebook's cells hold the code that ran, and the file's
[inline script metadata](https://peps.python.org/pep-0723/), its dependency
block, is unchanged. After an edit, or without a saved run, every cell whose
code parses and is not disabled reads as `idle`. `marimo export session
NOTEBOOK` runs the notebook and saves a new run. UI element values live in the
kernel, so `context.text` lists no current controls.

### `notebook_context`

`notebook_context(notebook, *requests, images=None, record=True) -> LensContext`

Returns the references, text, history, and images that `Lens.context()`
returns for the same requests, and the same brief apart from the calls it
names:

```python
import marimo_lens

context = marimo_lens.notebook_context(
    "sales.py",
    marimo_lens.Selection(
        cell="revenue_chart",
        note="Central looks off",
        mark=(0.42, 0.31),
    ),
)
print(context.brief)
```

```text
# Request S1 (selection)

Note: "Central looks off"

Part: a point on the output of its producing cell, "revenue_chart".
Image: none (pending).

Trace:
- Cell `vblA` (revenue_chart): idle

Earlier requests on these cells and upstream: none recorded.

Next Lens calls:
- context.history(context.request): earlier requests on its cells and upstream, with the statements each undone change lost.
- context.text: the code of the selected cells and the cells upstream, with what each defines and reads.
```

The brief names `context.history(...)` and `context.text`, the calls this
`LensContext` serves. `context.text` holds the code that a live Lens's agent
reads through code mode.

- `notebook`: a marimo notebook file, `.py` or `.md`.
- `requests`: each a [`Selection`](#selection), a
  [`ChatRequest`](#chatrequest), or a selection mapping as
  the widget sends it, with `id`, `label`, `note`, `target`, `createdAt`,
  `anchor`, `description`, `snapshot`, and optional `domHint` in the shapes
  of the [Context reference](./reference/context). A mapping's cell IDs must
  come from a kernel started on the current file, and Lens refuses an ID the
  file does not hold. Lens keeps a mapping as
  given, apart from its label. Lens opens the requests in order, and the last
  one is the current request. A request without an ID takes its position,
  as in `selection-1` or `chat-2`.
- `images`: the PNG of each selection mapping whose `snapshot` is
  `available`, keyed by selection ID, as bytes or a file path. The PNG must
  match the snapshot's `sha256`, `width`, and `height`.
- `record`: `True` reads the record a `Lens(record=True)` keeps beside the
  notebook, and an absent file reads as an empty record. A path reads that
  record file and the `images/` folder beside it. `False` gives the context
  of a `Lens()` that keeps no record.

Selections take the labels a live Lens gives them, `S1`, `S2`, and so on,
after the highest label in the record. History follows each recorded cell by
its code, as a new kernel does.

Raises `ValueError` when marimo cannot load the notebook, the record path
names no file, a request names a cell the file does not hold, a `Selection`
has an invalid mark, note, or DOM hint, a `ChatRequest` has a blank note, a
mapping is no valid selection, two requests share an ID, or an image is
missing, unused, or does not match its selection. The message names the
change to make. A `ChatRequest` whose note is no string or whose cells are no
sequence of names raises `TypeError`, and more than 16 chat requests raise
`LensError(code="request_limit_reached")`. An image file that cannot be read
raises `OSError`.

### `record_request`

`record_request(before, after, request, *, record, resolved_at, summary=None, opened_at=None) -> str`

Writes one resolved request to a notebook's record and returns its ID. Lens
opens the request on the `before` file, reloads the notebook from the `after`
file, and resolves the request with `summary`:

```python
import marimo_lens

marimo_lens.record_request(
    "states/r1-before.py",
    "states/r1-after.py",
    marimo_lens.Selection(
        cell="region_chart",
        note="Leave the two cross-regional wars out of the charts.",
        id="r1",
    ),
    record="wars/__marimo__/lens/wars.py.jsonl",
    summary="Filtered the Cross-Regional wars out of the wars the charts show.",
    resolved_at="2026-09-02T10:12:00Z",
)
```

The record gains the line a live Lens writes for the request: its note, its
selection and label or its chat cells, the code of each changed cell before
and after, and the summary.
marimo matches the cells of `after` to those of `before` by their code, as
its editor does when a notebook changes on disk, so an edited cell keeps its
ID and an added cell is new. Record requests oldest first. `notebook_context`
and History then report whether each change holds and which request undid
it.

- `before`, `after`: the notebook file when the request opened and when it
  resolved.
- `request`: a [`Selection`](#selection) or a [`ChatRequest`](#chatrequest),
  naming the cells of `before`.
- `record`: the record file to append to, such as
  `__marimo__/lens/<notebook>.jsonl` beside the notebook, where
  `Lens(record=True)` and `notebook_context` read it. Lens creates the file
  and its folder.
- `resolved_at`: when the request resolved, an ISO 8601 time with a UTC
  offset.
- `summary`: the resolution summary.
- `opened_at`: when the request opened. Defaults to `resolved_at`.

A record line is one resolution of a request, so `record_request` refuses a
request ID the record already holds at the same `resolved_at` instant. Give
each request an `id` so that recording it twice fails. A request without one
gets a new ID on every call.

Raises `ValueError` for a notebook marimo cannot load, a time that is invalid
or an `opened_at` after `resolved_at`, a request the record already holds,
and the request errors of `notebook_context`. Raises `TypeError` for a
request of another type, a non-string `summary`, and as `notebook_context`
does. Raises `OSError` when an image file cannot be read or the record cannot
be written, such as a read-only `__marimo__` folder.

### `ChatRequest`

`ChatRequest(note, cells=(), id=None)`

Describes a request an analyst made in chat, as `mounted.open_request()`
opens it. `note` quotes the message, `cells` names the cells it is about by
name or ID, and `id` is the request ID the record keeps. A request without an
ID gets a `chat-` ID.

```python
request_id = marimo_lens.record_request(
    "states/r1-after.py",
    "states/r2-after.py",
    marimo_lens.ChatRequest(
        "Name the wars the charts leave out.", cells=("region_chart",), id="r2"
    ),
    record="wars/__marimo__/lens/wars.py.jsonl",
    summary="Listed the two cross-regional wars under the chart.",
    resolved_at="2026-09-02T10:40:00Z",
)
print(request_id)
```

```text
r2
```

### `Selection`

`Selection(cell, note="", mark=None, dom_hint=None, image=None, id=None)`

Describes a selection on one cell's output, as an analyst makes it in the
browser. Lens turns it into the selection the widget sends for a notebook
target.

| Field      | Type                                  | Meaning                                                                                                                                                       |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cell`     | `str`                                 | The target cell's name, or its ID.                                                                                                                            |
| `note`     | `str`                                 | The analyst's note.                                                                                                                                           |
| `mark`     | `tuple[float, ...] \| None`           | `(x, y)` for a point or `(x, y, width, height)` for a region, in fractions of the output with `(0, 0)` at its top-left corner. `None` marks the whole output. |
| `dom_hint` | `Mapping[str, Any] \| None`           | The element under the mark in the [DOM hint shape](./reference/context#dom-hint-shape). Name the pointed data here, such as the `ariaLabel` of a bar. Lens refuses other keys. |
| `image`    | `bytes \| str \| os.PathLike \| None` | The PNG the analyst saw. Without one, the selection image status is `pending`.                                                                                |
| `id`       | `str \| None`                         | The selection ID, which the record keeps as the request ID. `notebook_context` numbers selections without one, and `record_request` gives each a random ID.   |

The mark becomes the selection's [anchor](./reference/context#anchor-shapes),
and the target description takes the cell's name, or `Cell <id>` for an
unnamed cell, as the widget labels a plain output:

```python
marimo_lens.Selection(
    cell="revenue_chart",
    note="Central looks off",
    mark=(0.3, 0.2, 0.2, 0.6),
    dom_hint={"tag": "path", "ariaLabel": "region: Central; amount: 1200"},
    image="pointed.png",
)
```

## Agent adapter

`import marimo_lens` loads the `marimo_lens.agent` Python API. marimo registers
`marimo_lens._capability` as its `lens` capability for instruction discovery.
Read the agent resources from the installed package:

```python
import marimo_lens

plugin = marimo_lens.agent.plugin()
skill = marimo_lens.agent.skill()
```

### `plugin`

`plugin() -> agent_plugins.Plugin`

Returns the Agent Plugin resource bundle installed with the current
`marimo-lens` distribution.

Raises `agent_plugins.AgentPluginError` when distribution metadata or the
packaged plugin is unavailable. Reinstall the same `marimo-lens` version before
retrying.

### `skill`

`skill() -> agent_plugins.Skill`

Returns the packaged `marimo-lens` Agent Skill.

- `skill.file("SKILL.md")` gives the checked instruction path.
- `skill.body` gives the Markdown instruction body.
- `skill.files` gives the packaged resource inventory.

[Connect an agent](./agents#read-the-packaged-briefing) shows how agents read
the briefing and its references.

Raises `agent_plugins.AgentPluginError` when the plugin contains no Lens skill.

### `add_lens_cell`

```python
add_lens_cell(
    ctx,
    *,
    record: Record | RecordOptions | bool | None = None,
) -> str
```

Returns the existing agent-managed Lens cell ID or queues one collapsed Lens
cell and returns its new ID.

```python
import marimo._code_mode as cm
import marimo_lens

async with cm.get_context() as context:
    cell_id = marimo_lens.agent.add_lens_cell(context)
```

`record` takes the forms `Lens(record=...)` takes, and the new cell spells it
the shortest way: `_Lens()`, `_Lens(record=True)`, or a dict of the options
that differ from their defaults, such as `_Lens(record={"keep": "session"})`.
Pass it when the analyst asks for a record.
`add_lens_cell(context, record=True)` writes files beside the notebook in the
editor.

When the notebook already holds an agent-managed Lens cell, a call without
`record`, or with a `record` that matches the cell's, returns that cell's ID.
A different `record` raises `LensError(code="lens_cell_exists")`, whose message
names the cell's record. Edit that cell to change its record.

Call `connect()` or `discover()` first to reuse an authored or automatically
mounted Lens. This helper searches for agent-managed cells.

The code-mode context creates and runs a queued cell when its async context
manager exits. Connect in a later kernel call after the browser renders Lens.

An existing agent-managed cell is queued to run again unless it still holds an
open Lens or its status is `queued`, `running`, or `disabled`. This mounts a
new Lens in a notebook reopened in a new kernel, after a failed first run, or
after `close()`. A cell whose Lens is open keeps that Lens and its Open
selections.

`ctx` must expose `create_cell()`, `run_cell()`, and `cells.find()`, and found
cells must report `status`. Objects without those methods raise `TypeError`. A
`record` that `Lens` rejects raises the same `TypeError` or `ValueError`.
Several agent-managed Lens cells raise `LensError(code="lens_ambiguous")`.

### `discover`

`discover(context=None) -> tuple[MountedLens, ...]`

Returns the available Lens handles without creating a widget or notebook cell.
An empty tuple means no instance is discoverable in this call. Multiple results
let an agent inspect their contexts and choose an identity for `connect()`.

```python
import marimo._code_mode as cm
import marimo_lens

available = marimo_lens.agent.discover(cm.get_context())
for candidate in available:
    print(candidate.identity, candidate.context().current)
```

Discovery combines browser-ready instances in the current runtime with Lens
objects and supported marimo wrappers in `context.globals`. Aliases of one object
produce one handle. Automatically mounted instances need no global variable,
but must finish browser registration before this path finds them. Globals can
expose an instance before it is rendered. Closed objects are excluded.

Order implies no preference or browser ownership. Handles retain the same identity
across calls while their Lens exists. Discovery does not keep an unreferenced
instance alive after its returned handles are released. A supplied context
without a globals mapping raises `TypeError`.

### `connect`

`connect(context=None, *, identity=None) -> MountedLens`

Selects one of the available handles from `discover()`. Reuses authored and
automatically mounted instances without creating another Lens.

```python
import marimo._code_mode as cm
import marimo_lens

mounted = marimo_lens.agent.connect(cm.get_context())
```

`context` adds Lens objects found in code-mode globals to browser-ready Lens
registrations. When exactly one browser-ready Lens owns a displayed view,
`connect()` selects it even if `context.globals` contains additional Lens
objects. With no browser-ready Lens, one available context object is selected.
Use `identity` to reconnect to the same Lens in a later kernel call or to choose
a specific candidate when several are available.

Raises `LensError(code="lens_unavailable")` when no matching Lens exists.
Raises `LensError(code="lens_ambiguous")` when several browser-ready instances
exist, or when several context objects exist without a browser-ready instance,
and no identity selects one. A context without a globals mapping or a
non-string identity raises `TypeError`. An empty identity raises `ValueError`.

### `MountedLens`

`MountedLens` remains attached to one live `Lens` instance. It can address any
selection owned by that instance.

| Member                                      | Contract                                            |
| ------------------------------------------- | --------------------------------------------------- |
| `identity`                                  | Opaque string for reconnecting across kernel calls. |
| `record`                                    | Returns `Lens.record`: the `Record` or `None`.      |
| `context()`                                 | Delegates to `Lens.context()`.                      |
| `cell_image(cell_id, *, expected_revision)` | Requests a fresh, unmarked cell-output PNG.         |
| `start_activity(...)`                       | Delegates to `Lens.start_activity()`.               |
| `stop_activity(activity)`                   | Delegates to `Lens.stop_activity()`.                |
| `reveal(...)`                               | Delegates to `Lens.reveal()`.                       |
| `open_request(note, cells)`                 | Delegates to `Lens.open_request()`.                 |
| `check()`                                   | Delegates to `Lens.check()`.                        |
| `resolve(...)`                              | Delegates to `Lens.resolve()`.                      |

#### `mounted.cell_image(cell_id, *, expected_revision) -> bytes | None`

The first call starts browser capture and returns `None`. End that kernel call,
reconnect to the same Lens, and repeat the same cell ID and revision. The
completed call returns and consumes the PNG bytes.

```python
context = mounted.context()
selection = context.current

if selection is not None and selection["cells"]:
    cell_id = selection["cells"][0]["id"]
    png = mounted.cell_image(
        cell_id,
        expected_revision=context.revision,
    )
```

One capture can be pending per Lens. Finish it before requesting another
cell. A stale revision raises `revision_conflict`. A different cell while
capture is pending raises `capture_busy`. A terminal result consumes the
capture slot, so another call starts a new capture. Browser capture has a
15-second deadline and the Python request expires after 20 seconds. The operation requires a current graph member and a browser-ready Lens
view. Read [How Lens works](./how-lens-works#selection-images) for the
difference between a selection image and a cell-output image.

## `LensError`

`LensError` extends `RuntimeError` and exposes:

- `code: str`, a stable machine-readable failure code.
- `revision: int | None`, the current selection-state revision when available.

`str(error)` starts with the code, as in
`lens_unavailable: No Lens is available in the active notebook.`, so a
traceback reported by a code-mode integration names the recovery code.

Read [Errors and limits](./reference/errors) for every code, recovery action,
argument rule, and bound. Read [Connect an agent](./agents) for the complete
workflow.
