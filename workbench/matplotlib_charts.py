import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _(pl, vega_data):
    mpl_cars = (
        pl.read_json(vega_data.cars.filepath)
        .drop_nulls(["Miles_per_Gallon", "Horsepower", "Weight_in_lbs"])
        .with_columns(pl.col("Year").str.slice(0, 4).cast(pl.Int64).alias("model_year"))
    )
    return (mpl_cars,)


@app.cell(hide_code=True)
def _(mpl_cars, pl):
    mpl_origin_summary = (
        mpl_cars.group_by("Origin")
        .agg(
            pl.len().alias("count"),
            pl.col("Miles_per_Gallon").mean().round(2).alias("avg_mpg"),
            pl.col("Horsepower").mean().round(2).alias("avg_horsepower"),
            pl.col("Weight_in_lbs").mean().round(0).alias("avg_weight"),
            pl.col("Miles_per_Gallon").std().round(2).alias("mpg_std"),
        )
        .sort("Origin")
    )
    return (mpl_origin_summary,)


@app.cell(hide_code=True)
def _(mpl_cars, pl):
    mpl_yearly_origin = (
        mpl_cars.group_by(["model_year", "Origin"])
        .agg(pl.col("Miles_per_Gallon").mean().round(2).alias("avg_mpg"))
        .sort(["model_year", "Origin"])
    )
    return (mpl_yearly_origin,)


@app.cell(hide_code=True)
def _(mpl_cars, pl):
    mpl_cylinder_origin = (
        mpl_cars.group_by(["Origin", "Cylinders"])
        .agg(pl.len().alias("count"))
        .sort(["Origin", "Cylinders"])
    )
    return (mpl_cylinder_origin,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib Line2D canvas widget
    """)
    return


@app.cell
def _(mo, mpl_yearly_origin, plt):
    line_figure, line_axes = plt.subplots(figsize=(5.4, 3.0))
    for _origin in mpl_yearly_origin["Origin"].unique().sort().to_list():
        _frame = mpl_yearly_origin.filter(mpl_yearly_origin["Origin"] == _origin)
        line_axes.plot(
            _frame["model_year"].to_list(),
            _frame["avg_mpg"].to_list(),
            marker="o",
            label=_origin,
        )
    line_axes.set_title("Line2D marks and legend")
    line_axes.set_ylabel("Mean MPG")
    line_axes.legend(loc="upper left", bbox_to_anchor=(1.02, 1))
    line_figure.tight_layout()
    line_widget = mo.ui.matplotlib(line_axes)
    line_widget
    return line_axes, line_figure, line_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib patch bar canvas widget
    """)
    return


@app.cell
def _(mo, mpl_origin_summary, plt):
    bar_figure, bar_axes = plt.subplots(figsize=(5.4, 3.0))
    bar_axes.bar(
        mpl_origin_summary["Origin"].to_list(),
        mpl_origin_summary["avg_mpg"].to_list(),
        width=0.72,
        color=["#4f8dd3", "#e45756", "#72b7b2"],
    )
    bar_axes.set_title("Patch bars")
    bar_axes.set_ylabel("Mean MPG")
    bar_figure.tight_layout()
    bar_widget = mo.ui.matplotlib(bar_axes)
    bar_widget
    return bar_axes, bar_figure, bar_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib scatter canvas widget
    """)
    return


@app.cell
def _(mo, mpl_cars, plt):
    _plot_cars = mpl_cars.head(90)
    scatter_figure, scatter_axes = plt.subplots(figsize=(5.4, 3.0))
    scatter_axes.scatter(
        _plot_cars["Horsepower"].to_list(),
        _plot_cars["Miles_per_Gallon"].to_list(),
        s=(_plot_cars["Weight_in_lbs"] / 45).to_list(),
        c=_plot_cars["Cylinders"].to_list(),
        cmap="viridis",
        alpha=0.82,
    )
    for _row in _plot_cars.head(8).iter_rows(named=True):
        scatter_axes.annotate(
            _row["Origin"],
            (_row["Horsepower"], _row["Miles_per_Gallon"]),
            xytext=(5, 3),
            textcoords="offset points",
        )
    scatter_axes.set_title("PathCollection points and annotations")
    scatter_axes.set_xlabel("Horsepower")
    scatter_axes.set_ylabel("MPG")
    scatter_figure.tight_layout()
    scatter_widget = mo.ui.matplotlib(scatter_axes)
    scatter_widget
    return scatter_axes, scatter_figure, scatter_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib histogram canvas widget
    """)
    return


@app.cell
def _(mo, mpl_cars, plt):
    histogram_figure, histogram_axes = plt.subplots(figsize=(5.4, 3.0))
    histogram_axes.hist(
        mpl_cars["Miles_per_Gallon"].to_list(),
        bins=12,
        color="#5b8def",
    )
    histogram_axes.set_title("Histogram patches")
    histogram_axes.set_xlabel("MPG")
    histogram_axes.set_ylabel("Cars")
    histogram_figure.tight_layout()
    histogram_widget = mo.ui.matplotlib(histogram_axes)
    histogram_widget
    return histogram_axes, histogram_figure, histogram_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib heatmap canvas widget
    """)
    return


@app.cell
def _(mo, mpl_cylinder_origin, mpl_origin_summary, plt):
    _origins = mpl_origin_summary["Origin"].to_list()
    _cylinders = mpl_cylinder_origin["Cylinders"].unique().sort().to_list()
    _counts = {
        (_row["Origin"], _row["Cylinders"]): _row["count"]
        for _row in mpl_cylinder_origin.iter_rows(named=True)
    }
    _grid = [
        [_counts.get((_origin, _cylinder), 0) for _cylinder in _cylinders]
        for _origin in _origins
    ]
    heatmap_figure, heatmap_axes = plt.subplots(figsize=(5.4, 3.0))
    heatmap = heatmap_axes.imshow(_grid, cmap="viridis", aspect="auto")
    heatmap_axes.set_xticks(
        range(len(_cylinders)), [str(_value) for _value in _cylinders]
    )
    heatmap_axes.set_yticks(range(len(_origins)), _origins)
    heatmap_axes.set_title("Image heatmap and colorbar")
    heatmap_axes.set_xlabel("Cylinders")
    heatmap_figure.colorbar(heatmap, ax=heatmap_axes, label="Cars")
    heatmap_figure.tight_layout()
    heatmap_widget = mo.ui.matplotlib(heatmap_axes)
    heatmap_widget
    return heatmap_axes, heatmap_figure, heatmap_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib subplot canvas widget
    """)
    return


@app.cell
def _(mo, mpl_origin_summary, plt):
    subplot_figure, subplot_axes = plt.subplots(1, 2, figsize=(7.2, 3.0))
    subplot_axes[0].plot(
        mpl_origin_summary["Origin"].to_list(),
        mpl_origin_summary["avg_mpg"].to_list(),
        marker="s",
    )
    subplot_axes[0].set_title("Mean MPG")
    subplot_axes[1].bar(
        mpl_origin_summary["Origin"].to_list(),
        mpl_origin_summary["avg_horsepower"].to_list(),
        color="#72b7b2",
    )
    subplot_axes[1].set_title("Horsepower")
    subplot_figure.suptitle("Multiple axes")
    subplot_figure.tight_layout()
    subplot_widget = mo.ui.matplotlib(subplot_axes[0])
    subplot_widget
    return subplot_axes, subplot_figure, subplot_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib errorbar canvas widget
    """)
    return


@app.cell
def _(mo, mpl_origin_summary, plt):
    errorbar_figure, errorbar_axes = plt.subplots(figsize=(5.4, 3.0))
    errorbar_axes.errorbar(
        mpl_origin_summary["Origin"].to_list(),
        mpl_origin_summary["avg_mpg"].to_list(),
        yerr=mpl_origin_summary["mpg_std"].to_list(),
        fmt="o-",
        capsize=4,
        label="Mean MPG",
    )
    errorbar_axes.set_title("Errorbar lines and caps")
    errorbar_axes.set_ylabel("MPG")
    errorbar_axes.legend(loc="upper left")
    errorbar_figure.tight_layout()
    errorbar_widget = mo.ui.matplotlib(errorbar_axes)
    errorbar_widget
    return errorbar_axes, errorbar_figure, errorbar_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib stem canvas widget
    """)
    return


@app.cell
def _(mo, mpl_origin_summary, plt):
    stem_figure, stem_axes = plt.subplots(figsize=(5.4, 3.0))
    stem_axes.stem(
        mpl_origin_summary["Origin"].to_list(),
        mpl_origin_summary["count"].to_list(),
        basefmt=" ",
    )
    stem_axes.set_title("Stem markers")
    stem_axes.set_ylabel("Cars")
    stem_figure.tight_layout()
    stem_widget = mo.ui.matplotlib(stem_axes)
    stem_widget
    return stem_axes, stem_figure, stem_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib contour canvas widget
    """)
    return


@app.cell
def _(mo, mpl_cylinder_origin, mpl_origin_summary, np, plt):
    _origins = mpl_origin_summary["Origin"].to_list()
    _cylinders = mpl_cylinder_origin["Cylinders"].unique().sort().to_list()
    _counts = {
        (_row["Origin"], _row["Cylinders"]): _row["count"]
        for _row in mpl_cylinder_origin.iter_rows(named=True)
    }
    _grid = np.array(
        [
            [_counts.get((_origin, _cylinder), 0) for _cylinder in _cylinders]
            for _origin in _origins
        ],
        dtype=float,
    )
    _xx, _yy = np.meshgrid(range(len(_cylinders)), range(len(_origins)))
    contour_figure, contour_axes = plt.subplots(figsize=(5.4, 3.0))
    contour = contour_axes.contourf(_xx, _yy, _grid, levels=8, cmap="magma")
    contour_axes.contour(_xx, _yy, _grid, levels=4, colors="white", linewidths=0.4)
    contour_axes.set_xticks(
        range(len(_cylinders)), [str(_value) for _value in _cylinders]
    )
    contour_axes.set_yticks(range(len(_origins)), _origins)
    contour_axes.set_title("Contourf mesh and contour lines")
    contour_figure.colorbar(contour, ax=contour_axes, label="Cars")
    contour_figure.tight_layout()
    contour_widget = mo.ui.matplotlib(contour_axes)
    contour_widget
    return contour_axes, contour_figure, contour_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib polar canvas widget
    """)
    return


@app.cell
def _(mo, mpl_origin_summary, np, plt):
    polar_figure = plt.figure(figsize=(5.0, 3.6))
    polar_axes = polar_figure.add_subplot(111, projection="polar")
    _theta = np.linspace(0, 2 * np.pi, len(mpl_origin_summary), endpoint=False)
    polar_axes.bar(
        _theta,
        mpl_origin_summary["count"].to_list(),
        width=0.5,
        color=["#4f8dd3", "#e45756", "#72b7b2"],
        alpha=0.78,
    )
    polar_axes.set_xticks(_theta, mpl_origin_summary["Origin"].to_list())
    polar_axes.set_title("Polar bar projection")
    polar_figure.tight_layout()
    polar_widget = mo.ui.matplotlib(polar_axes)
    polar_widget
    return polar_axes, polar_figure, polar_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib stackplot canvas widget
    """)
    return


@app.cell
def _(mo, mpl_yearly_origin, plt):
    _years = mpl_yearly_origin["model_year"].unique().sort().to_list()
    _origins = mpl_yearly_origin["Origin"].unique().sort().to_list()
    _series = []
    for _origin in _origins:
        _frame = mpl_yearly_origin.filter(mpl_yearly_origin["Origin"] == _origin)
        _values = {
            _row["model_year"]: _row["avg_mpg"] for _row in _frame.iter_rows(named=True)
        }
        _series.append([_values.get(_year, 0) for _year in _years])
    stack_figure, stack_axes = plt.subplots(figsize=(5.4, 3.0))
    stack_axes.stackplot(_years, *_series, labels=_origins, alpha=0.76)
    stack_axes.set_title("Stackplot filled areas")
    stack_axes.set_ylabel("Mean MPG")
    stack_axes.legend(loc="upper left", bbox_to_anchor=(1.02, 1))
    stack_figure.tight_layout()
    stack_widget = mo.ui.matplotlib(stack_axes)
    stack_widget
    return stack_axes, stack_figure, stack_widget


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib twin axes canvas widget
    """)
    return


@app.cell
def _(mo, mpl_origin_summary, plt):
    twin_figure, twin_axes = plt.subplots(figsize=(5.4, 3.0))
    twin_axes.bar(
        mpl_origin_summary["Origin"].to_list(),
        mpl_origin_summary["avg_mpg"].to_list(),
        color="#4f8dd3",
        alpha=0.72,
    )
    twin_axes.set_ylabel("Mean MPG")
    twin_axes_right = twin_axes.twinx()
    twin_axes_right.plot(
        mpl_origin_summary["Origin"].to_list(),
        mpl_origin_summary["avg_horsepower"].to_list(),
        color="#e45756",
        marker="o",
    )
    twin_axes_right.set_ylabel("Horsepower")
    twin_axes.set_title("Twin axes bar and line")
    twin_figure.tight_layout()
    twin_widget = mo.ui.matplotlib(twin_axes)
    twin_widget
    return twin_axes, twin_figure, twin_widget


@app.cell(hide_code=True)
def _(io, mo):
    def matplotlib_svg_figure(figure, label):
        _buffer = io.StringIO()
        figure.savefig(_buffer, format="svg", bbox_inches="tight")
        return mo.Html(
            f"""
            <section data-renderer="matplotlib-svg" aria-label="{label}">
              <h3>{label}</h3>
              {_buffer.getvalue()}
            </section>
            """
        )

    return (matplotlib_svg_figure,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib SVG Line2D output
    """)
    return


@app.cell
def _(line_figure, matplotlib_svg_figure):
    line_svg_output = matplotlib_svg_figure(line_figure, "SVG Line2D output")
    line_svg_output
    return (line_svg_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib SVG errorbar output
    """)
    return


@app.cell
def _(errorbar_figure, matplotlib_svg_figure):
    errorbar_svg_output = matplotlib_svg_figure(
        errorbar_figure,
        "SVG errorbar output",
    )
    errorbar_svg_output
    return (errorbar_svg_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib SVG contour output
    """)
    return


@app.cell
def _(contour_figure, matplotlib_svg_figure):
    contour_svg_output = matplotlib_svg_figure(
        contour_figure,
        "SVG contour output",
    )
    contour_svg_output
    return (contour_svg_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib SVG polar output
    """)
    return


@app.cell
def _(matplotlib_svg_figure, polar_figure):
    polar_svg_output = matplotlib_svg_figure(polar_figure, "SVG polar output")
    polar_svg_output
    return (polar_svg_output,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Matplotlib SVG stackplot output
    """)
    return


@app.cell
def _(matplotlib_svg_figure, stack_figure):
    stack_svg_output = matplotlib_svg_figure(stack_figure, "SVG stackplot output")
    stack_svg_output
    return (stack_svg_output,)


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
    matplotlib_pair_feedback = (
        mo.json(lens.pair_feedback)
        if show_pair_feedback_json.value
        else mo.md("_Pair feedback JSON hidden by default._")
    )
    matplotlib_pair_feedback
    return (matplotlib_pair_feedback,)


@app.cell(hide_code=True)
def _():
    import io

    import marimo as mo
    import matplotlib.pyplot as plt
    import numpy as np
    import polars as pl
    from vega_datasets import data as vega_data

    from marimo_lens import Lens

    return Lens, io, mo, np, pl, plt, vega_data


if __name__ == "__main__":
    app.run()
