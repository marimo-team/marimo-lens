# Maintainer documentation

Use these pages to change `marimo-lens` without crossing its state, runtime,
browser, protocol, or distribution boundaries. The public documentation in
[`docs/`](../docs/) explains the product to people who use Lens. This directory
explains how the implementation fits together and how maintainers change it.

Start with [Architecture](architecture.md). It defines the shared mental model,
the five ownership rules, and the vocabulary used by every other maintainer
page.

## Choose a route

| Task                                                           | Read first                                          | Continue with                                       |
| -------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Set up the repository and run Lens                             | [Development](development.md)                       | [Testing](testing.md)                               |
| Change targets, selections, revisions, or History              | [Selection state](selection-state.md)               | [Protocol](protocol.md)                             |
| Change graph context, controls, text, or images                | [Context and evidence](context-and-evidence.md)     | [Testing](testing.md)                               |
| Change output discovery, DOM targets, iframes, or shadow roots | [Browser and host](browser-and-host.md)             | [Context and evidence](context-and-evidence.md)     |
| Change agent connection or feedback                            | [Agent integration](agent-integration.md)           | [Protocol](protocol.md)                             |
| Change browser messages or synchronized state                  | [Protocol](protocol.md)                             | [Selection state](selection-state.md)               |
| Change bundling, Hatch, or packaged resources                  | [Build and distribution](build-and-distribution.md) | [Testing](testing.md)                               |
| Change public or internal documentation                        | [Documentation](documentation.md)                   | [Development](development.md)                       |
| Add or update a dependency                                     | [Dependencies](dependencies.md)                     | [Testing](testing.md)                               |
| Prepare and publish a version                                  | [Release](release.md)                               | [Build and distribution](build-and-distribution.md) |

## Contract owners

| Contract                                | Canonical owner                                                 |
| --------------------------------------- | --------------------------------------------------------------- |
| Public Python methods and agent adapter | [`docs/api.md`](../docs/api.md)                                 |
| Public context shapes                   | [`docs/reference/context.md`](../docs/reference/context.md)     |
| Public errors and limits                | [`docs/reference/errors.md`](../docs/reference/errors.md)       |
| Public product model                    | [`docs/overview.md`](../docs/overview.md)                       |
| Public selection behavior               | [`docs/selections.md`](../docs/selections.md)                   |
| Public agent workflow                   | [`docs/agents.md`](../docs/agents.md)                           |
| Internal ownership and vocabulary       | [Architecture](architecture.md)                                 |
| Selection aggregate and transitions     | [Selection state](selection-state.md)                           |
| Browser transport and schema evolution  | [Protocol](protocol.md)                                         |
| Contributor commands and local loop     | [Development](development.md)                                   |
| Distribution artifacts                  | [Build and distribution](build-and-distribution.md)             |
| Release procedure                       | [Release](release.md)                                           |
| Executable agent workflow policy        | [`skills/marimo-lens/SKILL.md`](../skills/marimo-lens/SKILL.md) |

Source schemas and constants remain the exact authority for wire fields and
numeric limits. Maintainer pages explain why those contracts exist, how the
parts interact, and which evidence a change requires.

## Pages

- [Architecture](architecture.md) introduces the complete system.
- [Selection state](selection-state.md) defines targets, selections, revisions,
  image state, resolve, reopen, and History.
- [Context and evidence](context-and-evidence.md) explains runtime reads,
  provenance, controls, references, text, and image bytes.
- [Browser and host](browser-and-host.md) explains notebook output discovery,
  configured DOM roots, document ownership, capture, and presentation.
- [Agent integration](agent-integration.md) explains code mode, discovery,
  identity, feedback, and the packaged Agent Skill.
- [Protocol](protocol.md) defines the private AnyWidget channel, synchronized
  traits, revisions, buffers, timeouts, and change procedure.
- [Build and distribution](build-and-distribution.md) traces TypeScript source
  into Python archives and installed Agent Plugin resources.
- [Development](development.md) provides setup, first success, watch mode, and
  the normal contributor loop.
- [Testing](testing.md) maps changes to evidence and explains the CI boundaries.
- [Documentation](documentation.md) covers VitePress, interactive marimo cells,
  navigation, generated text views, and browser validation.
- [Dependencies](dependencies.md) covers workspace policy, age gates, patches,
  lockfiles, and update checks.
- [Release](release.md) provides the version, tag, publish, verification, and
  recovery runbook.
