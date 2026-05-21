import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _(pl, vega_data):
    plotly_cars = (
        pl.read_json(vega_data.cars.filepath)
        .drop_nulls(["Miles_per_Gallon", "Horsepower", "Weight_in_lbs"])
        .with_columns(pl.col("Year").str.slice(0, 4).cast(pl.Int64).alias("model_year"))
    )
    return (plotly_cars,)


@app.cell(hide_code=True)
def _(plotly_cars, pl):
    origin_summary = (
        plotly_cars.group_by("Origin")
        .agg(
            pl.len().alias("count"),
            pl.col("Miles_per_Gallon").mean().round(2).alias("avg_mpg"),
            pl.col("Horsepower").mean().round(2).alias("avg_horsepower"),
            pl.col("Weight_in_lbs").mean().round(0).alias("avg_weight"),
        )
        .sort("count", descending=True)
    )
    return (origin_summary,)


@app.cell(hide_code=True)
def _(plotly_cars, pl):
    yearly_origin = (
        plotly_cars.group_by(["model_year", "Origin"])
        .agg(
            pl.col("Miles_per_Gallon").mean().round(2).alias("avg_mpg"),
            pl.col("Horsepower").mean().round(2).alias("avg_horsepower"),
        )
        .sort(["model_year", "Origin"])
    )
    return (yearly_origin,)


@app.cell(hide_code=True)
def _(plotly_cars, pl):
    cylinder_origin = (
        plotly_cars.group_by(["Origin", "Cylinders"])
        .agg(
            pl.len().alias("count"),
            pl.col("Miles_per_Gallon").mean().round(2).alias("avg_mpg"),
        )
        .sort(["Origin", "Cylinders"])
    )
    return (cylinder_origin,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly line traces with point hit testing
    """)
    return


@app.cell
def _(px, yearly_origin):
    line_figure = px.line(
        yearly_origin,
        x="model_year",
        y="avg_mpg",
        color="Origin",
        markers=True,
        title="Mean MPG by model year",
    )
    line_figure
    return (line_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly scatter points with legend and symbols
    """)
    return


@app.cell
def _(plotly_cars, px):
    scatter_figure = px.scatter(
        plotly_cars,
        x="Horsepower",
        y="Miles_per_Gallon",
        color="Origin",
        symbol="Cylinders",
        size="Weight_in_lbs",
        hover_data=["Name", "model_year"],
        title="Horsepower versus MPG",
    )
    scatter_figure
    return (scatter_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly grouped bar traces
    """)
    return


@app.cell
def _(cylinder_origin, px):
    grouped_bar_figure = px.bar(
        cylinder_origin,
        x="Cylinders",
        y="count",
        color="Origin",
        barmode="group",
        title="Cars by cylinder count and origin",
    )
    grouped_bar_figure
    return (grouped_bar_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly box plot with overlaid points
    """)
    return


@app.cell
def _(plotly_cars, px):
    box_figure = px.box(
        plotly_cars,
        x="Origin",
        y="Miles_per_Gallon",
        color="Origin",
        points="all",
        title="MPG distribution by origin",
    )
    box_figure
    return (box_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly histogram bins with rug marks
    """)
    return


@app.cell
def _(plotly_cars, px):
    histogram_figure = px.histogram(
        plotly_cars,
        x="Miles_per_Gallon",
        color="Origin",
        marginal="rug",
        title="MPG histogram with rug marks",
    )
    histogram_figure
    return (histogram_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly violin, box, and point traces
    """)
    return


@app.cell
def _(plotly_cars, px):
    violin_figure = px.violin(
        plotly_cars,
        x="Origin",
        y="Acceleration",
        color="Origin",
        box=True,
        points="all",
        title="Acceleration violin by origin",
    )
    violin_figure
    return (violin_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly waterfall contribution trace
    """)
    return


@app.cell
def _(go, pl, yearly_origin):
    _annual_mpg = (
        yearly_origin.group_by("model_year")
        .agg(pl.col("avg_mpg").mean().round(2).alias("avg_mpg"))
        .sort("model_year")
        .tail(6)
    )
    waterfall_figure = go.Figure(
        go.Waterfall(
            x=[str(_year) for _year in _annual_mpg["model_year"].to_list()],
            y=_annual_mpg["avg_mpg"].to_list(),
            measure=["relative"] * len(_annual_mpg),
            connector={"line": {"dash": "dot"}},
            name="Average MPG",
        )
    )
    waterfall_figure.update_layout(title="Recent model-year MPG contribution trace")
    waterfall_figure
    return (waterfall_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly funnel conversion trace
    """)
    return


@app.cell
def _(go, origin_summary):
    funnel_figure = go.Figure(
        go.Funnel(
            y=origin_summary["Origin"].to_list(),
            x=origin_summary["count"].to_list(),
            textinfo="value+percent initial",
        )
    )
    funnel_figure.update_layout(title="Cars by origin funnel trace")
    funnel_figure
    return (funnel_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly funnelarea sector trace
    """)
    return


@app.cell
def _(go, origin_summary):
    funnelarea_figure = go.Figure(
        go.Funnelarea(
            labels=origin_summary["Origin"].to_list(),
            values=origin_summary["count"].to_list(),
            textinfo="label+value",
        )
    )
    funnelarea_figure.update_layout(title="Cars by origin funnelarea trace")
    funnelarea_figure
    return (funnelarea_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly treemap hierarchy
    """)
    return


@app.cell
def _(plotly_cars, px):
    treemap_figure = px.treemap(
        plotly_cars,
        path=["Origin", "Cylinders"],
        values="Weight_in_lbs",
        color="Miles_per_Gallon",
        title="Car hierarchy by origin and cylinders",
    )
    treemap_figure
    return (treemap_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly heatmap trace and colorbar
    """)
    return


@app.cell
def _(cylinder_origin, go, origin_summary):
    _origins = origin_summary["Origin"].to_list()
    _cylinders = cylinder_origin["Cylinders"].unique().sort().to_list()
    _counts = {
        (_row["Origin"], _row["Cylinders"]): _row["count"]
        for _row in cylinder_origin.iter_rows(named=True)
    }
    heatmap_figure = go.Figure(
        data=go.Heatmap(
            z=[
                [_counts.get((_origin, _cylinder), 0) for _cylinder in _cylinders]
                for _origin in _origins
            ],
            x=[str(_cylinder) for _cylinder in _cylinders],
            y=_origins,
            colorbar={"title": "Cars"},
        )
    )
    heatmap_figure.update_layout(
        title="Origin by cylinder-count heatmap",
        xaxis_title="Cylinders",
        yaxis_title="Origin",
    )
    heatmap_figure
    return (heatmap_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly pie trace and legend
    """)
    return


@app.cell
def _(go, origin_summary):
    pie_figure = go.Figure(
        data=go.Pie(
            labels=origin_summary["Origin"].to_list(),
            values=origin_summary["count"].to_list(),
            hole=0.35,
        )
    )
    pie_figure.update_layout(title="Cars by origin pie trace")
    pie_figure
    return (pie_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly sunburst hierarchy
    """)
    return


@app.cell
def _(plotly_cars, px):
    sunburst_figure = px.sunburst(
        plotly_cars,
        path=["Origin", "Cylinders", "model_year"],
        values="Weight_in_lbs",
        color="Miles_per_Gallon",
        title="Car hierarchy sunburst",
    )
    sunburst_figure
    return (sunburst_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly subplot axes and trace layers
    """)
    return


@app.cell
def _(go, make_subplots, yearly_origin):
    subplot_figure = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=("MPG", "Horsepower"),
    )
    for _origin in yearly_origin["Origin"].unique().sort().to_list():
        _frame = yearly_origin.filter(yearly_origin["Origin"] == _origin)
        subplot_figure.add_trace(
            go.Scatter(
                x=_frame["model_year"].to_list(),
                y=_frame["avg_mpg"].to_list(),
                mode="lines+markers",
                name=_origin,
            ),
            row=1,
            col=1,
        )
        subplot_figure.add_trace(
            go.Bar(
                x=_frame["model_year"].to_list(),
                y=_frame["avg_horsepower"].to_list(),
                name=f"{_origin} horsepower",
                showlegend=False,
            ),
            row=1,
            col=2,
        )
    subplot_figure.update_layout(title="Subplot axes and trace layers")
    subplot_figure
    return (subplot_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly Scattergl WebGL canvas trace
    """)
    return


@app.cell
def _(go, plotly_cars):
    _webgl_cars = plotly_cars.head(120)
    scattergl_figure = go.Figure(
        go.Scattergl(
            x=_webgl_cars["Horsepower"].to_list(),
            y=_webgl_cars["Miles_per_Gallon"].to_list(),
            mode="markers+text",
            text=_webgl_cars["Origin"].to_list(),
            marker={
                "color": _webgl_cars["Weight_in_lbs"].to_list(),
                "colorscale": "Viridis",
                "size": (_webgl_cars["Cylinders"] * 2).to_list(),
                "showscale": True,
            },
            name="WebGL car points",
        )
    )
    scattergl_figure.update_layout(
        title="Scattergl WebGL canvas trace",
        xaxis_title="Horsepower",
        yaxis_title="MPG",
        height=360,
    )
    scattergl_figure
    return (scattergl_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly Scatter3d WebGL scene
    """)
    return


@app.cell
def _(go, plotly_cars):
    _webgl_cars = plotly_cars.head(120)
    scatter3d_figure = go.Figure(
        go.Scatter3d(
            x=_webgl_cars["Horsepower"].to_list(),
            y=_webgl_cars["Miles_per_Gallon"].to_list(),
            z=_webgl_cars["Weight_in_lbs"].to_list(),
            mode="markers",
            marker={
                "size": 6,
                "color": _webgl_cars["Miles_per_Gallon"].to_list(),
                "colorscale": "Plasma",
            },
            text=_webgl_cars["Origin"].to_list(),
            name="3D WebGL points",
        )
    )
    scatter3d_figure.update_layout(title="Scatter3d WebGL scene", height=360)
    scatter3d_figure
    return (scatter3d_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly surface WebGL canvas scene
    """)
    return


@app.cell
def _(cylinder_origin, go, origin_summary):
    _origins = origin_summary["Origin"].to_list()
    _cylinders = cylinder_origin["Cylinders"].unique().sort().to_list()
    _counts = {
        (_row["Origin"], _row["Cylinders"]): _row["count"]
        for _row in cylinder_origin.iter_rows(named=True)
    }
    surface_figure = go.Figure(
        go.Surface(
            z=[
                [_counts.get((_origin, _cylinder), 0) for _cylinder in _cylinders]
                for _origin in _origins
            ],
            x=[str(_cylinder) for _cylinder in _cylinders],
            y=_origins,
            colorscale="Viridis",
        )
    )
    surface_figure.update_layout(title="Surface WebGL canvas scene", height=360)
    surface_figure
    return (surface_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly SVG DOM widget selector
    """)
    return


@app.cell
def _(line_figure, mo):
    plotly_svg_widget = mo.ui.plotly(
        line_figure,
        renderer_name="notebook",
        label="Plotly SVG DOM selector",
    )
    plotly_svg_widget
    return (plotly_svg_widget,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plotly WebGL canvas widget selector
    """)
    return


@app.cell
def _(mo, scattergl_figure):
    plotly_canvas_widget = mo.ui.plotly(
        scattergl_figure,
        renderer_name="notebook",
        label="Plotly WebGL canvas selector",
    )
    plotly_canvas_widget
    return (plotly_canvas_widget,)


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
    plotly_pair_feedback = (
        mo.json(lens.pair_feedback)
        if show_pair_feedback_json.value
        else mo.md("_Pair feedback JSON hidden by default._")
    )
    plotly_pair_feedback
    return (plotly_pair_feedback,)


@app.cell(hide_code=True)
def _():
    import marimo as mo
    import plotly.express as px
    import plotly.graph_objects as go
    import polars as pl
    from plotly.subplots import make_subplots
    from vega_datasets import data as vega_data

    from marimo_lens import Lens

    return Lens, go, make_subplots, mo, pl, px, vega_data


if __name__ == "__main__":
    app.run()
