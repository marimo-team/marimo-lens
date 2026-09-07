# Agent integration

`marimo_lens.agent` connects a live
[marimo code-mode](../docs/agents.md) agent to a displayed `Lens`. It
adapts the public Python object into a small handoff surface for context, image
capture, activity, reveal, and resolution.

Lens grounds work in a selected target and its producing cells. The active
code-mode integration owns notebook discovery, scratchpad execution, cell
inspection, edits, execution, and general verification.

## Integration layers

| Layer               | Responsibility                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| marimo code mode    | Supplies a live kernel context, graph, cells, globals, and cell mutation APIs.                          |
| `marimo_lens.agent` | Discovers or creates Lens, selects one instance, returns `MountedLens`, and locates packaged resources. |
| `MountedLens`       | Exposes detached context, cell-output PNG capture, activity, reveal, and resolve.                       |
| Lens Agent Skill    | Defines request routing, evidence requirements, verification, presentation, and resolution policy.      |
| marimo Pair         | Provides a code-mode connection when the current agent has no live notebook execution channel.          |

Lens augments a code-mode integration. It does not own the notebook execution
environment.

## Capability discovery

The Python distribution registers a standard Python
[entry point](https://packaging.python.org/en/latest/specifications/entry-points/):

```text
group: marimo.agent.capability
name:  lens
value: marimo_lens.agent
```

The entry point lives in `packages/marimo-lens/pyproject.toml`. marimo code mode
can discover the installed module through its capability registry.

`agent_plugin()` locates the Agent Plugin installed with the active
`marimo-lens` distribution. `agent_skill()` selects its `marimo-lens` skill.
Module help locates and prints the installed resource paths, so instructions
and Python methods come from the same package version.

The authored resources live at repository root in `plugin.json` and
`skills/marimo-lens/`. The distribution path is explained in
[Build and distribution](build-and-distribution.md#agent-plugin-resources).

## Add a Lens cell

`add_lens_cell(ctx)` accepts a live marimo code-mode context with cell lookup,
creation, and execution APIs.

It searches for the private marker used by an agent-created Lens cell:

```text
# marimo-lens: agent-managed Lens cell
```

The behavior is:

- One existing marked cell returns its ID.
- Several marked cells raise `lens_ambiguous`.
- No marked cell queues one hidden-code cell, runs it when the code-mode
  context applies the mutation, and returns its ID.

The generated cell imports `Lens`, creates one private `_lens` binding, and
appends it to marimo output. Private bindings avoid adding public names to the
dataflow graph.

Cell creation and browser rendering occur across kernel calls. Connect in a
fresh call after the new cell renders and the browser announces capture
readiness.

Host integrations that require `dom_selector` own their authored Lens cell and
selector policy. `add_lens_cell()` creates the default notebook-output Lens.

## Connect to Lens

`connect(context=None, *, identity=None)` considers two candidate sources:

- Existing `Lens` objects and supported marimo wrappers in `context.globals`.
- Browser-ready Lens instances registered in the current marimo runtime scope.

Candidates are deduplicated by Python object identity. Closed Lens objects and
objects with no communication channel are excluded.

Connection outcomes:

| State                                   | Result                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- |
| One candidate and no requested identity | Return its `MountedLens` handle.                                          |
| No candidate                            | Raise `lens_unavailable`.                                                 |
| Several candidates and no identity      | Raise `lens_ambiguous`.                                                   |
| Requested identity matches              | Return that Lens.                                                         |
| Requested identity is unavailable       | Raise `lens_unavailable` and tell the caller to connect again without it. |

Each Lens receives one opaque URL-safe identity in a weak process-local mapping.
The identity remains stable while the Python `Lens` object remains alive. It is
not a notebook cell ID, selection ID, persisted credential, or cross-process
identifier.

## Mounted registry

A Python Lens registers through `_registry.py` when a browser view reports
output capture ready in the active marimo runtime scope. It unregisters when every
browser view becomes unready or the Lens closes.

The registry is scoped by the active marimo UI registry object. It prevents a
code-mode call from discovering a displayed Lens in another live runtime. Weak
references avoid extending either runtime or Lens lifetime. The widget and agent
adapter supply the active scope. The registry stores membership and performs
identity matching, while runtime access remains in `_marimo_runtime.py`.

`context.globals` remains a separate discovery path. It lets an integration
connect to an existing Lens object before browser-ready registration is the
only available handle.

## `MountedLens`

A `MountedLens` fixes one opaque identity and one Python `Lens` for the handle
lifetime.

| Member                                      | Contract                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `identity`                                  | Reconnects to the same live Lens in a later kernel call.                 |
| `context()`                                 | Returns a fresh detached `LensContext`.                                  |
| `cell_image(cell_id, *, expected_revision)` | Starts, polls, and consumes one unannotated cell-output PNG transfer.    |
| `start_activity(target, ...)`               | Starts transient work presentation and returns its opaque owner handle.  |
| `stop_activity(activity)`                   | Stops presentation when the handle still owns it.                        |
| `reveal(target, ...)`                       | Brings one stored selection or graph cell into view for a supplied hold. |
| `resolve(selection_ids, ...)`               | Moves verified selections to History in one revisioned state transition. |

The handle delegates to the public `Lens` methods. Argument and lifecycle
contracts therefore stay aligned between notebook users and agent integrations.

## Detached context workflow

Use one context for one decision:

1. Connect to the intended Lens.
2. Read `context = mounted.context()`.
3. Keep `mounted.identity`, `context.revision`, and chosen selection IDs
   together across kernel calls.
4. Read `context.current` as the likely referent when the user points to “this”
   or “here.”
5. Inspect `context.references`, then read `context.text` or image bytes required
   by the task.
6. Reconnect and read a fresh context after the notebook or selection state
   changes.

An empty selection list describes the current attention state. It does not
cancel an explicit overview or notebook walkthrough request. Those tasks can
use graph-member cell IDs as attention addresses.

## Attention addresses

Activity and reveal accept:

- A cell ID string for an overview or walkthrough.
- A stored `SelectionReference` plus its captured revision for human-selected
  notebook and DOM targets.

Python validates cell addresses against exact active graph membership.
Selection addresses validate the expected revision and stored selection ID.
The browser then finds the trusted target record from synchronized state.

Use a selection address even when its DOM target has zero or several producing
cells. Producing cell references identify provenance and possible edit
locations. They do not replace the human-selected target for presentation.

## Activity ownership

`start_activity()` creates an opaque activity ID and sends it with a cell or
selection address. The returned `ActivityHandle` is a JSON-safe string.

Activity remains until:

- The matching owner stops it.
- Its optional duration ends.
- Later activity replaces it.
- Reveal replaces it.
- The browser view tears down.

`stop_activity()` includes only the activity ID. A delayed stop for an older
handle cannot clear newer presentation. Transport failure during stop is
best-effort and leaves Python selection state unchanged.

## Reveal and resolve

Reveal is transient. Resolve is a durable change to the current in-memory Lens
aggregate.

The normal completion sequence is:

1. Verify the requested result against fresh notebook and browser evidence.
2. Stop the matching activity handle.
3. Reveal the stored selection or graph cell for a caller-supplied duration.
4. Allow the reveal hold to finish.
5. Reconnect, read the current revision, and resolve the verified selection IDs.
6. Let each owning document's resolution receipt become its final browser
   acknowledgement.

The browser queues a resolution receipt behind an active reveal. Python commits
resolve before sending the event. Each document filters the event to History
entries whose targets it owns. Receipt delivery failure cannot roll back the
committed state.

## Image handoff

`context.images` supplies annotated capture-time selection images.
`cell_image()` supplies a current unannotated canonical output image across
kernel calls. Read [Context and evidence](context-and-evidence.md#cell-output-images)
for the distinct lifecycles.

An integration can write PNG bytes to a private temporary file when its image
reader requires a path. It must delete the file after inspection. The kernel
and image reader must share a filesystem.

## Failure and recovery

| Error code                            | Owner and recovery                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `lens_unavailable`                    | Retry once without a saved identity. Add a default Lens cell when no host-authored Lens is required.                  |
| `lens_ambiguous`                      | Reconnect with a saved identity or leave one intended Lens instance.                                                  |
| `revision_conflict`                   | Stop saved activity, reconnect, read fresh context, and reassess the request.                                         |
| `selection_not_found`                 | Read current Open selections before another selection-scoped operation.                                               |
| `cell_not_found`                      | Use an exact cell from the active graph.                                                                              |
| `runtime_unavailable`                 | Keep the selection Open and report that notebook verification is unavailable.                                         |
| `browser_unavailable`                 | Wait for a displayed Lens view or restore the owning browser document.                                                |
| `capture_busy`                        | Finish the pending cell-output capture before requesting another cell.                                                |
| `capture_timeout` or `capture_failed` | Continue from text and graph evidence when sufficient, or keep the selection open if visual verification is required. |
| `lens_closed`                         | Discard the handle and reconnect to another live Lens if one exists.                                                  |

Keep ambiguous, blocked, and unverified selections open. Resolution records a
History entry and releases the selection image.

## Source map

| Concern                                  | Source                                                    |
| ---------------------------------------- | --------------------------------------------------------- |
| Agent adapter, identity, and connection  | `packages/marimo-lens/src/marimo_lens/agent.py`           |
| Mounted runtime registry                 | `packages/marimo-lens/src/marimo_lens/_registry.py`       |
| Runtime scope                            | `packages/marimo-lens/src/marimo_lens/_marimo_runtime.py` |
| Public activity owner type               | `packages/marimo-lens/src/marimo_lens/activity.py`        |
| Public errors                            | `packages/marimo-lens/src/marimo_lens/errors.py`          |
| Cell-output capture slot                 | `packages/marimo-lens/src/marimo_lens/_output_capture.py` |
| Capability entry point and build backend | `packages/marimo-lens/pyproject.toml`                     |
| Agent Plugin manifest                    | `plugin.json`                                             |
| Agent policy                             | `skills/marimo-lens/SKILL.md`                             |
| Cross-call recipes                       | `skills/marimo-lens/reference/workflow.md`                |
