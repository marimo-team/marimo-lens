import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _(pl, vega_data):
    altair_barley = (
        pl.read_json(vega_data.barley.filepath)
        .rename({"yield": "yield_amount"})
        .with_columns(pl.col("year").cast(pl.Utf8).alias("year_label"))
    )
    return (altair_barley,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair bar marks with color legend
    """)
    return


@app.cell
def _(alt, altair_barley):
    bar_chart = (
        alt.Chart(altair_barley)
        .mark_bar(cornerRadiusTopLeft=3, cornerRadiusTopRight=3)
        .encode(
            x=alt.X("year_label:N", title="Year"),
            y=alt.Y("sum(yield_amount):Q", title="Barley yield"),
            color=alt.Color("site:N", title="Site"),
            tooltip=["site", "year_label", "variety", "yield_amount"],
        )
        .properties(title="Barley yield by site", height=220)
    )
    bar_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair line marks and points
    """)
    return


@app.cell
def _(alt, altair_barley):
    line_chart = (
        alt.Chart(altair_barley)
        .mark_line(point=True)
        .encode(
            x=alt.X("year_label:N", title="Year"),
            y=alt.Y("mean(yield_amount):Q", title="Mean yield"),
            color="site:N",
            tooltip=["site", "year_label", "mean(yield_amount)"],
        )
        .properties(title="Mean yield trend by site", height=220)
    )
    line_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair point marks with shape and color
    """)
    return


@app.cell
def _(alt, altair_barley):
    scatter_chart = (
        alt.Chart(altair_barley)
        .mark_circle(size=120, opacity=0.82)
        .encode(
            x=alt.X("year:Q", title="Year"),
            y=alt.Y("yield_amount:Q", title="Yield"),
            color="site:N",
            shape="variety:N",
            tooltip=["site", "variety", "year", "yield_amount"],
        )
        .properties(title="Variety yield points", height=220)
    )
    scatter_chart
    return (scatter_chart,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair stacked area marks
    """)
    return


@app.cell
def _(alt, altair_barley):
    area_chart = (
        alt.Chart(altair_barley)
        .mark_area(opacity=0.68)
        .encode(
            x="year_label:N",
            y=alt.Y("sum(yield_amount):Q", stack="center", title="Yield"),
            color="site:N",
            tooltip=["site", "year_label", "yield_amount"],
        )
        .properties(title="Stacked barley yield", height=220)
    )
    area_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair rect heatmap
    """)
    return


@app.cell
def _(alt, altair_barley):
    heatmap_chart = (
        alt.Chart(altair_barley)
        .mark_rect()
        .encode(
            x="year_label:N",
            y="site:N",
            color=alt.Color("sum(yield_amount):Q", title="Yield"),
            tooltip=["site", "year_label", "sum(yield_amount)"],
        )
        .properties(title="Site-year yield heatmap", height=220)
    )
    heatmap_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair layered bar plus line
    """)
    return


@app.cell
def _(alt, altair_barley):
    layered_chart = alt.layer(
        alt.Chart(altair_barley)
        .mark_bar(opacity=0.35)
        .encode(x="year_label:N", y="sum(yield_amount):Q", color="site:N"),
        alt.Chart(altair_barley)
        .mark_line(color="#1b4d89", point=True)
        .encode(x="year_label:N", y="mean(yield_amount):Q"),
    ).properties(title="Layered yield bars plus mean line", height=220)
    layered_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair faceted bars
    """)
    return


@app.cell
def _(alt, altair_barley):
    facet_chart = (
        alt.Chart(altair_barley)
        .mark_bar()
        .encode(x="year_label:N", y="sum(yield_amount):Q", color="variety:N")
        .facet(column="site:N", row="variety")
        .properties(title="Faceted site yield")
    )
    facet_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair horizontal composition
    """)
    return


@app.cell
def _(alt, altair_barley):
    hconcat_chart = alt.hconcat(
        *[
            alt.Chart(altair_barley)
            .mark_point(filled=True, size=85)
            .encode(
                x=alt.X(_field, type=_type, title=_field),
                y="yield_amount:Q",
                color="site:N",
                tooltip=["site", "variety", _field, "yield_amount"],
            )
            .properties(title=f"Yield by {_field}", height=180, width=220)
            for _field, _type in [("year", "quantitative"), ("variety", "nominal")]
        ]
    )
    hconcat_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair bar, rule, and text layer
    """)
    return


@app.cell
def _(alt, altair_barley):
    mean_yield = (
        alt.Chart(altair_barley)
        .mark_rule(color="#1b4d89", strokeDash=[4, 3])
        .encode(y="mean(yield_amount):Q")
    )
    rule_text_chart = alt.layer(
        alt.Chart(altair_barley)
        .mark_bar()
        .encode(
            x="site:N",
            y="sum(yield_amount):Q",
            color="year_label:N",
            tooltip=["site", "year_label", "sum(yield_amount)"],
        ),
        mean_yield,
        alt.Chart(altair_barley)
        .mark_text(dy=-8, fontWeight="bold")
        .encode(x="site:N", y="sum(yield_amount):Q", text="sum(yield_amount):Q"),
    ).properties(title="Bar, rule, and text layer", height=220)
    rule_text_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair boxplot aggregate mark
    """)
    return


@app.cell
def _(alt, altair_barley):
    boxplot_chart = (
        alt.Chart(altair_barley)
        .mark_boxplot(extent="min-max")
        .encode(
            x="site:N",
            y="yield_amount:Q",
            color="site:N",
            tooltip=["site", "yield_amount"],
            column="site",
        )
        .properties(title="Boxplot aggregate mark", height=220)
    )
    boxplot_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair tick marks by segment
    """)
    return


@app.cell
def _(alt, altair_barley):
    tick_chart = (
        alt.Chart(altair_barley)
        .mark_tick(thickness=2, size=24)
        .encode(
            x="yield_amount:Q",
            y="site:N",
            color="year_label:N",
            tooltip=["site", "variety", "year_label", "yield_amount"],
        )
        .properties(title="Tick marks by site", height=220)
    )
    tick_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair interval selection points
    """)
    return


@app.cell
def _(alt, altair_barley):
    brush = alt.selection_interval(name="brush", encodings=["x"])
    brush_chart = (
        alt.Chart(altair_barley)
        .mark_point(filled=True, size=110)
        .encode(
            x="year:Q",
            y="yield_amount:Q",
            color="site:N",
            opacity=alt.condition(brush, alt.value(0.9), alt.value(0.25)),
            tooltip=["site", "variety", "year", "yield_amount"],
        )
        .add_params(brush)
        .properties(title="Interval selection points", height=220)
    )
    brush_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair repeated quantitative histograms
    """)
    return


@app.cell
def _(alt, altair_barley):
    repeat_chart = (
        alt.Chart(altair_barley)
        .mark_bar()
        .encode(
            x=alt.X(alt.repeat("column"), type="quantitative"),
            y="count():Q",
            color="site:N",
        )
        .properties(width=180, height=170)
        .repeat(column=["yield_amount", "year"])
        .properties(title="Repeated quantitative histograms")
    )
    repeat_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair Vega SVG renderer
    """)
    return


@app.cell
def _(alt, altair_barley):
    altair_svg_chart = (
        alt.Chart(altair_barley)
        .mark_circle(size=95, opacity=0.82)
        .encode(
            x="year:Q",
            y="yield_amount:Q",
            color="site:N",
            tooltip=["site", "variety", "year", "yield_amount"],
        )
        .properties(
            title="Altair/Vega SVG renderer",
            width=360,
            height=240,
            usermeta={"embedOptions": {"renderer": "svg"}},
        )
    )
    altair_svg_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair Vega canvas renderer
    """)
    return


@app.cell
def _(alt, altair_barley):
    altair_canvas_chart = (
        alt.Chart(altair_barley)
        .mark_circle(size=95, opacity=0.82)
        .encode(
            x="year:Q",
            y="yield_amount:Q",
            color="site:N",
            tooltip=["site", "variety", "year", "yield_amount"],
        )
        .properties(
            title="Altair/Vega canvas renderer",
            width=360,
            height=240,
            usermeta={"embedOptions": {"renderer": "canvas"}},
        )
    )
    altair_canvas_chart
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Altair chart widget selector
    """)
    return


@app.cell
def _(mo, scatter_chart):
    altair_widget = mo.ui.altair_chart(
        scatter_chart,
        label="Altair barley selector",
    )
    altair_widget
    return


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
    altair_pair_feedback = (
        mo.json(lens.pair_feedback)
        if show_pair_feedback_json.value
        else mo.md("_Pair feedback JSON hidden by default._")
    )
    altair_pair_feedback
    return


@app.cell(hide_code=True)
def _():
    import altair as alt
    import marimo as mo
    import polars as pl
    from vega_datasets import data as vega_data

    from marimo_lens import Lens

    return Lens, alt, mo, pl, vega_data


if __name__ == "__main__":
    app.run()
