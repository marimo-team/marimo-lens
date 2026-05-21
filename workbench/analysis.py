import marimo

__generated_with = "0.23.6"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    DATASET_URL = "https://raw.githubusercontent.com/demoPlz/mini-template/main/studio/dataset.csv"
    return (DATASET_URL,)


@app.cell(hide_code=True)
def _(DATASET_URL, pl):
    df = pl.read_csv(DATASET_URL)
    # df
    return (df,)


@app.cell
def _(alt, df):
    (
        alt.Chart(df)
        .mark_point()
        .encode(
            x="Downloads_Xplore",
            y="PubsCited_CrossRef",
            column="PaperType",
            row="Conference",
        )
        .properties(width=150, height=150)
    )
    return


@app.cell(hide_code=True)
def _(Lens, mo):
    lens = mo.ui.anywidget(Lens())
    lens
    return


@app.cell(hide_code=True)
def _():
    import marimo as mo
    from marimo_lens import Lens
    import polars as pl
    import altair as alt

    alt.renderers.enable("html", embed_options={"renderer": "svg"})
    return Lens, alt, mo, pl


if __name__ == "__main__":
    app.run()
