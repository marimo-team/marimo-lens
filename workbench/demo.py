import marimo

__generated_with = "0.23.6"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _():
    import altair as alt
    import anywidget
    import marimo as mo
    import matplotlib.pyplot as plt
    import pandas as pd
    import plotly.express as px
    import polars as pl
    import traitlets

    from marimo_lens import Lens

    return Lens, alt, anywidget, mo, pd, pl, plt, px, traitlets


@app.cell(hide_code=True)
def _(pd):
    sales = pd.DataFrame(
        {
            "region": [
                "North",
                "North",
                "South",
                "South",
                "West",
                "West",
                "Central",
                "Central",
            ],
            "channel": [
                "Enterprise",
                "Self serve",
                "Enterprise",
                "Partner",
                "Self serve",
                "Partner",
                "Enterprise",
                "Self serve",
            ],
            "quarter": ["Q1", "Q1", "Q2", "Q2", "Q3", "Q3", "Q4", "Q4"],
            "revenue": [142, 88, 117, 109, 94, 130, 156, 101],
            "margin": [0.31, 0.24, 0.29, 0.26, 0.22, 0.28, 0.34, 0.25],
        }
    )
    return (sales,)


@app.cell(hide_code=True)
def _(pl, sales):
    inventory = pl.DataFrame(
        {
            "sku": ["A-100", "B-200", "C-300", "D-400"],
            "category": ["hardware", "software", "hardware", "service"],
            "stock": [12, 7, 22, 4],
            "priority": ["watch", "ok", "ok", "critical"],
        }
    )
    sales_polars = pl.from_pandas(sales)
    return


@app.cell(hide_code=True)
def _(sales):
    summary = (
        sales.groupby(["region", "quarter"], as_index=False)
        .agg(revenue=("revenue", "sum"), margin=("margin", "mean"))
        .sort_values(["quarter", "revenue"], ascending=[True, False])
    )
    return (summary,)


@app.cell(hide_code=True)
def _(mo):
    region_filter = mo.ui.dropdown(
        ["All", "Central", "North", "South", "West"],
        value="All",
        label="Region",
    )
    region_filter
    return (region_filter,)


@app.cell(hide_code=True)
def _(mo):
    revenue_floor = mo.ui.slider(
        0,
        200,
        value=100,
        label="Revenue floor",
        show_value=True,
    )
    revenue_floor
    return (revenue_floor,)


@app.cell(hide_code=True)
def _(mo):
    show_margin = mo.ui.checkbox(value=True, label="Show margin")
    show_margin
    return


@app.cell(hide_code=True)
def _(region_filter, revenue_floor, sales):
    filtered_sales = sales[
        (
            (sales["region"] == region_filter.value)
            if region_filter.value != "All"
            else True
        )
        & (sales["revenue"] >= revenue_floor.value)
    ]
    return (filtered_sales,)


@app.cell(hide_code=True)
def _(filtered_sales):
    filtered_sales
    return


@app.cell(hide_code=True)
def _(mo, sales):
    sales_table = mo.ui.table(sales, label="Sales table", page_size=5)
    sales_table
    return


@app.cell(hide_code=True)
def _(mo, sales):
    sales_dataframe = mo.ui.dataframe(sales, page_size=5)
    sales_dataframe
    return


@app.cell(hide_code=True)
def _(mo, summary):
    summary_editor = mo.ui.data_editor(summary, label="Editable summary")
    summary_editor
    return


@app.cell(hide_code=True)
def _(mo, sales):
    sales_explorer = mo.ui.data_explorer(
        sales,
        x="quarter",
        y="revenue",
        color="region",
    )
    sales_explorer
    return


@app.cell(hide_code=True)
def _(alt, summary):
    altair_chart = (
        alt.Chart(summary)
        .mark_bar(cornerRadiusTopLeft=3, cornerRadiusTopRight=3)
        .encode(
            x=alt.X("quarter:N", title="Quarter"),
            y=alt.Y("revenue:Q", title="Revenue"),
            color=alt.Color("region:N", title="Region"),
            tooltip=["region", "quarter", "revenue", "margin"],
        )
        .properties(height=260)
    )
    altair_chart
    return (altair_chart,)


@app.cell(hide_code=True)
def _(altair_chart, mo):
    altair_widget = mo.ui.altair_chart(altair_chart, label="Altair revenue")
    altair_widget
    return


@app.cell(hide_code=True)
def _(px, summary):
    plotly_figure = px.line(
        summary,
        x="quarter",
        y="revenue",
        color="region",
        markers=True,
        title="Revenue by quarter",
    )
    return (plotly_figure,)


@app.cell(hide_code=True)
def _(mo, plotly_figure):
    plotly_widget = mo.ui.plotly(plotly_figure, label="Plotly revenue")
    plotly_widget
    return


@app.cell(hide_code=True)
def _(plt, summary):
    matplotlib_figure, matplotlib_axes = plt.subplots(figsize=(5.5, 2.7))
    summary.pivot(index="quarter", columns="region", values="revenue").plot.bar(
        ax=matplotlib_axes,
        width=0.72,
    )
    matplotlib_axes.set_title("Matplotlib revenue bars")
    matplotlib_axes.set_ylabel("Revenue")
    matplotlib_axes.legend(loc="upper left", bbox_to_anchor=(1.02, 1))
    matplotlib_figure.tight_layout()
    return (matplotlib_axes,)


@app.cell(hide_code=True)
def _(matplotlib_axes, mo):
    matplotlib_widget = mo.ui.matplotlib(matplotlib_axes)
    matplotlib_widget
    return


@app.cell(hide_code=True)
def _(mo):
    generic_svg_chart = mo.Html(
        """
        <div data-lens-demo="generic-svg">
          <svg role="img" aria-label="Generic SVG revenue chart" viewBox="0 0 520 250" width="100%" height="250">
            <text class="chart-title" x="36" y="28" font-size="15" font-weight="700">Revenue by channel</text>
            <g class="plot-area" transform="translate(56,38)">
              <line class="axis axis-x" x1="0" y1="168" x2="310" y2="168" stroke="currentColor" stroke-opacity="0.35" />
              <line class="axis axis-y" x1="0" y1="0" x2="0" y2="168" stroke="currentColor" stroke-opacity="0.35" />
              <rect class="mark bar" data-channel="Enterprise" data-revenue="415" x="24" y="38" width="52" height="130" rx="3" fill="#17b8a6" />
              <rect class="mark bar" data-channel="Self serve" data-revenue="283" x="126" y="80" width="52" height="88" rx="3" fill="#5aa7ff" />
              <rect class="mark bar" data-channel="Partner" data-revenue="239" x="228" y="94" width="52" height="74" rx="3" fill="#f4b84a" />
              <text class="axis-label" x="50" y="194" text-anchor="middle">Enterprise</text>
              <text class="axis-label" x="152" y="194" text-anchor="middle">Self serve</text>
              <text class="axis-label" x="254" y="194" text-anchor="middle">Partner</text>
            </g>
            <g class="legend" transform="translate(390,74)">
              <rect width="11" height="11" rx="2" fill="#17b8a6" />
              <text x="18" y="10">Enterprise</text>
              <rect y="24" width="11" height="11" rx="2" fill="#5aa7ff" />
              <text x="18" y="34">Self serve</text>
              <rect y="48" width="11" height="11" rx="2" fill="#f4b84a" />
              <text x="18" y="58">Partner</text>
            </g>
          </svg>
        </div>
        """
    )
    generic_svg_chart
    return


@app.cell(hide_code=True)
def _(mo):
    image_output = mo.Html(
        """
        <figure data-lens-demo="media">
          <img alt="Revenue thumbnail" width="360" height="120"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 120'%3E%3Crect width='360' height='120' fill='%23f7fafc'/%3E%3Ccircle cx='70' cy='60' r='34' fill='%2317b8a6'/%3E%3Crect x='128' y='34' width='160' height='18' rx='4' fill='%235aa7ff'/%3E%3Crect x='128' y='68' width='112' height='18' rx='4' fill='%23f4b84a'/%3E%3C/svg%3E" />
        </figure>
        """
    )
    image_output
    return


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
    return


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
              <thead><tr><th>Segment</th><th>Revenue</th><th>Status</th></tr></thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td data-column="segment">${row.segment}</td>
                    <td data-column="revenue">${row.revenue}</td>
                    <td data-column="status">${row.status}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
            <button type="button">Refresh segment</button>
          `;
        }
        export default { render };
        """
        title = traitlets.Unicode("Shadow segment grid").tag(sync=True)
        rows = traitlets.List(
            [
                {"segment": "Enterprise", "revenue": 415, "status": "watch"},
                {"segment": "Self serve", "revenue": 283, "status": "ok"},
                {"segment": "Partner", "revenue": 239, "status": "ok"},
            ]
        ).tag(sync=True)
        columns = traitlets.List(
            [
                {"name": "segment", "dtype": "str"},
                {"name": "revenue", "dtype": "int"},
                {"name": "status", "dtype": "str"},
            ]
        ).tag(sync=True)

    return (ShadowControlWidget,)


@app.cell(hide_code=True)
def _(ShadowControlWidget):
    shadow_widget = ShadowControlWidget()
    shadow_widget
    return


@app.cell(hide_code=True)
def _(ShadowControlWidget, mo):
    wrapped_shadow_widget = mo.ui.anywidget(ShadowControlWidget())
    wrapped_shadow_widget
    return


@app.cell(hide_code=True)
def _(traitlets):
    class ReviewState(traitlets.HasTraits):
        selected_region = traitlets.Unicode("North").tag(sync=True)
        threshold = traitlets.Int(100).tag(sync=True)

    review_state = ReviewState()
    return (review_state,)


@app.cell(hide_code=True)
def _(review_state):
    review_state
    return


@app.cell(hide_code=True)
def _(Lens, mo):
    lens = mo.ui.anywidget(Lens())
    lens
    return (lens,)


@app.cell(hide_code=True)
def _(lens, mo):
    pair_feedback_preview = mo.json(lens.pair_feedback)
    pair_feedback_preview
    return


if __name__ == "__main__":
    app.run()
