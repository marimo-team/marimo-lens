import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _(pl, vega_data):
    barley = (
        pl.read_json(vega_data.barley.filepath)
        .rename({"yield": "yield_amount"})
        .with_columns(pl.col("year").cast(pl.Utf8).alias("year_label"))
    )
    return (barley,)


@app.cell(hide_code=True)
def _(barley, pl):
    barley_summary = (
        barley.group_by(["site", "year_label"])
        .agg(
            pl.col("yield_amount").sum().round(2).alias("yield_amount"),
            pl.col("yield_amount").mean().round(2).alias("mean_yield"),
        )
        .sort(["year_label", "yield_amount"], descending=[False, True])
    )
    return (barley_summary,)


@app.cell(hide_code=True)
def _(pl, vega_data):
    car_inventory = (
        pl.read_json(vega_data.cars.filepath)
        .drop_nulls(["Miles_per_Gallon", "Horsepower"])
        .select(
            "Name",
            "Origin",
            "Cylinders",
            "Miles_per_Gallon",
            "Horsepower",
        )
        .head(12)
    )
    return (car_inventory,)


@app.cell(hide_code=True)
def _(barley, mo):
    site_filter = mo.ui.dropdown(
        ["All", *barley["site"].unique().sort().to_list()],
        value="All",
        label="Site",
    )
    site_filter
    return (site_filter,)


@app.cell(hide_code=True)
def _(mo):
    yield_floor = mo.ui.slider(
        0,
        70,
        value=25,
        label="Yield floor",
        show_value=True,
    )
    yield_floor
    return (yield_floor,)


@app.cell(hide_code=True)
def _(mo):
    show_mean_yield = mo.ui.checkbox(value=True, label="Show mean yield")
    show_mean_yield
    return (show_mean_yield,)


@app.cell(hide_code=True)
def _(barley, site_filter, yield_floor):
    _site_rows = (
        barley
        if site_filter.value == "All"
        else barley.filter(barley["site"] == site_filter.value)
    )
    filtered_barley = _site_rows.filter(_site_rows["yield_amount"] >= yield_floor.value)
    filtered_barley
    return (filtered_barley,)


@app.cell(hide_code=True)
def _(car_inventory, mo):
    cars_table = mo.ui.table(car_inventory, label="Cars table", page_size=6)
    cars_table
    return (cars_table,)


@app.cell(hide_code=True)
def _(barley, mo):
    barley_dataframe = mo.ui.dataframe(barley, page_size=6)
    barley_dataframe
    return (barley_dataframe,)


@app.cell(hide_code=True)
def _(barley_summary, mo):
    summary_editor = mo.ui.data_editor(barley_summary, label="Editable barley summary")
    summary_editor
    return (summary_editor,)


@app.cell(hide_code=True)
def _(barley, mo):
    barley_explorer = mo.ui.data_explorer(
        barley,
        x="year",
        y="yield_amount",
        color="site",
    )
    barley_explorer
    return (barley_explorer,)


@app.cell(hide_code=True)
def _(alt, barley_summary, show_mean_yield):
    _tooltip = ["site", "year_label", "yield_amount"]
    if show_mean_yield.value:
        _tooltip.append("mean_yield")
    altair_chart = (
        alt.Chart(barley_summary)
        .mark_bar(cornerRadiusTopLeft=3, cornerRadiusTopRight=3)
        .encode(
            x=alt.X("year_label:N", title="Year"),
            y=alt.Y("yield_amount:Q", title="Barley yield"),
            color=alt.Color("site:N", title="Site"),
            tooltip=_tooltip,
        )
        .properties(height=260)
    )
    altair_chart
    return (altair_chart,)


@app.cell(hide_code=True)
def _(altair_chart, mo):
    altair_widget = mo.ui.altair_chart(altair_chart, label="Altair barley yield")
    altair_widget
    return (altair_widget,)


@app.cell(hide_code=True)
def _(barley_summary, px):
    plotly_figure = px.line(
        barley_summary,
        x="year_label",
        y="yield_amount",
        color="site",
        markers=True,
        title="Barley yield by year",
    )
    plotly_figure
    return (plotly_figure,)


@app.cell(hide_code=True)
def _(mo, plotly_figure):
    plotly_widget = mo.ui.plotly(plotly_figure, label="Plotly barley yield")
    plotly_widget
    return (plotly_widget,)


@app.cell(hide_code=True)
def _(barley_summary, mo, plt):
    _years = barley_summary["year_label"].unique().sort().to_list()
    _sites = barley_summary["site"].unique().sort().to_list()
    _values = {
        (_row["site"], _row["year_label"]): _row["yield_amount"]
        for _row in barley_summary.iter_rows(named=True)
    }
    matplotlib_figure, matplotlib_axes = plt.subplots(figsize=(5.5, 2.7))
    _width = 0.8 / len(_sites)
    _x = list(range(len(_years)))
    for _index, _site in enumerate(_sites):
        matplotlib_axes.bar(
            [_value + _index * _width for _value in _x],
            [_values.get((_site, _year), 0) for _year in _years],
            width=_width,
            label=_site,
        )
    matplotlib_axes.set_xticks(
        [_value + _width * (len(_sites) - 1) / 2 for _value in _x],
        _years,
    )
    matplotlib_axes.set_title("Matplotlib barley bars")
    matplotlib_axes.set_ylabel("Yield")
    matplotlib_axes.legend(loc="upper left", bbox_to_anchor=(1.02, 1))
    matplotlib_figure.tight_layout()
    matplotlib_widget = mo.ui.matplotlib(matplotlib_axes)
    matplotlib_widget
    return matplotlib_axes, matplotlib_figure, matplotlib_widget


@app.cell(hide_code=True)
def _(barley, pl):
    svg_segments = (
        barley.group_by("variety")
        .agg(pl.col("yield_amount").sum().round(1).alias("yield_amount"))
        .sort("yield_amount", descending=True)
        .head(3)
    )
    return (svg_segments,)


@app.cell(hide_code=True)
def _(mo, svg_segments):
    _rows = svg_segments.iter_rows(named=True)
    _max_yield = max(
        _row["yield_amount"] for _row in svg_segments.iter_rows(named=True)
    )
    _bars = []
    _labels = []
    _legend = []
    _colors = ["#17b8a6", "#5aa7ff", "#f4b84a"]
    for _index, _row in enumerate(_rows):
        _height = int(150 * _row["yield_amount"] / _max_yield)
        _x = 24 + _index * 102
        _y = 168 - _height
        _color = _colors[_index]
        _variety = _row["variety"]
        _yield = _row["yield_amount"]
        _bars.append(
            f'<rect class="mark bar" data-variety="{_variety}" data-yield="{_yield}" x="{_x}" y="{_y}" width="52" height="{_height}" rx="3" fill="{_color}" />'
        )
        _labels.append(
            f'<text class="axis-label" x="{_x + 26}" y="194" text-anchor="middle">{_variety}</text>'
        )
        _legend_y = _index * 24
        _legend.append(
            f'<rect y="{_legend_y}" width="11" height="11" rx="2" fill="{_color}" /><text x="18" y="{_legend_y + 10}">{_variety}</text>'
        )
    generic_svg_chart = mo.Html(
        f"""
        <div data-lens-demo="generic-svg">
          <svg role="img" aria-label="Generic SVG barley chart" viewBox="0 0 560 250" width="100%" height="250">
            <text class="chart-title" x="36" y="28" font-size="15" font-weight="700">Barley yield by variety</text>
            <g class="plot-area" transform="translate(56,38)">
              <line class="axis axis-x" x1="0" y1="168" x2="310" y2="168" stroke="currentColor" stroke-opacity="0.35" />
              <line class="axis axis-y" x1="0" y1="0" x2="0" y2="168" stroke="currentColor" stroke-opacity="0.35" />
              {"".join(_bars)}
              {"".join(_labels)}
            </g>
            <g class="legend" transform="translate(400,74)">
              {"".join(_legend)}
            </g>
          </svg>
        </div>
        """
    )
    generic_svg_chart
    return (generic_svg_chart,)


@app.cell(hide_code=True)
def _(mo):
    image_output = mo.Html(
        """
        <figure data-lens-demo="media">
          <img alt="Barley thumbnail" width="360" height="120"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 120'%3E%3Crect width='360' height='120' fill='%23f7fafc'/%3E%3Ccircle cx='70' cy='60' r='34' fill='%2317b8a6'/%3E%3Crect x='128' y='34' width='160' height='18' rx='4' fill='%235aa7ff'/%3E%3Crect x='128' y='68' width='112' height='18' rx='4' fill='%23f4b84a'/%3E%3C/svg%3E" />
        </figure>
        """
    )
    image_output
    return (image_output,)


@app.cell(hide_code=True)
def _(mo):
    document_output = mo.Html(
        """
        <iframe
          data-marimo-document
          title="Inline review document"
          srcdoc="<section><h2>Review packet</h2><p>Notebook output rendered as a document target.</p></section>"
          style="width: 100%; height: 180px; border: 1px solid currentColor; border-radius: 6px;"
        ></iframe>
        """
    )
    document_output
    return (document_output,)


@app.cell(hide_code=True)
def _(svg_segments):
    widget_rows = [
        {
            "segment": _row["variety"],
            "yield_amount": _row["yield_amount"],
            "status": "watch" if _index == 0 else "ok",
        }
        for _index, _row in enumerate(svg_segments.iter_rows(named=True))
    ]
    return (widget_rows,)


@app.cell(hide_code=True)
def _(anywidget, traitlets):
    class ShadowControlWidget(anywidget.AnyWidget):
        _esm = """
        function render({ model, el }) {
          const root = el.attachShadow({ mode: "open" });
          const rows = model.get("rows");
          root.innerHTML = `
            <style>
              :host { font: 13px system-ui; color: CanvasText; }
              table { border-collapse: collapse; width: 100%; max-width: 520px; }
              th, td { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); padding: 6px 8px; text-align: left; }
              button { margin-top: 8px; padding: 5px 9px; }
            </style>
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
            <button type="button">Refresh variety</button>
          `;
        }
        export default { render };
        """
        title = traitlets.Unicode("Shadow barley grid").tag(sync=True)
        rows = traitlets.List().tag(sync=True)
        columns = traitlets.List(
            [
                {"name": "segment", "dtype": "str"},
                {"name": "yield_amount", "dtype": "float"},
                {"name": "status", "dtype": "str"},
            ]
        ).tag(sync=True)

    return (ShadowControlWidget,)


@app.cell(hide_code=True)
def _(ShadowControlWidget, widget_rows):
    shadow_widget = ShadowControlWidget(rows=widget_rows)
    shadow_widget
    return (shadow_widget,)


@app.cell(hide_code=True)
def _(ShadowControlWidget, mo, widget_rows):
    wrapped_shadow_widget = mo.ui.anywidget(ShadowControlWidget(rows=widget_rows))
    wrapped_shadow_widget
    return (wrapped_shadow_widget,)


@app.cell(hide_code=True)
def _(barley, traitlets):
    class ReviewState(traitlets.HasTraits):
        selected_site = traitlets.Unicode(barley["site"][0]).tag(sync=True)
        threshold = traitlets.Int(25).tag(sync=True)

    review_state = ReviewState()
    review_state
    return ReviewState, review_state


@app.cell(hide_code=True)
def _(Lens, mo):
    lens = mo.ui.anywidget(Lens())
    lens
    return (lens,)


@app.cell(hide_code=True)
def _(mo):
    show_pair_feedback_json = mo.ui.checkbox(
        value=False,
        label="Show pair feedback JSON",
    )
    show_pair_feedback_json
    return (show_pair_feedback_json,)


@app.cell(hide_code=True)
def _(lens, mo, show_pair_feedback_json):
    pair_feedback_preview = (
        mo.json(lens.pair_feedback)
        if show_pair_feedback_json.value
        else mo.md("_Pair feedback JSON hidden by default._")
    )
    pair_feedback_preview
    return (pair_feedback_preview,)


@app.cell(hide_code=True)
def _():
    import altair as alt
    import anywidget
    import marimo as mo
    import matplotlib.pyplot as plt
    import plotly.express as px
    import polars as pl
    import traitlets
    from vega_datasets import data as vega_data

    from marimo_lens import Lens

    return Lens, alt, anywidget, mo, pl, plt, px, traitlets, vega_data


if __name__ == "__main__":
    app.run()
