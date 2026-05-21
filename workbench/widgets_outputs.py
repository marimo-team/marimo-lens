import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _(pl, vega_data):
    widget_barley = (
        pl.read_json(vega_data.barley.filepath)
        .rename({"yield": "yield_amount"})
        .with_columns(pl.col("year").cast(pl.Utf8).alias("year_label"))
    )
    return (widget_barley,)


@app.cell(hide_code=True)
def _(pl, widget_barley):
    widget_segments = (
        widget_barley.group_by("variety")
        .agg(pl.col("yield_amount").sum().round(1).alias("yield_amount"))
        .sort("yield_amount", descending=True)
        .head(4)
    )
    widget_sites = widget_barley["site"].unique().sort().to_list()
    widget_varieties = widget_barley["variety"].unique().sort().to_list()
    return widget_segments, widget_sites, widget_varieties


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Site dropdown control
    """)
    return


@app.cell
def _(mo, widget_sites):
    site_dropdown = mo.ui.dropdown(widget_sites, value=widget_sites[0], label="Site")
    site_dropdown
    return (site_dropdown,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Variety multiselect control
    """)
    return


@app.cell
def _(mo, widget_varieties):
    variety_multiselect = mo.ui.multiselect(
        widget_varieties,
        value=widget_varieties[:2],
        label="Varieties",
    )
    variety_multiselect
    return (variety_multiselect,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Yield slider control
    """)
    return


@app.cell
def _(mo):
    yield_slider = mo.ui.slider(0, 70, value=30, show_value=True, label="Yield")
    yield_slider
    return (yield_slider,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Yield range slider control
    """)
    return


@app.cell
def _(mo):
    yield_range = mo.ui.range_slider(
        0,
        70,
        value=[20, 50],
        show_value=True,
        label="Yield range",
    )
    yield_range
    return (yield_range,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Target yield number control
    """)
    return


@app.cell
def _(mo):
    target_yield = mo.ui.number(0, 70, step=0.5, value=32, label="Target yield")
    target_yield
    return (target_yield,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Include yield checkbox control
    """)
    return


@app.cell
def _(mo):
    include_yield = mo.ui.checkbox(value=True, label="Include yield")
    include_yield
    return (include_yield,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Active switch control
    """)
    return


@app.cell
def _(mo):
    active_switch = mo.ui.switch(value=True, label="Active")
    active_switch
    return (active_switch,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Priority radio control
    """)
    return


@app.cell
def _(mo):
    priority_radio = mo.ui.radio(
        ["low", "medium", "high"],
        value="medium",
        label="Priority",
    )
    priority_radio
    return (priority_radio,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Note text control
    """)
    return


@app.cell
def _(mo):
    note_text = mo.ui.text(value="Review high-yield barley sites", label="Note")
    note_text
    return (note_text,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Long note text area control
    """)
    return


@app.cell
def _(mo):
    note_area = mo.ui.text_area(
        value="Rows above the yield threshold should stay visible.",
        label="Long note",
    )
    note_area
    return (note_area,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Review date control
    """)
    return


@app.cell
def _(dt, mo):
    review_date = mo.ui.date(value=dt.date(2026, 5, 21), label="Review date")
    review_date
    return (review_date,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Review datetime control
    """)
    return


@app.cell
def _(dt, mo):
    review_datetime = mo.ui.datetime(
        value=dt.datetime(2026, 5, 21, 9, 30),
        label="Review time",
    )
    review_datetime
    return (review_datetime,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Refresh variety button control
    """)
    return


@app.cell
def _(mo):
    refresh_button = mo.ui.button(label="Refresh variety")
    refresh_button
    return (refresh_button,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Navigation menu layout widget
    """)
    return


@app.cell
def _(mo):
    layout_nav = mo.nav_menu(
        {
            "#controls": "Controls",
            "#widgets": "Widgets",
            "#outputs": "Outputs",
        }
    )
    layout_nav
    return (layout_nav,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Tabs layout widget
    """)
    return


@app.cell
def _(mo):
    layout_tabs = mo.ui.tabs(
        {
            "Summary": mo.md("Barley review targets"),
            "Data": mo.md("Tables, controls, and output surfaces"),
            "Decision": mo.callout(
                "Keep the edit boundary around the selected output.",
                kind="info",
            ),
        }
    )
    layout_tabs
    return (layout_tabs,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Accordion layout widget
    """)
    return


@app.cell
def _(mo):
    layout_accordion = mo.accordion(
        {
            "Selection notes": mo.md(
                "Column, chart, widget, and document evidence should stay distinct."
            ),
            "Agent boundary": mo.md(
                "Prefer target cells and direct refs over broad notebook edits."
            ),
        },
        multiple=True,
    )
    layout_accordion
    return (layout_accordion,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Carousel layout widget
    """)
    return


@app.cell
def _(mo, widget_segments):
    layout_carousel = mo.carousel(
        [
            mo.stat(
                f"{_row['yield_amount']:.1f}",
                label=_row["variety"],
                caption="total yield",
                bordered=True,
            )
            for _row in widget_segments.head(3).iter_rows(named=True)
        ]
    )
    layout_carousel
    return (layout_carousel,)


@app.cell(hide_code=True)
def _(widget_segments):
    nested_shadow_rows = [
        {
            "segment": _row["variety"],
            "yield_amount": _row["yield_amount"],
            "status": "watch" if _index == 0 else "ok",
        }
        for _index, _row in enumerate(widget_segments.iter_rows(named=True))
    ]
    return (nested_shadow_rows,)


@app.cell(hide_code=True)
def _(anywidget, traitlets):
    class NestedShadowWidget(anywidget.AnyWidget):
        _esm = """
        function render({ model, el }) {
          const root = el.attachShadow({ mode: "open" });
          const rows = model.get("rows");
          root.innerHTML = `
            <style>
              :host { display: block; font: 13px system-ui; color: CanvasText; }
              table { border-collapse: collapse; min-width: 520px; }
              th, td { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding: 6px 8px; text-align: left; }
              .toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
            </style>
            <div class="toolbar">
              <button type="button" data-column="segment">Variety action</button>
              <label><input type="checkbox" checked /> Include active</label>
            </div>
            <table role="grid" aria-label="${model.get("title")}">
              <thead><tr><th>Variety</th><th>Yield</th><th>Status</th></tr></thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td data-column="segment">${row.segment}</td>
                    <td data-column="yield_amount">${row.yield_amount}</td>
                    <td data-column="status">${row.status}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          `;
        }
        export default { render };
        """
        title = traitlets.Unicode("Nested shadow barley grid").tag(sync=True)
        rows = traitlets.List([]).tag(sync=True)
        columns = traitlets.List(
            [
                {"name": "segment", "dtype": "str"},
                {"name": "yield_amount", "dtype": "float"},
                {"name": "status", "dtype": "str"},
            ]
        ).tag(sync=True)

    return (NestedShadowWidget,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Raw nested shadow anywidget
    """)
    return


@app.cell
def _(NestedShadowWidget, nested_shadow_rows):
    raw_shadow_widget = NestedShadowWidget(rows=nested_shadow_rows)
    raw_shadow_widget
    return (raw_shadow_widget,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Wrapped nested shadow anywidget
    """)
    return


@app.cell
def _(NestedShadowWidget, mo, nested_shadow_rows):
    wrapped_shadow_widget = mo.ui.anywidget(NestedShadowWidget(rows=nested_shadow_rows))
    wrapped_shadow_widget
    return (wrapped_shadow_widget,)


@app.cell(hide_code=True)
def _(json):
    class JsonBundle:
        def __init__(self, payload):
            self.payload = payload

        def _repr_json_(self):
            return json.dumps(self.payload)

    class DiagnosticBundle:
        def _repr_mimebundle_(self):
            return {
                "application/vnd.marimo+error": {
                    "type": "StressDiagnostic",
                    "message": "diagnostic output fixture",
                }
            }

    return DiagnosticBundle, JsonBundle


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Generic semantic SVG chart output
    """)
    return


@app.cell
def _(mo, widget_segments):
    _segments = list(widget_segments.head(3).iter_rows(named=True))
    _max_yield = max(_row["yield_amount"] for _row in _segments)
    _colors = ["#2a9d8f", "#457b9d", "#e9c46a"]
    _bars = []
    _points = []
    _labels = []
    _legend = []
    for _index, _row in enumerate(_segments):
        _height = int(170 * _row["yield_amount"] / _max_yield)
        _x = 34 + _index * 124
        _y = 190 - _height
        _color = _colors[_index]
        _variety = _row["variety"]
        _yield = _row["yield_amount"]
        _bars.append(
            f'<rect class="mark bar" data-variety="{_variety}" data-yield="{_yield}" x="{_x}" y="{_y}" width="42" height="{_height}" fill="{_color}" />'
        )
        _points.append(
            f'<circle class="annotation point" data-yield="{_yield}" cx="{_x + 21}" cy="{max(_y - 12, 8)}" r="5" fill="#1d3557" />'
        )
        _labels.append(f'<text x="{_x + 21}" y="218">{_variety}</text>')
        _legend_y = _index * 24
        _legend.append(
            f'<rect y="{_legend_y}" width="11" height="11" fill="{_color}" /><text x="18" y="{_legend_y + 10}">{_variety}</text>'
        )
    generic_svg_scene = mo.Html(
        f"""
        <svg role="img" aria-label="Semantic SVG barley coverage chart" viewBox="0 0 640 300" width="100%" height="300">
          <text class="chart-title" x="40" y="28" font-size="16" font-weight="700">Yield by barley variety</text>
          <g class="plot-area" transform="translate(64,44)" data-role="plot-area">
            <line class="axis axis-x" x1="0" y1="190" x2="390" y2="190" stroke="currentColor" stroke-opacity="0.35" />
            <line class="axis axis-y" x1="0" y1="0" x2="0" y2="190" stroke="currentColor" stroke-opacity="0.35" />
            <g class="ticks x-axis">{"".join(_labels)}</g>
            <g class="ticks y-axis">
              <text x="-34" y="190">0</text>
              <text x="-42" y="104">300</text>
              <text x="-42" y="20">600</text>
            </g>
            {"".join(_bars)}
            {"".join(_points)}
          </g>
          <g class="legend" transform="translate(500,78)">
            {"".join(_legend)}
          </g>
        </svg>
        """
    )
    generic_svg_scene
    return (generic_svg_scene,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Image media output
    """)
    return


@app.cell
def _(mo):
    image_output = mo.Html(
        """
        <figure data-marimo-media>
          <img alt="Barley thumbnail" width="360" height="120"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 120'%3E%3Crect width='360' height='120' fill='%23f7fafc'/%3E%3Ccircle cx='70' cy='60' r='34' fill='%232a9d8f'/%3E%3Crect x='128' y='34' width='160' height='18' rx='4' fill='%23457b9d'/%3E%3Crect x='128' y='68' width='112' height='18' rx='4' fill='%23e9c46a'/%3E%3C/svg%3E" />
        </figure>
        """
    )
    image_output
    return (image_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Audio media output
    """)
    return


@app.cell
def _(mo):
    audio_output = mo.Html(
        """
        <audio controls aria-label="Silent audio fixture">
          <source src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=" type="audio/wav" />
        </audio>
        """
    )
    audio_output
    return (audio_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Video media output
    """)
    return


@app.cell
def _(mo):
    video_output = mo.Html(
        """
        <video controls width="320" height="140" aria-label="Video fixture">
          <source src="data:video/mp4;base64," type="video/mp4" />
        </video>
        """
    )
    video_output
    return (video_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Inline document output
    """)
    return


@app.cell
def _(mo):
    document_output = mo.Html(
        """
        <iframe
          data-marimo-document
          title="Inline coverage document"
          srcdoc="<section><h2>Review packet</h2><p>Document targets should select the iframe surface.</p></section>"
          style="width: 100%; height: 180px; border: 1px solid currentColor; border-radius: 6px;"
        ></iframe>
        """
    )
    document_output
    return (document_output,)


@app.cell(hide_code=True)
def _(widget_segments):
    data_payload = widget_segments.head(1).to_dicts()[0]
    return (data_payload,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## JSON data output
    """)
    return


@app.cell
def _(data_payload, mo):
    json_output = mo.json(data_payload)
    json_output
    return (json_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## JSON repr bundle output
    """)
    return


@app.cell
def _(JsonBundle, data_payload):
    json_bundle_output = JsonBundle(data_payload)
    json_bundle_output
    return (json_bundle_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Diagnostic mimebundle output
    """)
    return


@app.cell
def _(DiagnosticBundle):
    diagnostic_output = DiagnosticBundle()
    diagnostic_output
    return (diagnostic_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Markdown document output
    """)
    return


@app.cell
def _(mo):
    markdown_output = mo.md(
        "Markdown document output for selector and document surfaces."
    )
    markdown_output
    return (markdown_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Lens widget
    """)
    return


@app.cell
def _(Lens, mo):
    lens = mo.ui.anywidget(Lens())
    lens
    return (lens,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Pair feedback JSON
    """)
    return


@app.cell
def _(mo):
    show_pair_feedback_json = mo.ui.checkbox(
        value=False,
        label="Show pair feedback JSON",
    )
    show_pair_feedback_json
    return (show_pair_feedback_json,)


@app.cell
def _(lens, mo, show_pair_feedback_json):
    widgets_pair_feedback = (
        mo.json(lens.pair_feedback)
        if show_pair_feedback_json.value
        else mo.md("_Pair feedback JSON hidden by default._")
    )
    widgets_pair_feedback
    return (widgets_pair_feedback,)


@app.cell(hide_code=True)
def _():
    import datetime as dt
    import json

    import anywidget
    import marimo as mo
    import polars as pl
    import traitlets
    from vega_datasets import data as vega_data

    from marimo_lens import Lens

    return Lens, anywidget, dt, json, mo, pl, traitlets, vega_data


if __name__ == "__main__":
    app.run()
