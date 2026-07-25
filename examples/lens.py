import marimo

__generated_with = "0.23.14"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import marimo as mo

    from marimo_lens import Lens

    return Lens, mo


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    # Regional revenue

    Select a bar or drag across several bars, then ask your agent about
    the selected output. Add a note when the request needs more detail.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    region = mo.ui.dropdown(
        ["All", "North", "South", "West"],
        value="All",
        label="Region",
    )
    region
    return (region,)


@app.cell(hide_code=True)
def _(region):
    _sales = [
        {"region": "North", "month": "Jan", "revenue": 42},
        {"region": "North", "month": "Feb", "revenue": 58},
        {"region": "North", "month": "Mar", "revenue": 67},
        {"region": "North", "month": "Apr", "revenue": 76},
        {"region": "South", "month": "Jan", "revenue": 35},
        {"region": "South", "month": "Feb", "revenue": 48},
        {"region": "South", "month": "Mar", "revenue": 62},
        {"region": "South", "month": "Apr", "revenue": 71},
        {"region": "West", "month": "Jan", "revenue": 28},
        {"region": "West", "month": "Feb", "revenue": 39},
        {"region": "West", "month": "Mar", "revenue": 55},
        {"region": "West", "month": "Apr", "revenue": 68},
    ]
    filtered_sales = [
        _row
        for _row in _sales
        if region.value == "All" or _row["region"] == region.value
    ]
    return (filtered_sales,)


@app.cell(hide_code=True)
def _(filtered_sales, mo, region):
    _maximum = max(_row["revenue"] for _row in filtered_sales)
    _point_colors = {
        ("North", "Jan"): "#22c55e",
        ("North", "Feb"): "#22c55e",
        ("South", "Jan"): "#ef4444",
        ("West", "Feb"): "#a855f7",
    }
    _bars = "".join(
        f"""
        <div style="display:grid;grid-template-columns:72px 1fr 42px;align-items:center;gap:12px">
          <span>{_row["month"]}</span>
          <span style="display:block;height:20px;width:{(_row["revenue"] / _maximum) * 100:.1f}%;background:{_point_colors.get((_row["region"], _row["month"]), "#0880ea")}"></span>
          <strong>{_row["revenue"]}</strong>
        </div>
        """
        for _row in filtered_sales
    )
    _chart = mo.Html(
        f"""
        <section aria-label="Revenue by month" style="display:grid;gap:12px;padding:20px;border:1px solid color-mix(in srgb, currentColor 18%, transparent)">
          {_bars}
        </section>
        """
    )
    mo.vstack(
        [
            mo.md(
                f"""
                ## {region.value} revenue

                Select a bar to inspect one month, or drag across multiple bars
                to compare a period.
                """
            ),
            _chart,
        ],
        gap=1,
    )
    return


@app.cell(hide_code=True)
def _(Lens):
    lens = Lens()
    lens
    return


@app.cell
def _():
    return


if __name__ == "__main__":
    app.run()
