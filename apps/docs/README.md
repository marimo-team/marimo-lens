# Documentation application

This package builds the public `marimo-lens` site from `docs/` with
[VitePress](https://vitepress.dev/). Read the
[documentation maintainer guide](../../development_docs/documentation.md) for
page ownership, navigation, generated text views, base-path publishing, and the
browser validation checklist.

## Run the site

Serve with hot reload from the repository root:

```sh
make docs-serve
```

Build the static site:

```sh
make docs
```

Both targets build the local `marimo-lens` browser resources before VitePress.
Generated output appears in `.vitepress/dist/`.

## Add interactive marimo cells

Write marimo cells directly in a Markdown page:

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

All marimo fences on one page share a reactive graph. Use `output=false` for a
setup cell that should execute without rendering output.

Declare Python requirements once on the same page:

````md
```marimo-config
requires-python = ">=3.10,<3.15"
dependencies = [
    "marimo",
    "marimo-lens",
]
```
````

`marimoVitePress()` compiles the page during the Vite build and emits one
`marimo-mdx-island` for each visible result. The theme entry registers the
custom element and maps VitePress color tokens into its islands.

Keep the page understandable as static Markdown. State the example's initial
state, action, visible result, and conclusion in prose around the interactive
cells.

Wrap browser-only cells in `<llm-exclude>`. Add `<llm-only>` prose when the
generated Markdown needs a static account of the example. Exclude the
page-level `marimo-config` block from generated text.

## Package ownership

- `.vitepress/config.mts` owns VitePress navigation, search, metadata, base
  path, build plugins, public directory, and edit links.
- `.vitepress/theme/` owns VitePress and marimo island presentation.
- `public/` owns copied brand, video, and other public assets.
- `../../docs/` owns authored public pages.
- `.vitepress/dist/` contains generated HTML, assets, Markdown views,
  `llms.txt`, and `llms-full.txt`.

Validate a changed page in HTML and generated text views. Exercise interactive
examples in a browser at desktop and narrow widths, then check light and dark
themes, keyboard focus, reduced motion, links, search, and console errors.
