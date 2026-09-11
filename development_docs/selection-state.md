# Selection state

Python owns every open selection, History entry, and stored selection image
for one `Lens` instance. The browser requests transitions and renders the
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
├── anchor: normalized point or rectangle
├── note
├── DOM hint
├── creation time
├── selection image status and metadata
└── previous resolution metadata, when reopened
```

The target carries an opaque browser-document ID and the document pathname.
Notebook targets carry exactly one cell ID. DOM targets carry an exact selector
and a canonical sorted set of cell IDs inferred from nested
`data-runtime-cell-id` metadata or explicit notebook source records. DOM targets
also preserve exact value selectors.

The anchor and DOM hint can change. The label, target, and creation time are
immutable after selection creation. A geometry or DOM-hint change makes the
stored image outdated until replacement capture succeeds.

## Authoritative aggregate

`SelectionState` is an immutable aggregate with:

- A revision.
- The next stable `S<n>` label number.
- The current selection ID.
- An activation order covering every open selection.
- Open `SelectionRecord` values.
- Addressed `AddressedSelectionRecord` History entries.

`SelectionStore` owns the current aggregate pointer. A transition first returns
a complete next aggregate. `SelectionStore.commit()` advances the pointer,
publishes one `_state` trait value, and restores the previous aggregate if trait
publication fails.

Each successful mutation advances the revision exactly once. Failed validation
and failed state publication leave the previous aggregate authoritative.

## State ownership and lifetime

| State                                   | Authority                         | Lifetime                                                      |
| --------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| Open selections, targets, and PNG bytes | Python `SelectionStore`           | Until delete, clear, resolve, `Lens.close()`, or teardown     |
| Current selection and activation order  | Python `SelectionStore`           | Updated by activation and selection removal                   |
| History entries                         | Python `SelectionStore`           | Until History clear, bounded eviction, close, or teardown     |
| Next stable label                       | Python `SelectionStore`           | For the lifetime of the `Lens` instance                       |
| Selection gesture and sheet workflow    | Browser reducer                   | Current interaction-owner browser view                        |
| Selection capture job                   | Browser `SelectionCapture`        | Until commit, replacement, cancellation, removal, or teardown |
| Selection image preview read            | Browser `SelectionSnapshotLoader` | While one or more preview consumers hold a lease              |

Lens-instance state lives in memory. It does not persist across process or
widget teardown. History entries are session history, not a durable audit
log.

## Synchronized projection

The `_state` trait contains:

- `revision`
- `nextLabel`
- `currentSelectionId`
- `selections`
- `history`

Activation order and PNG bytes remain private Python data. A trait observer
restores the Python projection if another caller attempts to replace `_state`.
The `_selector` trait has the same Python-authoritative behavior.

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
removes every open selection and image while preserving History and the next
label counter.

Clearing History preserves open selections and their images. It also removes
`previousResolution` metadata from reopened selections because the referenced
History entry no longer exists.

## Resolve and History

`Lens.resolve()` accepts one selection ID or a sequence of unique IDs and one
expected revision. Python validates the full batch before changing state.

One atomic resolve transition:

1. Removes every selected open record.
2. Releases its selection image bytes.
3. Appends one History entry per selection.
4. Assigns every entry the resulting revision and shared optional summary.
5. Promotes the most recently activated remaining selection.
6. Publishes one synchronized state value.

History is ordered by resolution revision and bounded by item count and encoded
size. Older entries are evicted first when necessary. A batch that cannot fit
its required entries fails before state changes.

The browser resolution receipt is a best-effort presentation sent after the commit. Event
delivery failure cannot restore the removed selections.

## Reopen

Reopen identifies a History entry by selection ID and resolution revision. The
transition restores the original target, anchor, note, DOM hint, creation time,
and prior resolution metadata as the current selection. It starts a fresh
selection image lifecycle with `pending` status. The History entry remains
in History.

A reopened selection can explain the prior attempt through
`previousResolution.addressedAt` and its optional summary. Compact context
includes this field only for the current selection.

## Admission limits

State admission protects:

- Open selection count.
- Selection and History encoded byte limits.
- Required compact-reference capacity.
- Per-field text and identifier bounds.
- Stored PNG size and total image bytes.
- Canonical labels, target identities, timestamps, and normalized geometry.

The public [resource limits table](../docs/reference/errors.md#resource-limits) owns the user-visible
numbers. The exact internal constants live in `_protocol_models.py`,
`_selection_state.py`, `_references.py`, and `_images.py`.

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
- History keys pair selection ID with resolution revision and are unique.
- History revisions are ordered and never exceed the state revision.
- A committed transition advances exactly one revision.

## Source map

| Concern                                        | Source                                                     |
| ---------------------------------------------- | ---------------------------------------------------------- |
| Aggregate, records, transitions, and admission | `packages/marimo-lens/src/marimo_lens/_selection_state.py` |
| Python composition and command execution       | `packages/marimo-lens/src/marimo_lens/widget.py`           |
| Python validation models                       | `packages/marimo-lens/src/marimo_lens/_protocol_models.py` |
| Browser state schemas                          | `packages/protocol/src/contracts.ts`                       |
| Browser mutation orchestration                 | `packages/widget/src/selection/selection-actions.ts`       |
| Selection image capture lifecycle              | `packages/widget/src/selection/selection-capture.ts`       |
| Browser interaction reducer                    | `packages/widget/src/selection/state.ts`                   |
| Open and History UI                            | `packages/widget/src/selection/components/`                |
