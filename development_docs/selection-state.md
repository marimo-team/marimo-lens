# Selection state

Python owns every open selection and stored selection image for one `Lens`
instance, and projects History from the Lens's record when it keeps one and
shows History. The browser requests transitions and renders the
synchronized projection. It does not author authoritative state.

Read [Architecture](architecture.md) for the shared vocabulary and
[Protocol](protocol.md) for the messages that request these transitions.

## Object model

A target identifies the selectable unit. A selection records human attention
inside that target.

```text
Selection
├── id and stable S<n> label
├── target
│   ├── notebook: one producing cell
│   └── dom: exact selector and zero or more producing cells
├── anchor: normalized point or rectangle, with the frame element it sits on
├── note
├── DOM hint
├── captured description with optional render-source reference and media part
├── creation time
├── selection image status and metadata
└── previous resolution metadata, when reopened
```

The target carries an opaque browser-document ID and the document pathname.
Notebook targets carry exactly one cell ID. DOM targets carry an exact selector
and a canonical sorted set of cell IDs inferred from nested
`data-marimo-lens-cell-id` metadata or explicit notebook source records. DOM targets
also keep each declared value selector verbatim. Lens never evaluates it.

The anchor and DOM hint can change. The label, target, description, and creation time are
immutable after selection creation. A geometry or DOM-hint change makes the
stored image outdated until replacement capture succeeds.

## Authoritative aggregate

`SelectionState` is an immutable aggregate with:

- A revision.
- The next stable `S<n>` label number.
- The current selection ID.
- An activation order covering every open selection.
- Open `SelectionRecord` values.

`LensSession` owns the current aggregate pointer. A transition first returns a
complete next aggregate. The session reads anything fallible first, such as the
baseline for a new selection request, then advances the pointer, keeps the
runtime's open requests in step, and publishes one `_state` trait value. A
failed publication leaves the committed aggregate in place, and the next
publication repairs browser views.

Each successful mutation advances the revision exactly once. Failed validation
leaves the previous aggregate authoritative.

Python assigns a new selection's label from the notebook runtime's label
sequence, which every Lens in the runtime shares. `nextLabel` in `_state` is
the browser's hint for the label it shows while the selection commits.

## State ownership and lifetime

| State                                   | Authority                  | Lifetime                                                                          |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| Open selections, targets, and PNG bytes | Python `LensSession`       | Across recognized creator reruns, subject to retention limits and native disposal |
| Current selection and activation order  | Python `LensSession`       | Updated by activation and selection removal                                       |
| History                                 | The Lens's `RecordStore`   | As long as its journal: the record file, or the kernel for a memory journal       |
| Next stable label                       | Python `LensRuntime`       | Seeded from every opened record store, shared by the runtime                      |
| Selection gesture and sheet workflow    | Browser reducer            | Current interaction-owner browser view                                            |
| Selection capture job                   | Browser `SelectionCapture` | Until commit, replacement, cancellation, removal, or teardown                     |
| Selection image preview read            | Browser `useObjectUrl`     | While its preview is open                                                         |

Open selections and images live in memory. A recognized same-kernel rerun of
a Lens's creator cell transfers the aggregate to the Lens constructed at the same
marimo deterministic construction slot with the same `dom_selector`. Notes,
PNG bytes, revision, current selection, activation order, labels, and the
request owner's original baselines and concurrency remain intact. Each new
widget has a fresh identity and comm and waits for its own browser readiness.
Creator-code edits, upstream-code edits, and recovery after syntax or semantic
errors use the same handoff while the creator cell keeps its construction slot
and selector.

The old widget and session close during the rerun. Pending cell-output
captures and transient lifecycle watches close with them. Explicit
`Lens.close()`, an unknown direct comm close, native creator-cell deletion
disposal, and kernel teardown release the open state. Deleting, clearing, or
resolving a selection releases its request and image before a later rerun can
transfer the aggregate.

`_marimo/lifecycle.py` replaces the exact native comm lifecycle item so cell
membership reaches the widget before comm closure. The native kernel keeps
cell metadata during graph deactivation for edits and syntax errors, and
deletes that metadata before disposing a deleted, valid graph cell. The adapter
checks the creator's metadata membership because marimo forwards graph deactivation's
`deletion=True` to descendants too. Preservation requires marimo's native
deterministic ID provider, kernel cell metadata, and a recognized comm item.
The runtime retains detached aggregates and request owners. A generation
check prevents a late cleanup callback from releasing an adopted slot. An
unclaimed slot remains available through repeated graph invalidations
and releases on native creator-cell deletion disposal or bounded eviction.
Retention admits up to 64 detached aggregates and 64 MiB of combined baseline
source strings and PNG bytes across the runtime. Source strings count by their
in-memory size, once per object shared across retained baselines. Accounting
reads their size directly. When either bound is exceeded, the earliest detached
aggregates and their request owners leave together. A changed selector releases
the prior slot's state.

marimo 0.25.2 skips lifecycle disposal when deleting a creator that has left
the graph after a syntax error, and drops the cell's metadata on this path. It
also skips disposal when deleting a graph cell with a semantic error, such as
duplicate definitions. The detached aggregate and its request owner remain until bounded
eviction or kernel teardown. Recreating the same cell ID, construction slot,
and selector can adopt that state. A fresh cell ID starts empty. Restart the
kernel to release detached state after these deletions.

Widget operations acquire the widget lock before the runtime lock. Retention,
adoption, ledger changes, and eviction run under the runtime lock and never
call an old widget's publisher.

Open state ends when the kernel exits.
A Lens with a file record keeps resolved requests in the notebook's record
file, so History survives a kernel restart. A new Lens continues labels after
the highest label in every record store its runtime opened. A Lens with no
record keeps no resolved request past its receipt.

## Synchronized projection

The `_state` trait contains:

- `revision`
- `nextLabel`
- `currentSelectionId`
- `selections`

Activation order and PNG bytes remain private Python data. A trait observer
restores the Python projection if another caller attempts to replace `_state`.
The `_selector` and `_history` traits have the same Python-authoritative
behavior. `_history` is null on a Lens that shows no History.
[Protocol](protocol.md#history-trait) describes `_history`.

## Create a selection

1. The user arms a one-shot selection session.
2. Pointer or keyboard input locates one target and a normalized point or
   rectangle.
3. The browser creates a selection with an empty note and `pending` image
   status.
4. The browser sends `selection.put` with the expected revision and no PNG
   buffer.
5. Python validates the target, anchor, label, note, state limits, and revision.
6. Python commits the next aggregate and publishes `_state`.
7. The browser opens note editing and starts selection-image capture.
8. Successful capture sends a second `selection.put` with `available` image
   metadata and one PNG buffer.
9. Failed capture changes the image status to `failed` while preserving the
   target selection.

The browser serializes mutations. After a timeout or revision conflict, it
waits for synchronized state and checks the intended postcondition before it
retries once. See [Protocol](protocol.md#revision-and-synchronization).

## Edit and activate

Opening or editing a selection makes it current. An explicit activation moves
its ID to the end of activation order. Removing the current selection promotes
the most recently activated remaining selection.

Note edits preserve a current selection image. Moving or resizing the anchor,
or changing its DOM hint, marks the image `outdated` and starts replacement
capture. A failed replacement retains the outdated image bytes and metadata so
the previous visual evidence remains inspectable.

A selection whose target surface disappears remains open with its target,
anchor, note, DOM hint, image state, and available actions. Notebook targets
reattach by document identity, pathname, and cell ID. DOM targets reattach by
document identity, pathname, exact selector, and inferred producing cell IDs.

## Delete and clear

Deleting one selection removes its record and image bytes. Clearing selections
removes every open selection and image while preserving the next label counter.
Deleted and cleared selections never reach the record.

## Resolve and History

`Lens.resolve()` accepts one selection ID or a sequence of unique IDs and one
expected revision. Python validates the full batch before changing state.

On a Lens that keeps a record, Python builds one record line per resolved
request before the transition and hands them to the journal. A journal that
cannot take them raises `record_full`, and every request stays open. A failed
write after the journal took them leaves the lines pending for the next write.
A Lens with no record skips this step.

One atomic resolve transition then:

1. Removes every selected open record.
2. Releases its selection image bytes.
3. Promotes the most recently activated remaining selection.
4. Publishes one synchronized state value.

Python then projects History again when the Lens shows History, and sends
the resolution event. The event carries each resolved selection's
`selectionId`, `label`, and `target`, so the browser places the receipt from
the event and `_state` alone.

The browser resolution receipt is a best-effort presentation sent after the commit. Event
delivery failure cannot restore the removed selections.

## Reopen

Reopen needs History. On a Lens that shows no History, `selection.reopen`
fails with `history_off`. Reopen identifies a recorded selection by selection
ID and resolution time.
Python reads it from the record and restores its ID, label, note, anchor,
description, and creation time as the current selection. The target moves to
the document that asked, and each cell ID follows its cell to the notebook now,
because a page reload and a kernel restart both change those identities. Each
History entry already carries that followed target, so the browser checks it
against the page before it asks to reopen. The selection starts a fresh image
lifecycle with `pending` status. The resolved
request stays in the record and in History.

A reopened selection can explain the prior attempt through
`previousResolution.resolvedAt` and its optional summary. Compact context
includes this field only for the current selection.

## Admission limits

State admission protects:

- Open selection count.
- Selection encoded byte limits.
- Required compact-reference capacity.
- Per-field text and identifier bounds.
- Stored PNG size and total image bytes.
- Canonical labels, target identities, timestamps, and normalized geometry.

The public [resource limits table](../docs/reference/errors.md#resource-limits) owns the user-visible
numbers. The exact internal constants live in `_core/bounds.py`,
`_selection/state.py`, `_selection/references.py`, and `_selection/images.py`.

An admission failure raises `selection_context_limit` or a more specific
protocol error before the authoritative state changes.

## Invariants

- Every open selection ID and label is unique.
- Every open selection is present exactly once in activation order.
- A nonempty state has one current selection, which is last in activation
  order.
- The next label follows every allocated open label and never moves backward.
- Available or outdated image metadata has matching PNG bytes.
- Pending and failed image states have no stored PNG bytes.
- A reopened selection's label names no other open selection.
- A committed transition advances exactly one revision.

## Source map

| Concern                                                   | Source                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Aggregate, records, transitions, and admission            | `packages/marimo-lens/src/marimo_lens/_selection/state.py`                      |
| History projection and reopen                             | `packages/marimo-lens/src/marimo_lens/_record/history.py`                       |
| Use cases, state pointer, and publication                 | `packages/marimo-lens/src/marimo_lens/_session/session.py`                      |
| Detached aggregates, request owners, and retention limits | `packages/marimo-lens/src/marimo_lens/_session/runtime.py`                      |
| Native creator-cell disposal and deterministic slots      | `packages/marimo-lens/src/marimo_lens/_marimo/lifecycle.py`                     |
| Python composition and command translation                | `packages/marimo-lens/src/marimo_lens/_widget/lens.py`, `commands.py`           |
| Python validation models                                  | `packages/marimo-lens/src/marimo_lens/_schema/selection.py`                     |
| Browser state schemas                                     | `packages/protocol/src/contracts/`                                              |
| Browser mutation orchestration                            | `packages/widget/src/selection/selection-actions.ts`, `revisioned-mutations.ts` |
| Selection image capture lifecycle                         | `packages/widget/src/selection/selection-capture.ts`                            |
| Browser interaction reducer                               | `packages/widget/src/selection/state.ts`                                        |
| Open and History UI                                       | `packages/widget/src/dock/`, `history/`, `selection/components/`                |
