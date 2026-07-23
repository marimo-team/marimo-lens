# Documentation

Run the VitePress site with hot reload:

```sh
make docs-serve
```

## Add marimo cells

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

All marimo fences on one page share a reactive graph. Use `output=false` for
setup cells that should run without rendering an output.

Declare Python dependencies once on the same page:

````md
```marimo-config
dependencies = ["numpy"]
```
````

The VitePress plugin compiles the page during the Vite build. `MarimoCell`
mounts each visible result in the browser and follows the VitePress color mode.
