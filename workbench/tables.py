import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _(pl, vega_data):
    table_cars = (
        pl.read_json(vega_data.cars.filepath)
        .drop_nulls(["Miles_per_Gallon", "Horsepower", "Weight_in_lbs"])
        .with_columns(pl.col("Year").str.slice(0, 4).cast(pl.Int64).alias("model_year"))
        .select(
            "Name",
            "Origin",
            "Cylinders",
            "Miles_per_Gallon",
            "Horsepower",
            "Weight_in_lbs",
            "model_year",
        )
    )
    table_cars
    return (table_cars,)


@app.cell(hide_code=True)
def _(pl, table_cars):
    table_summary = (
        table_cars.group_by(["Origin", "Cylinders"])
        .agg(
            pl.len().alias("count"),
            pl.col("Miles_per_Gallon").mean().round(2).alias("avg_mpg"),
            pl.col("Horsepower").mean().round(2).alias("avg_horsepower"),
        )
        .sort(["Origin", "Cylinders"])
    )
    table_summary
    return (table_summary,)


@app.cell(hide_code=True)
def _(duckdb, table_cars):
    duckdb_top_origins = duckdb.sql(
        """
        select
          Origin,
          count(*) as cars,
          avg(Miles_per_Gallon) as avg_mpg,
          avg(Horsepower) as avg_horsepower
        from table_cars
        group by Origin
        order by cars desc
        """
    ).pl()
    duckdb_top_origins
    return (duckdb_top_origins,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Selectable cars table
    """)
    return


@app.cell
def _(mo, table_cars):
    cars_table = mo.ui.table(table_cars, label="Selectable cars table", page_size=8)
    cars_table
    return (cars_table,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Cars dataframe viewer
    """)
    return


@app.cell
def _(mo, table_cars):
    cars_dataframe = mo.ui.dataframe(table_cars, page_size=8)
    cars_dataframe
    return (cars_dataframe,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Editable grouped summary
    """)
    return


@app.cell
def _(mo, table_summary):
    summary_editor = mo.ui.data_editor(table_summary, label="Editable car summary")
    summary_editor
    return (summary_editor,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Cars data explorer
    """)
    return


@app.cell
def _(mo, table_cars):
    cars_explorer = mo.ui.data_explorer(
        table_cars,
        x="Horsepower",
        y="Miles_per_Gallon",
        color="Origin",
    )
    cars_explorer
    return (cars_explorer,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Formatted Polars metrics
    """)
    return


@app.cell
def _(mo, table_summary):
    _top_rows = table_summary.sort("count", descending=True).head(3)
    formatted_metrics = mo.vstack(
        [
            mo.stat(
                str(_row["count"]),
                label=f"{_row['Origin']} {_row['Cylinders']}-cyl",
                caption=f"{_row['avg_mpg']:.1f} MPG",
                bordered=True,
            )
            for _row in _top_rows.iter_rows(named=True)
        ]
    )
    formatted_metrics
    return (formatted_metrics,)


@app.cell(hide_code=True)
def _(table_summary):
    class SegmentLedgerTable:
        def __init__(self, rows):
            self.columns = [
                {"name": "origin", "dtype": "str"},
                {"name": "cylinders", "dtype": "int64"},
                {"name": "count", "dtype": "int64"},
            ]
            self.rows = rows

    _rows = [
        {
            "origin": _row["Origin"],
            "cylinders": _row["Cylinders"],
            "count": _row["count"],
        }
        for _row in table_summary.sort("count", descending=True)
        .head(4)
        .iter_rows(named=True)
    ]
    custom_table = SegmentLedgerTable(_rows)
    custom_table
    return SegmentLedgerTable, custom_table


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Custom table-like backend object
    """)
    return


@app.cell(hide_code=True)
def _(table_summary):
    plain_object = {
        "owner": "vega cars",
        "edit_boundary": "selected target cell",
        "columns": table_summary.columns,
        "row_count": table_summary.height,
    }
    plain_object
    return (plain_object,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Plain backend object payload
    """)
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
    tables_pair_feedback = (
        mo.json(lens.pair_feedback)
        if show_pair_feedback_json.value
        else mo.md("_Pair feedback JSON hidden by default._")
    )
    tables_pair_feedback
    return (tables_pair_feedback,)


@app.cell(hide_code=True)
def _():
    import duckdb
    import marimo as mo
    import polars as pl
    from vega_datasets import data as vega_data

    from marimo_lens import Lens

    return Lens, duckdb, mo, pl, vega_data


if __name__ == "__main__":
    app.run()
