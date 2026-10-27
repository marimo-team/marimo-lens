# Protocol

Python and browser views exchange private Lens messages through the
[AnyWidget](https://anywidget.dev/) custom-message channel. The protocol validates every envelope, payload, revision,
and binary buffer at the receiving boundary.

Protocol version 9 is exact. Python and TypeScript schemas must change together.
Selections, and the selection in a History entry, require a captured
`description`. Its optional rendering reference is client-supplied evidence,
separate from notebook sources.

## Authorities

| Contract                                | Owner                                                        |
| --------------------------------------- | ------------------------------------------------------------ |
| TypeScript state and transport schemas  | `packages/protocol/src/contracts/`                           |
| TypeScript bounded text                 | `packages/protocol/src/bounded-text.ts`                      |
| Python transport models                 | `packages/marimo-lens/src/marimo_lens/_protocol/messages.py` |
| Python selection models                 | `packages/marimo-lens/src/marimo_lens/_schema/`              |
| Python message parsing and construction | `packages/marimo-lens/src/marimo_lens/_protocol/codec.py`    |
| Browser request correlation and events  | `packages/widget/src/anywidget/client.ts`                    |
| Browser reverse capture                 | `packages/widget/src/anywidget/output-capture-transport.ts`  |
| Python command execution                | `packages/marimo-lens/src/marimo_lens/_widget/commands.py`   |
| Python reverse-capture mailbox          | `packages/marimo-lens/src/marimo_lens/_widget/capture.py`    |

`contracts/` splits the TypeScript schemas by subject: `transport.ts` holds the
envelope and bounded scalars, then `selection.ts` (selections and Lens state),
`history.ts` (History and chat requests), `commands.ts`, and `events.ts` build
on it.

The Python and TypeScript models intentionally duplicate the wire schema. Their
tests are the parity contract. Do not make one language permissive to avoid
updating the other.

## Envelopes

Lens uses three protocol discriminators:

| Discriminator          | Direction                                                  | Purpose                                                                 |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `marimo-lens.command`  | Browser to Python, or Python to browser for output capture | Requests an operation and carries a request ID.                         |
| `marimo-lens.response` | Receiver to requester                                      | Correlates success or failure with one request ID and current revision. |
| `marimo-lens.event`    | Either direction                                           | Announces browser readiness or transient agent presentation.            |

Every Lens message carries `protocol`, `version`, and a bounded payload.
Commands and events also carry `type`. Commands and responses carry
`requestId`. Responses carry `ok`, `revision`, and either a validated success
payload or a bounded error.

AnyWidget resource messages share the custom-message channel with their own
discriminator. Lens parsers ignore them. Unknown unrelated messages also remain
outside Lens handling.

## Browser selection commands

| Type                 | Purpose                                                            | Revision guarded | PNG buffer                               |
| -------------------- | ------------------------------------------------------------------ | ---------------- | ---------------------------------------- |
| `selection.put`      | Create a selection or replace, clear, or preserve its image state. | Yes              | One only when `imageAction` is `replace` |
| `selection.activate` | Make one open selection current.                                   | Yes              | None                                     |
| `selection.delete`   | Remove one open selection.                                         | Yes              | None                                     |
| `selection.reopen`   | Open a recorded selection from History again.                      | Yes              | None                                     |
| `selections.clear`   | Remove every open selection.                                       | Yes              | None                                     |
| `history.refresh`    | Project History again from the record and the notebook now.        | No               | None                                     |
| `history.image`      | Read a resolved selection's PNG from the record by its digest.     | No               | None in request, one in success response |
| `snapshot.get`       | Read stored selection image metadata and bytes for a preview.      | No               | None in request, one in success response |

Selection mutation responses advance the submitted revision by exactly one.
The browser checks the buffer count of every response and that a mutation
response advances the revision once.

`snapshot.get` is intentionally revision free. The response still identifies
the requested selection, uses image ID `image:<selection-id>`, and carries the
current server revision. A removed or image-free selection returns
`snapshot_not_found`.

## Reverse output capture

Python sends `output.capture` with one exact graph cell ID and no buffers. The
browser locates the displayed Lens capture handler and replies with:

- One `marimo-lens.response` success containing exact cell ID, image metadata,
  and one PNG buffer.
- One failure response containing the exact cell ID, bounded error, and no
  buffer.

The image ID is `image:<request-id>`. Python correlates request ID, cell ID,
revision, metadata, and bytes before it makes the image available to
`MountedLens.cell_image()`.

Browser views publish `output.capture.ready` when a handler is connected and
`output.capture.unready` when the handler or view is released. These events let
Python distinguish a displayed capture-capable Lens from an in-memory model.

## Agent presentation events

Python sends:

| Type                       | Payload contract                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `attention.activity.start` | Activity ID, attention address, optional duration, optional label, and optional message.                               |
| `attention.activity.stop`  | Activity ID only.                                                                                                      |
| `attention.reveal`         | Transient ID, 1–16 steps with addresses and optional explanations, and optional duration for the entire reveal.        |
| `attention.trail.stop`     | Matching transient Trail ID whose referenced content changed.                                                          |
| `selection.resolved`       | 1–64 resolved selections with `selectionId`, `label`, and `target`, a revision, `resolvedAt`, and an optional summary. |

An attention address is tagged as `cell` or `selection`. A cell address carries
one graph cell ID. A selection address carries the stored selection ID and the
revision captured with its `SelectionReference`.

Each browser view queues selection-addressed attention until its synchronized
state reaches the address revision. Events remain ordered behind an earlier
blocked event. A later state revision can present the event while the selection
remains open because selection target identity is immutable. An activity stop
also removes a matching queued start before it reaches the presentation
controller.

These events change browser presentation, not authoritative selection state.
Resolve commits state before Python sends `selection.resolved`. The event
carries each resolved selection's target, so a browser places the receipt from
the event and `_state`. Once its `_state` reaches the event's revision, each
document filters the event to targets it owns and presents no receipt when its
subset is empty.

## Binary buffers

PNG bytes travel as AnyWidget binary buffers. Buffer cardinality is part of the
wire contract:

- A selection image replacement command carries one buffer.
- A successful stored-image or History image response carries one buffer.
- A successful output-capture response carries one buffer.
- Every other Lens command, response, and event carries no buffer.

Both receivers validate cardinality before reading bytes. Python also validates
PNG signature, dimensions, metadata, digest, per-image size, and total stored
selection-image size.

No PNG buffer enters `_state`, `_history`, `_chats`, JSON references,
standalone text, or the record.

## History trait

Python publishes History in the `_history` trait, apart from the revisioned
`_state`. The trait is null for the Lens's whole life when the Lens shows no
History, because it keeps no record or keeps one with
`Record(history=False)`. The browser then renders no History tab and no History
count. Otherwise its value is a projection of the Lens's record: the newest 100
resolved requests in both channels within 96,000 bytes, newest last, each
changed cell with its record status, and the record's health. `total` counts
every request the record read returned.

`cells` names the cells the entries traced or changed, newest entries first, by
marimo name without the `*` marimo gives a top-level
function or class, and by up to 8 names each defines. It holds at most 256
cells within 24,000 bytes, and leaves out cells the notebook no longer holds,
so browsers can show a cell as `revenue_chart`. A change's `undoneBy` names the
request that undid it, or `"unrecorded"` for an edit outside every recorded
request. An entry's `shaped` lists the open selections whose cells or upstream
cells the request changed or traced. A selection that names no cells, such as
a DOM target without producing cells, appears in no `shaped`.
A change the notebook no longer holds carries `missing`: up to 8 statements it
added that its cell lost. Python omits `shaped` and `missing` when they would
be empty.

An entry for a selection carries `selection`, whose target names the cells
that continue the recorded ones in the notebook now, and `image`: the digest,
size, capture time, and whether the selection moved after capture. The bytes stay out of the trait. A
browser reads them with `history.image`, which names the digest and returns
the PNG as one buffer, or `history_image_not_found` when the record no longer
holds it.

Python projects History when the first browser view loads, after every
resolution, when a selection opens or closes, when a view attaches to retained
state, and on `history.refresh`. A browser sends `history.refresh` when the
History tab or a note editor opens, every 5 seconds while either stays visible,
and when the window regains focus, because edits outside Lens change record
status without a Lens message.
It keeps one refresh in flight. A refresh never advances the selection revision.
When Python cannot project History, browsers keep the History they show.
On a Lens that shows no History, `history.refresh`, `history.image`, and
`selection.reopen` fail with `history_off`.

`selection.reopen` names a History entry by `selectionId` and `resolvedAt` and
carries the asking document's identity. Python reads the selection from the
record, moves its target to that document, follows its cells to the notebook
now, and keeps its ID and label. A selection another Lens holds open fails
with `selection_already_open`, and one whose cell is gone fails with
`history_not_found`.

## Chats trait

Python publishes the open chat requests in the `_chats` trait as a list of
`{"id", "note", "openedAt"}`, oldest first, up to 16. Every Lens in a notebook
runtime shares one request ledger, so opening or resolving a chat request
through any Lens updates the trait on all of them. The trait carries no
revision, and Python restores it when a view writes it directly.

## Revision and synchronization

Every selection mutation includes `expectedRevision`. Python compares it with
the authoritative state under the Lens lock. A mismatch returns
`revision_conflict` and the current revision.

After a successful browser mutation:

1. Python commits the new aggregate.
2. Python publishes the `_state` trait.
3. Python replies with the resulting revision.
4. The browser waits until its model projection reaches that revision.
5. The browser checks the intended postcondition.

The browser request client waits up to 20 seconds for a correlated response.
The state synchronizer waits up to 5 seconds for the trait revision. A mutation
or response timeout can still mean Python committed the state, so the browser
waits for the next revision and checks the postcondition before reporting
failure.

Browser mutation orchestration retries once after `revision_conflict`. It first
waits for the reported current revision and checks whether another view already
satisfied the postcondition.

Public agent methods do not retry a stale selection revision automatically. The
caller must reconnect, read a fresh `LensContext`, and reassess the operation.

## Capture timeouts

Three time bounds protect different stages:

| Bound                     | Value      | Owner                    |
| ------------------------- | ---------- | ------------------------ |
| Browser selection request | 20 seconds | `LensProtocolClient`     |
| Browser output raster     | 15 seconds | `OutputCaptureTransport` |
| Python output mailbox     | 20 seconds | `OutputCaptureSlot`      |

The output-raster deadline is shorter than the Python mailbox deadline so a
browser timeout can arrive as a correlated terminal response.

Selection image capture is owned by a browser `AbortController` and commit
fence. Replacement, removal, supersession, target disappearance, and teardown
cancel affected work.

## Error ownership

Python answers a refused browser command with an error response whose `code`
comes from these families:

| Codes                                                                                                        | Meaning                                                                                      | State consequence                                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `invalid_request`, `invalid_buffers`, `unsupported_version`, `unsupported_command`                           | The envelope, payload, version, command type, or buffer count failed the transport contract. | No mutation.                                            |
| `invalid_selection`, `invalid_image`, `invalid_image_action`                                                 | A selection or image payload failed its schema or a transition rule.                         | No mutation.                                            |
| `invalid_png`, `image_metadata_mismatch`, `image_too_large`, `image_dimensions_exceeded`, `image_store_full` | A selection PNG failed validation, or storing it would exceed the Lens image budget.         | No mutation.                                            |
| `revision_conflict`                                                                                          | The command named an outdated selection revision.                                            | No mutation from that command.                          |
| `selection_not_found`, `history_not_found`, `history_image_not_found`, `snapshot_not_found`                  | The referenced selection, recorded request, recorded image, or selection image is absent.    | No mutation.                                            |
| `selection_limit_reached`, `selection_context_limit`                                                         | Admission would exceed the selection count or the synchronized-state and reference bounds.   | No mutation.                                            |
| `selection_identity_changed`, `selection_capture_changed`                                                    | A mutation violated immutable identity or image lifecycle.                                   | No mutation.                                            |
| `selection_label_conflict`, `selection_already_open`                                                         | A reopened selection's label names an open selection, or this or another Lens holds it open. | No mutation.                                            |
| `history_off`                                                                                                | A History command reached a Lens that shows no History.                                      | No mutation.                                            |
| `lens_closed`                                                                                                | The Python model ended.                                                                      | Teardown owns cleanup.                                  |
| `internal_error`                                                                                             | Python isolated an unexpected command failure.                                               | The previous committed aggregate remains authoritative. |

The browser raises these codes itself, as a `LensProtocolError`:

| Codes                      | Meaning                                                                                                                                                                                             | State consequence                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `invalid_command`          | An outgoing command or an incoming capture command carries the wrong buffers.                                                                                                                       | The command is not sent or not run.          |
| `invalid_response`         | A Python response has the wrong buffer count, a mutation response does not advance the revision once, or a snapshot or History image response fails its schema or names another selection or image. | The request fails.                           |
| `timeout`                  | Python sent no response within 20 seconds.                                                                                                                                                          | Python may still have committed the command. |
| `client_disposed`          | The requesting view ended.                                                                                                                                                                          | Teardown owns cleanup.                       |
| `capture_handler_conflict` | A second view registered an output-capture handler.                                                                                                                                                 | The first handler stays registered.          |

Cell-output capture runs the other way. The browser answers a capture command
with `browser_unavailable`, `output_unavailable`, `capture_timeout`, or
`capture_failed`, and Python reports any other browser code as
`capture_failed`. `MountedLens.cell_image()` raises those codes as `LensError`,
and adds `capture_busy` while the capture slot waits on another cell,
`capture_timeout` past the Python mailbox deadline, `runtime_unavailable`,
`cell_not_found`, and `lens_closed`. Open selections remain unchanged.

Expected public failures become `LensError` with a stable `code` and current
revision when available. Invalid Python argument types and values fail before a
message or state transition.

## Change the protocol

Use this sequence for a field, command, event, response, bound, or version
change:

1. State the new behavior and which side owns it.
2. Update TypeScript schemas in `packages/protocol/src/contracts/`.
3. Update Python models in `_protocol/messages.py` or `_schema/`.
4. Update TypeScript and Python constructors or parsers.
5. Update browser and Python handlers.
6. Update buffer validation when binary payloads change.
7. Add equivalent contract tests in both languages.
8. Add lifecycle tests at the caller boundary.
9. Update selection-state, context, agent, or host tests affected by the new
   behavior.
10. Update public API documentation when a user-visible contract changed.
11. Rebuild browser resources and run `make package`.

Increment the exact protocol version when an old browser bundle and new Python
package could interpret the same message differently. Update every version
constant and fixture in one change. Lens ships the matching browser bundle and
Python implementation in one distribution version.

Read [Testing](testing.md) for the package and boundary checks.
