---
title: Errors and limits
description: Lens error codes, recovery actions, argument failures, resource bounds, and History eviction.
---

# Errors and limits

Expected operation failures raise `LensError`. Its `code` attribute is stable
for programmatic recovery, and the error text starts with the same code. Its
`revision` attribute contains the current selection-state revision when a Lens
instance was available.

Invalid Python argument types raise `TypeError`. Invalid values and bounds
raise `ValueError` before an operation begins. Agent Plugin discovery can raise
`agent_plugins.AgentPluginError` when the installed resource bundle is missing
or malformed.

## `LensError` codes

| Code                      | Cause                                                       | Recovery                                                                      |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `lens_unavailable`        | No live Lens matches the requested identity.                | Retry `connect()` without identity, then mount Lens when none is available.   |
| `lens_ambiguous`          | Several candidates exist with no unique browser-ready Lens. | Inspect `discover()` handles and reconnect with the intended identity.        |
| `lens_closed`             | The owning Lens instance closed.                            | Mount and connect to a new Lens.                                              |
| `revision_conflict`       | Selection state changed after the caller captured context.  | Stop owned activity, read a fresh context, and reassess the work.             |
| `selection_not_found`     | A referenced selection is no longer Open.                   | Read current selections and keep unrelated work unchanged.                    |
| `selection_context_limit` | A mutation cannot fit required state or reference bounds.   | Shorten notes, reduce Open selections, or clear old History before retrying.  |
| `runtime_unavailable`     | Lens cannot inspect the active marimo runtime.              | Keep selections Open and restore live-kernel access.                          |
| `cell_not_found`          | The current graph has no requested cell ID.                 | Read fresh graph state and choose a current graph member.                     |
| `browser_unavailable`     | No displayed Lens view can perform cell-output capture.     | Render Lens in an active browser document and retry.                          |
| `capture_busy`            | The single capture slot is waiting for another cell.        | Poll the existing cell request before starting another.                       |
| `capture_timeout`         | Output capture did not finish before its deadline.          | Confirm the browser view remains active, then start a fresh capture.          |
| `output_unavailable`      | The cell has no stable rendered output to capture.          | Run the cell and wait for its output before retrying.                         |
| `capture_failed`          | Browser transport, rasterization, or PNG validation failed. | Inspect browser errors and use code, data, and text context for verification. |

Presentation methods validate their Python inputs and addresses before sending
events. Activity, reveal, and resolution-receipt delivery is best effort, so a
successful return does not prove that a browser completed the visual
presentation.

## Argument rules

- A `SelectionReference` passed to activity or reveal requires its captured
  `expected_revision`.
- A cell ID passed to activity or reveal can omit `expected_revision` and must
  identify a current graph member.
- `resolve()` requires at least one and at most 64 unique selection IDs.
- Optional labels, messages, and summaries trim edge whitespace. A
  whitespace-only value becomes `None`.
- `duration_ms` is an integer from 1 through 300,000, or `None` to hold until
  dismissal or replacement. Reveal durations apply to the entire sequence.
- `reveal()` accepts 1–16 steps. Each step supplies a `target` and optional
  `label` and `message`. Selection steps share one `expected_revision`.
- `dom_selector` must be nonblank valid Unicode. Browser selector parsing can
  still reject invalid CSS syntax after Lens mounts.

## Resource limits

| Resource                               | Limit                                          |
| -------------------------------------- | ---------------------------------------------- |
| Open selections                        | 64                                             |
| Selection note                         | 4,000 UTF-16 code units                        |
| Cell ID or selection ID                | 128 UTF-16 code units                          |
| Configured or exact DOM selector       | 1,024 UTF-16 code units                        |
| Producing cell IDs per DOM target      | 64                                             |
| Activity or reveal label               | 40 UTF-16 code units                           |
| Activity message or resolution summary | 240 UTF-16 code units                          |
| Reveal message                         | 1,000 UTF-16 code units                        |
| Timed activity or reveal               | 1 to 300,000 milliseconds                      |
| Selections per `resolve()` call        | 64 unique IDs                                  |
| Synchronized Open state                | 48,000 UTF-8 bytes                             |
| History                                | 64 entries and 64,000 UTF-8 bytes              |
| Compact references                     | 60,000 UTF-8 bytes                             |
| Standalone text                        | 64,000 characters                              |
| Retained cell source                   | 24,000 characters shared across relevant cells |
| Relevant runtime cells                 | 64                                             |
| Reported omitted cell IDs              | 16 plus the exact omitted count                |
| Controls in standalone text            | 16                                             |
| One PNG                                | 8 MiB, 2,048 pixels per edge, and 4 megapixels |
| Stored selection-image bytes per Lens  | 64 MiB                                         |

UTF-16 code units match the string-length model used by the browser protocol.
Most characters use one unit. Characters outside the Basic Multilingual Plane,
including many emoji, use two.

## How limits degrade or reject work

Lens preserves required identity and geometry before optional descriptive data.
Compact-reference fitting removes optional DOM hints and target descriptions
before shortening notes when needed. Standalone text budgets selections,
controls, cells, and limit notices independently.

Mutations that cannot preserve required selection identity and geometry raise
`selection_context_limit` before state changes. History follows a different
policy: it keeps the newest entries and evicts the oldest entries to remain
inside both its count and byte limits.

Selection and cell-output PNGs are resized during encoding to fit image bounds.
Capture fails when the browser cannot produce a valid bounded PNG.

Read [Troubleshooting](../troubleshooting) for symptom-based recovery and the
[LensContext reference](./context) for the public data shapes.
