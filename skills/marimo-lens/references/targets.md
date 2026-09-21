# Author selectable output regions

## Preserve meaning when co-creating outputs

When creating or revising HTML or anywidgets with the user, attach Lens metadata
to meaningful regions such as a chart, metric, or comparison panel. Encode what
each region represents, its units or grouping, and where it is produced. These
short descriptions carry the authored structure into later feedback and edits.

| Attribute                                               | Meaning                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `data-marimo-lens-label`                                | Human-readable name, up to 256 UTF-16 units.                                                             |
| `data-marimo-lens-detail`                               | Context accompanying the name, such as measure, units, grouping, or filter, up to 512 UTF-16 units.      |
| `data-marimo-lens-render-source`                        | JSON with a real project `path` and optional `symbol`, `line`, and `column` locating the rendering code. |
| `data-marimo-lens-context`                              | Preferred image-context container for a configured DOM target.                                           |
| `data-marimo-lens-cell-id`, `data-marimo-lens-selector` | A resolved producing cell ID and optional symbolic value selector. Lens does not execute the selector.   |
| `data-marimo-lens-inputs`                               | Space-separated IDs of source elements declaring the region's complete notebook inputs.                  |

For example, render this through `mo.Html` or an anywidget's renderer, replacing
the rendering reference with the actual file and symbol:

```html
<section
  id="regional-revenue"
  data-marimo-lens-label="Revenue by region"
  data-marimo-lens-detail="Monthly totals · USD · grouped by region"
  data-marimo-lens-render-source='{"path":"widgets/revenue.js","symbol":"render"}'
  data-marimo-lens-context
>
  <h3>Revenue by region</h3>
  <!-- Render the comparison here. -->
</section>
```

Labels inside ordinary notebook output can describe the whole output. To make
this region independently selectable, include `#regional-revenue` in the mounted
Lens's `dom_selector` and keep its ID unique and stable across renders. For an
anywidget, put these attributes on a light-DOM wrapper. Rendering references
must be on the selected root, even when its content lives in a shadow tree.

Use the host's resolved cell IDs and source records for notebook provenance.
Native notebook targets already identify their producing cell. Custom labels
and file references do not establish notebook inputs. Omit unresolved source
attributes, since invalid input references make a configured target unavailable.

Check the target indicator and a new selection's `description` after rendering.
Lens captures the label, detail, and rendering reference at selection time and
retains them through History and reopen. Updating metadata affects future
selections. See the [custom targets guide](https://marimo-team.github.io/marimo-lens/custom-targets)
for interactive examples and the complete host contract.
