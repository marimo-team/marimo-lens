# Protocol

Python and browser views exchange private Lens messages through the
[AnyWidget](https://anywidget.dev/) custom-message channel. The protocol validates every envelope, payload, revision,
and binary buffer at the receiving boundary.

Protocol version 4 is exact. Python and TypeScript schemas must change together.

## Authorities

| Contract                                | Owner                                                       |
| --------------------------------------- | ----------------------------------------------------------- |
| TypeScript state and transport schemas  | `packages/protocol/src/contracts.ts`                        |
| TypeScript bounded text                 | `packages/protocol/src/bounded-text.ts`                     |
| Python transport models                 | `packages/marimo-lens/src/marimo_lens/_protocol_models.py`  |
| Python message parsing and construction | `packages/marimo-lens/src/marimo_lens/_protocol.py`         |
| Browser request correlation             | `packages/widget/src/anywidget/request-client.ts`           |
| Browser event routing                   | `packages/widget/src/anywidget/event-router.ts`             |
| Browser reverse capture                 | `packages/widget/src/anywidget/output-capture-transport.ts` |
| Python command execution                | `packages/marimo-lens/src/marimo_lens/widget.py`            |
| Python reverse-capture mailbox          | `packages/marimo-lens/src/marimo_lens/_output_capture.py`   |

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
| `selection.reopen`   | Restore one History entry as an open selection.                    | Yes              | None                                     |
| `selections.clear`   | Remove every open selection.                                       | Yes              | None                                     |
| `history.clear`      | Remove every History entry.                                        | Yes              | None                                     |
| `snapshot.get`       | Read stored selection image metadata and bytes for a preview.      | No               | None in request, one in success response |

Selection mutation responses advance the submitted revision by exactly one.
The browser validates that a response identifies the requested selection and
that its payload and buffer count match the command.

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

| Type                       | Payload contract                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `attention.activity.start` | Activity ID, attention address, optional duration, optional label, and optional message.               |
| `attention.activity.stop`  | Activity ID only.                                                                                      |
| `attention.reveal`         | Attention address, required duration, optional label, and optional message.                            |
| `selection.resolved`       | One or more resolved selection IDs and labels, their shared resolution revision, and optional summary. |

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
Resolve commits state before Python sends `selection.resolved`. After the
matching History entries reach the browser, each document filters the event to
targets it owns and presents no receipt when its subset is empty.

## Binary buffers

PNG bytes travel as AnyWidget binary buffers. Buffer cardinality is part of the
wire contract:

- A selection image replacement command carries one buffer.
- A successful stored-image response carries one buffer.
- A successful output-capture response carries one buffer.
- Every other Lens command, response, and event carries no buffer.

Both receivers validate cardinality before reading bytes. Python also validates
PNG signature, dimensions, metadata, digest, per-image size, and total stored
selection-image size.

No PNG buffer enters `_state`, JSON references, standalone text, or History.

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
| Browser selection request | 20 seconds | `RequestClient`          |
| Browser output raster     | 15 seconds | `OutputCaptureTransport` |
| Python output mailbox     | 20 seconds | `OutputCaptureSlot`      |

The output-raster deadline is shorter than the Python mailbox deadline so a
browser timeout can arrive as a correlated terminal response.

Selection image capture is owned by a browser `AbortController` and commit
fence. Replacement, removal, supersession, target disappearance, and teardown
cancel affected work.

## Error ownership

| Error family                                                 | Meaning                                                          | State consequence                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `invalid_command`, `invalid_response`, `unsupported_command` | Envelope, payload, response, or buffer contract failed.          | No intended mutation.                                   |
| `revision_conflict`                                          | Caller used stale selection state.                               | No mutation from that command.                          |
| `selection_not_found`, `history_not_found`, `cell_not_found` | Referenced state or graph cell is absent.                        | No mutation.                                            |
| `selection_limit_reached`, `selection_context_limit`         | Admission limit would be exceeded.                               | No mutation.                                            |
| `selection_identity_changed`, `selection_capture_changed`    | A mutation violated immutable identity or image lifecycle.       | No mutation.                                            |
| `browser_unavailable`, `runtime_unavailable`                 | The owning browser or marimo runtime cannot serve the operation. | Selection state remains available.                      |
| `capture_busy`, `capture_timeout`, `capture_failed`          | Cell-output transfer cannot complete.                            | Open selections remain unchanged.                       |
| `client_disposed`, `lens_closed`                             | The requesting view or Python model ended.                       | Teardown owns cleanup.                                  |
| `internal_error`                                             | Python isolated an unexpected command failure.                   | The previous committed aggregate remains authoritative. |

Expected public failures become `LensError` with a stable `code` and current
revision when available. Invalid Python argument types and values fail before a
message or state transition.

## Change the protocol

Use this sequence for a field, command, event, response, bound, or version
change:

1. State the new behavior and which side owns it.
2. Update TypeScript schemas in `packages/protocol/src/contracts.ts`.
3. Update Python models in `_protocol_models.py`.
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
