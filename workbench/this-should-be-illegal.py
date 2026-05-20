import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _():
    data_url = "https://raw.githubusercontent.com/demoPlz/mini-template/main/studio/dataset.csv"
    return (data_url,)


@app.cell(hide_code=True)
def _(data_url, pl):
    df = pl.read_csv(data_url)
    df
    return (df,)


@app.cell(hide_code=True)
def _(alt, df):
    chart = (
        alt.Chart(df)
        .mark_point()
        .encode(
            x="AminerCitationCount",
            y="CitationCount_CrossRef",
            color="PaperType",
        )
    )
    chart
    return


@app.cell
def _():
    100
    return


@app.cell
def _(df):
    df.head()
    return


@app.cell
def _(lens):
    lens.pair_prompt
    return


@app.cell(hide_code=True)
def _(mol):
    lens = mol.Lens()
    lens
    return (lens,)


@app.cell(hide_code=True)
def _():
    import polars as pl
    import marimo_lens as mol
    import altair as alt

    return alt, mol, pl


if __name__ == "__main__":
    app.run()
