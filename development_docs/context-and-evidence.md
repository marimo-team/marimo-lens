# Context and evidence

`Lens.context()` returns one detached `LensContext` built from the current
selection aggregate and one read of the active
[marimo](https://docs.marimo.io/) runtime. The context gives
an agent three representations of the same selected work:

- Compact JSON-safe references.
- Lazy standalone text with bounded source and control state.
- Annotated selection images as PNG bytes.

The representations have independent limits and lifetimes. Reading one does
not widen another.

## Context construction

`Lens.context()` follows this sequence:

1. Read the current immutable `SelectionState` under the Lens lock.
2. Prioritize producing cell IDs from the current selection, then the remaining
   open selections.
3. Read a private `RuntimeSnapshot` from the active marimo kernel.
4. Build compact references immediately.
5. Copy stored selection image bytes into the context mapping.
6. Store a callable that builds standalone text on the first `context.text`
   read.

The returned context does not update. Read a fresh context after notebook state,
selection state, or runtime controls change.

`LensContext.revision` identifies the captured selection aggregate.
`LensContext.current` resolves `currentSelectionId` inside the captured
references. It returns `None` when no open selection was captured.

## Runtime snapshot

`MarimoRuntimeAdapter` concentrates private marimo kernel access. It reads:

- The notebook filename, from the notebook's `__file__` global so a renamed
  notebook reports its current path.
- Exact graph cell membership.
- Cell source, definitions, references, language, direct parents, runtime state,
  run result, and stale state when available.
- Cell names and notebook order, from marimo's notebook document. marimo hands
  the kernel a copy of that document only during a code-mode call, and the
  adapter keeps the cell IDs, names, and order of the latest one per kernel.
  Later reads take names and order from it. Cells registered since follow in
  graph order without names. Before the first code-mode call in a kernel, a
  read keeps graph order and leaves names empty.
- Relevant native marimo controls and AnyWidget identities.

The adapter reads the graph under its host lock when one is exposed. Host-owned
descriptors are treated as fallible. A missing package, absent kernel context,
missing graph, invalid graph mapping, or failing host attribute produces an
unavailable runtime snapshot with a bounded reason.

One snapshot holds the whole notebook up to 1,000 cells. Requested cells come
first: the cells of current selections and open chat requests, or the cells a
chat request names or a resolution traces, with their upstream closure. The
remaining cells follow in notebook order. A requested cell that only the
document shows stays inside the bound too, so `open_request()` can check every
named cell. Beyond that bound the adapter reports omitted IDs and
counts. Controls are read only for the requested cells. Standalone text keeps
its own 64-cell bound over the same snapshot.

Runtime access belongs in:

- `packages/marimo-lens/src/marimo_lens/_marimo/snapshot.py`
- `packages/marimo-lens/src/marimo_lens/_marimo/controls.py`

Detached record types belong in `_notebook/`. Keep
marimo imports and private descriptor access out of context projection and the
browser packages.

## Compact references

`LensContext.references` contains:

- The captured revision and generation time.
- Notebook pathname and runtime availability.
- Current selection ID.
- One reference for every open selection.

Each selection reference preserves admission data:

- Selection ID and stable label.
- Note.
- Target kind, document identity, pathname, and producing cell IDs.
- Exact DOM selector for a configured DOM target.
- Current runtime status for each producing cell.
- Anchor geometry.
- Selection image status, with the reason when capture failed.
- Optional DOM hint.
- Optional captured target description.
- Optional previous resolution for the current reopened selection.

Target identity, selection identity, geometry, and producing cell IDs remain
intact. Reference fitting first shortens notebook path and runtime reason, then
removes optional DOM hints, target descriptions, and snapshot failure reasons,
then shortens notes. It processes secondary selections before the current
selection.

History entries stay outside compact references. A DOM target with no
producing cell still returns its document locator, exact selector, DOM hint,
note, anchor, and selection image status.

## Brief

`LensContext.brief` renders on first read from the same selection state,
chat requests, runtime snapshot, and record read as the rest of the context.
`_context/brief.py` owns its sections and its 4,000-character budget. The brief joins
Lens facts with the cell state the snapshot already holds, names cells by ID
and name, and lists only Lens calls. Cell code, values, images, and control
state stay in `text`, `images`, and the agent's own notebook tools.

`current_request()` picks the brief's subject: the newest open chat request
when it opened after the current selection's request in the ledger, or else
the current selection. `render_brief()` renders the calls section first and
shortens the other sections to the budget left after it.

The history section reuses the record status of the same context, so reading
`brief` and then `history()` for the same cells computes the rows once. On a
Lens with no record, `render_brief()` receives no history. The brief says the
Lens keeps no record, and its calls section leaves out `context.history()` and
the record issues of `check()`.

## Standalone text

`LensContext.text` builds at first access and is cached on that context. It
contains:

1. Notebook identity and runtime availability.
2. Every open selection with its target, note, producing-cell statuses, anchor,
   document pathname, DOM hint, and image status.
3. Relevant current controls.
4. Producing cells and retained upstream cells in topological order.
5. Explicit notices for omitted cells, truncated source, omitted controls, and
   incomplete control state.

Producing cells are mandatory evidence when they are available. Upstream cells
use the remaining cell and source budgets. Source allocation follows relevance
order so a distant large ancestor cannot consume a producing cell's entire budget.

History entries and PNG bytes never enter standalone text.

## Control selection

Lens considers graph-relevant marimo UI elements and
[AnyWidget](https://anywidget.dev/) values. It ranks
controls defined by a producing cell first, followed by referenced controls in
upstream distance and runtime order.

Control capture uses a conservative display policy:

- A native marimo UI value can be included when its metadata is complete and
  its frontend value is a supported scalar or scalar sequence.
- Direct password controls are sensitive and render as redacted.
- Composite controls, non-native UI objects, and incomplete metadata remain
  opaque.
- AnyWidget identity can be reported, but synchronized AnyWidget state remains
  sensitive.
- Nested values are bounded by item count, depth, node count, string length,
  and encoded character count.
- Attribute, collection, and mapping reads can execute application code. Lens
  catches failed reads and reports bounded unavailable or opaque descriptions.
- Lens excludes itself from the captured control inventory.

Keep the safety policy in `_marimo/controls.py` and the renderer-neutral
bounded serialization in `_notebook/controls.py`. A new control kind needs tests for
identity, value visibility, sensitive values, incomplete metadata, failing
descriptors, and budget behavior.

`RuntimeSnapshot` records `control_truncated_output_ids` and
`control_incomplete_output_ids`. Standalone text reports affected producing
cell IDs alongside source and control-budget notices. This preserves the
distinction between an absent control and a control lookup that was incomplete
or truncated during runtime collection.

## Selection images

`LensContext.images` maps selection IDs to PNG bytes for open selections whose
image status is `available` or `outdated`. These bytes are copied from the
Python selection records into a read-only mapping for the context lifetime.

Selection image capture:

1. Resolves the target surface and the element under the anchor.
2. Excludes `[data-marimo-lens-ui]` descendants.
3. Captures an overview of the complete target.
4. Adds a detail raster for large or scrolled content when needed.
5. Draws the point or rectangle and `S<n>` label in the relevant raster.
6. Encodes and hashes a bounded PNG.
7. Sends metadata and one binary buffer to Python.

`planSelectionCapture()` reads geometry and produces a capture element, crop,
optional detail target, and transformed anchor. Rasterization consumes that plan.
A client can mark a preferred context container with `data-marimo-lens-context`.
For small DOM targets with automatic context, capture walks to a nearby containing block, stopping at
clipping containers, document roots, or a block larger than 2,000 × 720 CSS pixels.
Context crops prefer 640 × 480 pixels, with at least 320 × 120 pixels of canvas.
A selected rectangle expands that crop to retain its complete extent, then the
normal PNG bounds govern downscaling. Anchor coordinates are translated for this image and remain
unchanged in selection state. Notebook output capture retains its output boundary.

The `capturedAt` metadata value records when capture starts. It is not a
completion timestamp.

The image belongs to the open selection lifecycle. Note edits preserve it.
Anchor or DOM-hint changes make it outdated. A recognized same-kernel
creator-cell rerun preserves it through the construction-slot handoff described
in [Selection state](selection-state.md#state-ownership-and-lifetime).
Delete, clear, resolve, explicit close, and teardown release it.

## Cell-output images

`MountedLens.cell_image()` provides a separate one-use transfer of the current
canonical notebook output. It does not read the stored selection image and does
not draw Lens markers.

One `OutputCaptureSlot` exists per `Lens`:

1. The first call validates the revision and graph cell, sends a browser
   request, and returns `None`.
2. The browser captures the canonical output and replies with a validated PNG
   or bounded error.
3. A later call with the same cell and revision returns and consumes the PNG
   bytes when available.
4. The same call remains pending while the browser works.
5. A different cell receives `capture_busy` while the slot is pending.
6. A new revision supersedes an obsolete pending record.
7. A terminal read releases the slot for the next cell.

The browser deadline is 15 seconds. The Python slot deadline is 20 seconds, so
the browser has time to send its bounded terminal response before Python marks
the request stalled.

## Data and trust boundary

Lens handles notebook source, rendered output, DOM text, control values, and
captured pixels. Treat all of them as notebook data.

- A configured DOM root owns selection identity. Small roots can include bounded
  surrounding pixels in their image while source context stays tied to the root.
- Open shadow-root content can be inspected and captured with its host target.
- Same-origin iframe documents can become interaction and capture surfaces.
- Cross-origin iframe bodies cannot be inspected or rasterized.
- External images, fonts, styles, and iframe resources can require browser
  network access and cross-origin permission during rasterization.
- DOM hints are descriptive locator evidence. They are not a replacement for
  pixel inspection when the task depends on appearance.
- A code-mode agent can receive cell source, supported control values, DOM
  hints, and PNG bytes. The active integration owns how those values leave the
  kernel.
- Temporary files created for an image reader must be private and removed after
  use. The kernel and image reader must share the filesystem.

Do not weaken redaction, cross-origin checks, byte validation, or context bounds
to make one renderer easier to capture.

## Limits

The public [resource limits table](../docs/reference/errors.md#resource-limits) owns exact user-visible
values. Internal owners include:

| Limit group                                                          | Source                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Identifiers, notes, labels, messages, selectors, and protocol values | `_core/bounds.py` and `packages/protocol/src/contracts/transport.ts`    |
| Selection encoded state                                              | `_selection/state.py`                                                   |
| History entries and bytes                                            | `_record/history.py`                                                    |
| Compact references                                                   | `_selection/references.py`                                              |
| Relevant cells and source                                            | `_notebook/provenance.py`                                               |
| Controls and serialized values                                       | `_notebook/controls.py`                                                 |
| Standalone text sections                                             | `_context/text.py`                                                      |
| One PNG and total stored PNG bytes                                   | `_selection/images.py` and `packages/image-capture/src/evidence/png.ts` |

Change a public limit in its source owners, both schema languages when
applicable, boundary tests, and `docs/reference/errors.md` in one patch.

## Source map

| Concern                             | Source                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Compose `LensContext`               | `packages/marimo-lens/src/marimo_lens/_context/build.py`                          |
| Public context types                | `packages/marimo-lens/src/marimo_lens/_core/types.py`, `_context/lens_context.py` |
| marimo graph and runtime adaptation | `packages/marimo-lens/src/marimo_lens/_marimo/snapshot.py`                        |
| Detached runtime records            | `packages/marimo-lens/src/marimo_lens/_notebook/snapshot.py`                      |
| Provenance closure and ranking      | `packages/marimo-lens/src/marimo_lens/_notebook/provenance.py`                    |
| marimo control adaptation           | `packages/marimo-lens/src/marimo_lens/_marimo/controls.py`                        |
| Bounded control serialization       | `packages/marimo-lens/src/marimo_lens/_notebook/controls.py`                      |
| Compact references                  | `packages/marimo-lens/src/marimo_lens/_selection/references.py`                   |
| Standalone text                     | `packages/marimo-lens/src/marimo_lens/_context/text.py`                           |
| Python PNG validation               | `packages/marimo-lens/src/marimo_lens/_selection/images.py`                       |
| Browser raster and composition      | `packages/image-capture/src/evidence/`                                            |
| Cell-output mailbox                 | `packages/marimo-lens/src/marimo_lens/_widget/capture.py`                         |
| Request record and its status       | `packages/marimo-lens/src/marimo_lens/_record/lines.py`, `status.py`, `cells.py`  |
| Brief                               | `packages/marimo-lens/src/marimo_lens/_context/brief.py`                          |
| Checks and the check command        | `packages/marimo-lens/src/marimo_lens/_checks.py`, `__main__.py`                  |

## Request record

`_record/lines.py` builds the record's lines and owns their schema. A journal
stores them. `_record/requests.py` keeps each open request's baseline and the
other requests open beside it. `LensSession` composes them: a selection that opens or reopens
gets a baseline of every notebook cell, and on a Lens that keeps a record,
`resolve()` builds one line per resolved request and hands the lines to the
journal before any request closes. A Lens with no record keeps the baselines,
so `LV003` still reports changed cells, and `resolve()` closes its requests
without a line.

`Record` in `_core/record.py` is the public choice: `keep`, `images`, and
`history`. `_widget/arguments.py` normalizes `Lens(record=...)` to a `Record`
or None once, and `add_lens_cell()` reuses that validation.

`LensRuntime` holds what every Lens in one notebook runtime shares: the
request ledger, one `RecordStore` per storage, the label sequence, the
`kernel` token, and one lock that orders every operation reading and changing
them together. `LensRuntime.record(choice, storage=..., journal=...)` opens the
store for `storage` on its first call and returns a `KeptRecord` that pairs the
shared `RecordStore` with that Lens's `Record`. Later calls for the same
storage reuse the store, so Lenses with the same storage append to one record
and a creator rerun binds the store its predecessor used. Each Lens applies its
own `images` to the lines it writes and its own `history` to the History it
publishes. A chat request belongs to no Lens, so the record of the Lens that
resolves it keeps it.

`LensRuntime.next_label()` returns one past the larger of the labels this
runtime gave out and `RecordStore.highest_label()` across every store it
opened, so two Lenses with different storage never share a label. Because the
runtime shares the request ledger, requests open in two Lens instances name
each other as concurrent, chat requests stay open when one Lens replaces
another, and lines kept for an unsaved notebook survive that replacement. A
creator-cell rerun hands each selection request to the new Lens with its
original baseline, as [Selection state](selection-state.md#state-ownership-and-lifetime)
describes.

A line compares the baseline with the notebook at resolution. Cells whose code
differs, cells that appeared, and cells that disappeared become `changes`, each
with the hash of its code before and after. The hash is marimo's `code_hash`,
the first 16 hexadecimal characters of SHA-256 over the code, so record lines
and the `codeHash` of each `CellReference` join with the cell versions host
protocol clients such as marimo pair read. `codes` holds every text the line
refers to, so a line stays readable when earlier lines were lost. The baseline
and the comparison read the kernel's registered cell code. During a code-mode
call the adapter adds document cells the kernel could not register, such as
code with a syntax error, so such an edit records its text and not a deletion.
A cell that only the document shows counts as added or deleted only when both
the baseline and the resolution could read the document. A registered cell on
one side only counts as added or deleted, and when the other side read only
marimo's graph the line reports its baseline incomplete, since the cell may
only have failed to parse there. `baseline.repeated` names the `before` codes
that several baseline cells held, and a later kernel follows a change through
none of them. Saving and reopening a notebook can reformat code, so a later
kernel also follows a change through a `before` code with the same statements.
`baseline.alike` names the `before` codes whose statements several baseline
cells held, and code with no statements names no cell, so neither continues a
change. Graph and document cells share the 1,000-cell bound.

Outside code mode, the graph shows only registered cells, and the adapter
works from the latest notebook document it kept, as
[Runtime snapshot](#runtime-snapshot) describes. A cell that document held, or that the kernel registered since, and that the graph lacks now goes
into `RuntimeSnapshot.unseen`: it may be deleted, or its code may not parse.
Its status is `unknown`, a record line reports its baseline incomplete,
`LR003` never calls it gone, and the brief says its code is out of reach. A
cell absent from that document and from the graph since counts as deleted. An
analyst who restores a deleted cell under its old ID with code that does not
parse makes that verdict stale until the next code-mode call.

marimo assigns cell IDs by position when it loads a notebook. Each line names
the runtime that wrote it with a random `kernel` token the Lens runtime draws
once, so readers can trust its cell IDs only while that runtime runs.

### Journals

A journal accepts one resolution's lines, with the PNGs their `trace.image`
names, as a unit, and returns lines and health from one read. `image(sha256)`
returns stored bytes and `image_path(sha256)` the file that holds them, each
after checking the digest. A journal reads nothing until first use. `Lens()`
opens no journal, so it reads and writes no record file.

The marimo adapter resolves a `Record.keep` to a `Storage` with
`MarimoRuntimeAdapter.storage(keep)`, which reads no file, and opens the
journal for a storage with `journal(storage)`. `LensRuntime` therefore knows no
marimo mode.

| `keep`       | Storage  | Journal         | Where                                   | Used                                                       |
| ------------ | -------- | --------------- | --------------------------------------- | ---------------------------------------------------------- |
| `"notebook"` | `file`   | `FileJournal`   | `__marimo__/lens/<notebook>.py.jsonl`   | The marimo editor on a server                              |
| `"notebook"` | `memory` | `MemoryJournal` | The runtime's memory, until it restarts | A marimo app, marimo's Pyodide runtime, and outside marimo |
| `"session"`  | `memory` | `MemoryJournal` | The runtime's memory, until it restarts | Everywhere                                                 |

An app keeps its record in memory so a visitor's History shows that session's
requests and none of the author's notes or images. Pyodide's playground names
every notebook `notebook.py` in browser storage, so a file would mix
notebooks, and no agent can read that storage.

`FileJournal` keeps its last read while the file's path, size, and
modification time stay the same. Any change reads the last 16 MiB of the file
again.

`FileJournal` resolves the file on every operation, so a first save moves
later writes. When the file changes while the journal has a previous one, as
when marimo renames or moves the notebook, the journal locks the old file,
copies the images its lines name into a new folder, appends the lines the new
file lacks under the new file's lock, empties the old file, and removes it
while it still holds the lock. Windows keeps an open file in place, so there
the empty file stays. After taking a lock, a writer checks that the name still
holds the file it locked and otherwise opens the name again, so its line lands
in a file that exists. A failed move keeps the old name, reports `failed`, and
retries at the next operation without writing a line twice.

Lines that wait for a file name or a failed write stay in memory, at most 256
lines within 64 MiB beyond the resolution being accepted. Past that bound
`accept()` raises `JournalFull`, which `resolve()` reports as `record_full`
before any request closes. A single resolution always fits, so selection
images can use their whole 64 MiB budget.

Images live in `images/<sha256>.png` beside the record. Before appending a line,
the writer stores the image it names: a unique temporary file in that folder,
synced and renamed into place, skipped when the file already holds those
bytes. A crash therefore leaves at most an orphan image or a temporary file,
never a line that names a missing image. An image that later disappears or no
longer matches its digest leaves the line readable, with `path` set to `None`
and an `LR004` finding from `check()`. Waiting images count toward the 64 MiB
bound of waiting lines.

A newline commits a line. Appending holds an exclusive lock on the record
file, `fcntl.flock` on POSIX and `msvcrt.locking` on Windows, imported on first
use. A file system that offers no lock fails the write, because an append
without it could interleave lines from two kernels. Under the lock the writer
drops an unterminated final fragment, which only a writer that stopped
mid-line leaves, then appends whole lines and syncs the file. On POSIX, Lens
also asks the file system to sync the folder after it creates the record file
or stores an image, and goes on when the file system refuses. A write that
failed may still have reached the file, so its retry reads the whole file
under the lock and skips lines it already holds. Readers ignore
an unterminated final line and keep one copy of a line with the same kernel,
request ID, and resolution time.

The [resource limits](../docs/reference/errors.md#resource-limits) table owns
the record's bounds. A line past a bound stays valid and says what it left out:
a baseline over the cell bound reports itself incomplete, changed cells past
the bound are cut, and code texts stay out until the line fits. A memory
journal drops its oldest resolutions whole, and its health reason counts their
lines. A writer waits 2 seconds for the lock, then fails the write and keeps
its lines pending.

A failed write never fails `resolve()`. `context.references["notebook"]["record"]`
reports the health of the record: `saved`, `unsaved`, `session`, or `failed`
with a reason. It is None on a Lens with no record, and `history()` then
raises `record_off`. A failed read reports `failed` for that read alone, and
`check()` reports it as `LR005`.

## Record status

`LensContext.history()` joins the record read at `context()` time with the
runtime snapshot of the same call. `_notebook/statements.py` splits code into
statements and caches the result by code text. `RecordStatus` follows each
changed cell through later lines, `CurrentCells` finds the cell that continues
it in the notebook now, and the status judges the change inside that cell. The
public [`history()` reference](../docs/reference/context.md#history) states
the rule and its limits.

`RecordStore.status()` keeps the last `RecordStatus` while the journal returns
the same lines object and the snapshot holds the same cells, as
`RecordStatus.inputs()` lists them. History refreshes, `context()`, the brief,
and `check()` then share one walk over the record until a resolution or a
notebook edit. Rows leave image paths out, and the context fills them in on
each call, so a deleted PNG never keeps a path. When History asks first, the
status walks only the chains of its newest rows.

`RecordStatus` sorts lines by `resolvedAt`, because a Lens can append its
line after a request another Lens resolved later. A target's rows are computed
newest first until 256 match, and each row once per context.

Across kernels, `_match` follows a recorded cell to the current cell with the
same code. When several cells hold that code, the one that keeps the recorded
cell ID wins. Otherwise the cell that holds the most recorded statements wins.
Among cells that hold equally many, a single cell that defines the same names
or keeps the recorded cell ID wins. A restarted editor keeps cell IDs, and a
fresh load may give the recorded ID to another cell, so names and ID carry
equal weight. Two cells that each carry one of those signals, or tied cells
that carry neither, make the match ambiguous. A candidate holds at least half
the recorded statements or defines the same names. The cells are indexed once
by statement and by defined names, so a match visits only cells that share
something with the recorded code. An ambiguous match makes the status
`unknown`, and the change names no current cell.

Following a cell observes one code version per step: the code the request
left, the `before` of a later change when it differs from the last code seen,
which an unrecorded edit produced, the `after` of that later change, and the
current code. A later request that opened before the previous step's request
was resolved contributes only its `after`. The step where the change stops
holding names `undoneBy`. A step whose code the record left out makes that
author unknown.

The current code is unknown, and so is the status, when the snapshot cannot
show the cell. A cell missing from a snapshot that is available and complete
is deleted, unless it is in `RuntimeSnapshot.unseen`. A snapshot is complete
when it lists every cell of marimo's notebook document, read in this call or
kept from the latest code-mode call. Outside code mode, a cell whose code does
not parse is missing from the graph too, so a cell that document held stays
unseen until the next code-mode call shows it.

The history keeps the newest 256 matching rows. A row lists at most 8 missing
and 8 restored statements of at most 300 characters, and at most 16 `movedTo`
cells.

## Checks

`_checks.py` holds the rules behind `Lens.check()`. `check_selections()` runs
the `LV` and `LT` rules on open selections, with each selection's baseline from
the request ledger. `check_record()` runs the `LR` rules on one record read and
the `RecordStatus` of the same snapshot. `LensSession.check()` calls it only on
a Lens that keeps a record. Both return plain `Diagnostic` rows, so the brief
reuses `check_selections()` for its current request. `check_record()` reports
a failed or partial read as `LR005` or `LR006`, so an empty result covers the
whole record.

`marimo-lens check` runs `LensSession.check()` on a notebook file, as
[Notebook files](#notebook-files) composes it. The session holds no
selections, so only the `LR` rules report. The public
[Checks](../docs/reference/checks.md) page owns the rule list.

## Notebook files

`_file_context.py` serves a notebook file as a host with no runtime.
`NotebookFile` implements `NotebookReads` from one load: marimo's `load_app()`
assigns positional cell IDs, the IDs of a kernel started on the file. The
snapshot builds its graph from the cells that parse, as a kernel registers
them, and keeps the rest as stale unregistered cells. Each call builds a fresh
`LensRuntime`, so the session has a new kernel token and follows recorded
cells by their code, and a `FileJournal` on the record path gives it a
`KeptRecord` with History off.

`notebook_context()` puts each selection through `LensSession.put_selection()`
and returns `LensSession.context(mounted=False)`, whose brief leaves out the
calls on a mounted Lens. A `Selection` becomes the `SelectionInput` the widget
sends for a plain cell output: the anchor from `mark`, the description label
from the cell name, and an `available` snapshot when it carries a PNG. A
selection mapping is validated as given.

`record_request()` opens the selection on the `before` file, then
`NotebookFile.reload()` loads the `after` file and calls marimo's
`sort_cell_ids_by_similarity()`, as `AppFileManager.reload()` does for an edit
on disk. An edited cell keeps its ID and an added cell takes a new one. The
session then resolves the request, and the session clock stamps the given
`opened_at` and `resolved_at`.

A file snapshot has no run state or controls. Cells that parse read as
`idle`, and the text has no `Current controls` section. The public
[Python API](../docs/api.md#notebook-files) owns the contract.
