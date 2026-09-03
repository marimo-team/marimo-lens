# Documentation

Public documentation lives in `docs/`. The
[VitePress](https://vitepress.dev/) application in `apps/docs/`
turns those pages, interactive marimo cells, and public assets into the site
published through GitHub Pages.

Maintainer documentation lives in `development_docs/`. It is read directly from
the repository and is not part of the VitePress navigation.

## Documentation boundaries

| Surface          | Reader and job                                                                  | Owner                            |
| ---------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| Root README      | Evaluate the product, see proof, reach setup or contribution paths.             | `README.md`                      |
| Package README   | Install from a package registry, reach first use, inspect the public inventory. | `packages/marimo-lens/README.md` |
| Public site      | Learn concepts, complete tasks, integrate an agent, and look up the Python API. | `docs/`                          |
| Maintainer pages | Understand ownership, change source, test, package, and release.                | `development_docs/`              |
| Agent Skill      | Execute the Lens-specific agent workflow.                                       | `skills/marimo-lens/`            |

The public [Python API](../docs/api.md) owns method and agent-adapter contracts.
[`LensContext` reference](../docs/reference/context.md) owns returned context
shapes. [Errors and limits](../docs/reference/errors.md) owns recovery and
resource bounds. README API sections remain concise and route to these pages.

## Public information architecture

The current site routes readers through:

- `docs/index.md`: landing page and interactive product proof.
- `docs/overview.md`: product model and rationale.
- `docs/why-lens.md`: visual grounding, computational grounding, role
  allocation, and the human review loop.
- `docs/getting-started.md`: installation and first working selection.
- `docs/how-lens-works.md`: end-to-end collaboration loop and interactive API proof.
- `docs/concepts/`: targets, context and evidence, feedback, and History.
- `docs/selections.md`: point and region interaction, notes, images, Open, and History.
- `docs/agents.md`: code-mode and Agent Skill workflow.
- `docs/data-and-trust.md`: data exposure, redaction, lifetime, and transfer boundaries.
- `docs/compatibility.md`: Python, marimo, browser, agent-host, and release-channel contracts.
- `docs/troubleshooting.md`: symptom-oriented recovery.
- `docs/api.md`: exact Python methods and agent-adapter contracts.
- `docs/reference/context.md`: exact `LensContext` and reference shapes.
- `docs/reference/errors.md`: errors, recovery actions, and resource limits.

`apps/docs/.vitepress/config.mts` owns top navigation, sidebar navigation,
search, metadata, base path, edit links, theme registration, and build plugins.
Add every public guide or reference page to intentional navigation. The landing
page remains reachable at the site root.

## Write a public page

Choose one reader job before adding a page:

- Orientation and fit belong on the landing page or overview.
- First success belongs in getting started.
- A known task belongs in a guide.
- A durable object or state transition belongs in a concept page.
- Exact signatures, shapes, defaults, errors, and limits belong in reference.
- Failure evidence and repair belong next to the affected task or in a focused
  troubleshooting section.

Start with the object or outcome. Put the smallest representative action early.
Define each Lens term at first use and then use its canonical name. Link an
external tool or format to its authoritative documentation when its role is not
already established for the reader.

Keep the static explanation complete. Interactive examples let readers inspect
or vary the contract, but they do not replace the authored path.

## Interactive marimo cells

The
[`@marimo-team/mdx-marimo`](https://github.com/marimo-team/mdx-marimo)
VitePress plugin compiles marimo cells embedded in Markdown. Write visible and
setup cells with fenced blocks:

````md
```python marimo output=false
import marimo as mo
```

```python marimo
count = mo.ui.slider(1, 10, value=3, label="Count")
count
```

```python marimo
mo.md(f"The count is **{count.value}**.")
```
````

All marimo fences on one page share one reactive graph. Use `output=false` for
setup cells that should execute without rendering output. Keep cells focused so
the graph and visible page order stay understandable.

Declare page dependencies once:

````md
```marimo-config
requires-python = ">=3.10,<3.15"
dependencies = [
    "marimo",
    "marimo-lens",
]
```
````

The compiler uses uv from the repository root. A dependency or package-source
change can therefore affect docs compilation even when Markdown is unchanged.

The plugin emits one `marimo-mdx-island` for each visible result. The theme entry
in `apps/docs/.vitepress/theme/index.ts` registers the element and its styles.
`custom.css` maps VitePress tokens into island variables and owns documentation
presentation.

## Interactive example contract

An interactive example should include:

1. A static sentence naming the behavior.
2. Concrete initial data or state.
3. Labeled controls or actions.
4. A visible result that changes for the documented reason.
5. A nearby explanation of what the state demonstrates.
6. A static summary that preserves the meaning in source and generated Markdown
   views.

Use one page-level graph for related steps. Avoid hidden dependencies on cells
from another page or an unstated local file. Keep demonstration variables
private when they should not become public notebook definitions.

The docs examples consume the locally built Python browser resources. `make
docs` and `make docs-serve` build `@marimo-lens/python` before VitePress.

## Assets and theme

Public site assets live in `apps/docs/public/`. Reference them with base-path-safe
URLs because GitHub Pages publishes the site under a repository path.

Brand and video source files belong in the public directory. Generated copies in
`apps/docs/.vitepress/dist/` are build output. Theme code and fonts live in
`apps/docs/.vitepress/theme/`.

Use the established Lens and marimo visual tokens. Preserve readable contrast,
keyboard focus, narrow-layout behavior, reduced motion, and alternative text.
Interactive affordances must remain understandable without hover.

## Build channels

Serve with live reload:

```sh
make docs-serve
```

This target removes `BASE_PATH` from the process so local development uses `/`.

Build the default site:

```sh
make docs
```

Build with a repository-style base path when checking deployment links:

```sh
BASE_PATH=marimo-lens make docs
```

Preview an existing build with:

```sh
pnpm docs:preview
```

The VitePress output directory is `apps/docs/.vitepress/dist/`.

## Generated text views

`vitepress-plugin-llms` creates agent-readable delivery alongside HTML:

- `llms.txt`
- `llms-full.txt`
- One generated Markdown view per public page
- `hashmap.json` used by the text-view build

Treat these files as delivery artifacts. Edit `docs/` and rebuild. A page change
must remain coherent in rendered HTML, generated Markdown, and the combined
text views.

Wrap browser-only demo plumbing in `<llm-exclude>`. Add a concise
`<llm-only>` description when the generated page would otherwise lose the
example's action, result, or conclusion. The theme renders `llm-exclude` with
`display: contents` and hides `llm-only` from browser readers. Keep page-level
`marimo-config` inside the exclusion boundary because it configures the docs
compiler, not Lens.

## Base-path publishing

`BASE_PATH` reaches `apps/docs/.vitepress/config.mts`. The config normalizes it
and sets the VitePress base. GitHub Pages obtains the deployment base from
`actions/configure-pages` and passes it to `make docs`.

The Pages workflow currently verifies selected HTML routes and relative asset
links. New routes, navigation changes, and custom assets need direct rendered
inspection in addition to the workflow check.

## Validate the site

For every public-doc change:

1. Run `make docs`.
2. Confirm every changed page and expected generated Markdown view exists in
   `apps/docs/.vitepress/dist/`.
3. Check relative links and heading fragments from the authored Markdown.
4. Check navigation, sidebar labels, edit links, and local search.
5. Inspect the affected route in a browser at desktop and narrow widths.
6. Inspect light and dark themes.
7. Exercise interactive examples and confirm their visible state transitions.
8. Check keyboard focus, alternative text, reduced motion, and browser console
   errors.
9. Inspect `llms.txt`, `llms-full.txt`, and the generated page Markdown for a
   coherent static explanation.
10. Build once with a nonempty `BASE_PATH` after route or asset changes.
11. Run `pnpm check` and `git diff --check`.

For internal-page changes:

1. Read the complete changed route from `development_docs/README.md`.
2. Check every relative file link and heading fragment.
3. Confirm source paths, commands, and ownership claims against the current
   repository.
4. Run the project prose checker when one is available in the contributor
   environment.
5. Run `pnpm check` because the root check includes `development_docs/`.

## Update documentation after source changes

| Source change                                | Documentation companion                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Public Python method or agent adapter        | `docs/api.md`, package README inventory when affected, examples and tests              |
| Public context type or returned field        | `docs/reference/context.md`, examples and context tests                                |
| Public error, recovery action, or limit      | `docs/reference/errors.md`, troubleshooting, boundary tests                            |
| Selection behavior                           | `docs/selections.md`, relevant interactive example, selection-state maintainer page    |
| Agent workflow or capability                 | `docs/agents.md`, Agent Skill, package README route, agent-integration maintainer page |
| Product mental model                         | `docs/overview.md`, landing proof, root and package README summaries                   |
| Browser or host compatibility                | Public caveat beside first affected use, browser-and-host maintainer page              |
| Build, test, dependency, or release workflow | Owning maintainer page and concise repository entry route                              |

Avoid copying a complete contract into several entry points. Keep a concise
summary and link to its canonical owner.
