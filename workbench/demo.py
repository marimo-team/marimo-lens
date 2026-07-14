import marimo

__generated_with = "0.23.14"
app = marimo.App(width="full")


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    intro = mo.md("""
    # marimo-lens selection workbench

    Create point and region selections with the Quiet Puck. Every fixture uses
    the same output-cell path. The page covers text, tables, charts, canvas,
    SVG, layouts, scrollable and oversized outputs, media, iframes, and open
    shadow roots.
    """)
    lens_fixture("intro", intro)
    return


@app.cell
def _(html, mo):
    def lens_fixture(
        name: str,
        value: object,
        *,
        capture_expectation: str = "success",
        visible: bool = True,
    ):
        safe_name = html.escape(name, quote=True)
        safe_expectation = html.escape(capture_expectation, quote=True)
        output_state = "visible" if visible else "hidden"
        hidden_attribute = "" if visible else " hidden"
        body = mo.as_html(value)
        return mo.Html(
            f"""
            <section
              data-lens-fixture="{safe_name}"
              data-lens-capture-expectation="{safe_expectation}"
              data-lens-output-state="{output_state}"
              style="min-width:0;padding:4px 0"
              {hidden_attribute}
            >
              {body}
            </section>
            """
        )

    return (lens_fixture,)


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    region = mo.ui.dropdown(
        ["All", "North", "South", "West"],
        value="All",
        label="Region",
    )
    threshold = mo.ui.slider(
        0,
        100,
        value=20,
        label="Revenue floor",
        show_value=True,
    )
    show_hideable = mo.ui.switch(
        value=True,
        label="Show hideable output",
    )
    controls = mo.vstack(
        [
            mo.md("""
            ## Reactive controls

            Change the region or revenue floor to rerun the text, table, and
            chart outputs. Hide the hideable output after selecting it. Its DAG
            cell stays available, the live marker disappears, and Lens keeps
            the cell reference and capture-time image.
            """),
            mo.hstack(
                [region, threshold, show_hideable],
                justify="start",
                wrap=True,
                gap=2,
            ),
        ],
        gap=1,
    )
    lens_fixture("controls", controls)
    return region, show_hideable, threshold


@app.cell(hide_code=True)
def _(pl):
    sales = pl.DataFrame(
        {
            "month": ["Jan", "Feb", "Mar", "Apr"] * 3,
            "region": ["North"] * 4 + ["South"] * 4 + ["West"] * 4,
            "revenue": [42, 58, 67, 76, 35, 48, 62, 71, 28, 39, 55, 68],
            "orders": [9, 12, 14, 16, 7, 10, 13, 15, 6, 8, 11, 14],
        }
    )
    return (sales,)


@app.cell(hide_code=True)
def _(region, sales, threshold):
    filtered_sales = sales.filter(sales["revenue"] >= threshold.value)
    if region.value != "All":
        filtered_sales = filtered_sales.filter(filtered_sales["region"] == region.value)
    return (filtered_sales,)


@app.cell(hide_code=True)
def _(filtered_sales, lens_fixture, mo, region, threshold):
    text_output = mo.md(
        f"""
        ## Text summary

        **{filtered_sales.height} rows** match region **{region.value}** at a
        revenue floor of **{threshold.value}**. Select a word, a number, or an
        empty part of this output.
        """
    )
    lens_fixture("text", text_output)
    return


@app.cell(hide_code=True)
def _(filtered_sales, lens_fixture, mo):
    sales_table = mo.ui.table(
        filtered_sales,
        label="Monthly sales",
        page_size=6,
    )
    table_output = mo.vstack(
        [
            mo.md("""
            ## Table

            Capture a header, a body cell, or a rectangle across several rows.
            """),
            sales_table,
        ]
    )
    lens_fixture("table", table_output)
    return


@app.cell(hide_code=True)
def _(alt, filtered_sales, lens_fixture, mo):
    altair_chart = (
        alt.Chart(filtered_sales)
        .mark_bar(cornerRadiusTopLeft=3, cornerRadiusTopRight=3)
        .encode(
            x=alt.X("month:N", title="Month"),
            y=alt.Y("revenue:Q", title="Revenue"),
            color=alt.Color("region:N", title="Region"),
            tooltip=["month", "region", "revenue", "orders"],
        )
        .properties(title="Altair revenue", height=260)
    )
    altair_output = mo.vstack(
        [mo.md("## Altair"), altair_chart],
        gap=1,
    )
    lens_fixture("altair", altair_output)
    return


@app.cell(hide_code=True)
def _(filtered_sales, lens_fixture, mo, px):
    plotly_chart = px.line(
        filtered_sales,
        x="month",
        y="revenue",
        color="region",
        markers=True,
        title="Plotly revenue",
    )
    plotly_output = mo.vstack(
        [mo.md("## Plotly"), plotly_chart],
        gap=1,
    )
    lens_fixture("plotly", plotly_output)
    return


@app.cell(hide_code=True)
def _(filtered_sales, lens_fixture, mo, plt):
    _rows = filtered_sales.to_dicts()
    matplotlib_figure, matplotlib_axes = plt.subplots(figsize=(6.0, 2.8))
    matplotlib_axes.scatter(
        [_row["orders"] for _row in _rows],
        [_row["revenue"] for _row in _rows],
        color="#2563eb",
    )
    matplotlib_axes.set_title("Matplotlib orders and revenue")
    matplotlib_axes.set_xlabel("Orders")
    matplotlib_axes.set_ylabel("Revenue")
    matplotlib_figure.tight_layout()
    matplotlib_chart = mo.ui.matplotlib(matplotlib_axes)
    matplotlib_output = mo.vstack(
        [mo.md("## Matplotlib"), matplotlib_chart],
        gap=1,
    )
    lens_fixture("matplotlib", matplotlib_output)
    return


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    generic_svg = mo.Html(
        """
        <svg role="img" aria-label="Generic quarterly revenue chart"
             viewBox="0 0 680 250" width="100%" height="250"
             data-lens-fixture-content="svg">
          <text x="30" y="28" font-size="16" font-weight="700">Generic SVG revenue</text>
          <g transform="translate(54,48)">
            <line x1="0" y1="150" x2="440" y2="150" stroke="currentColor" opacity="0.35"/>
            <line x1="0" y1="0" x2="0" y2="150" stroke="currentColor" opacity="0.35"/>
            <rect x="34" y="82" width="62" height="68" rx="4" fill="#2563eb"/>
            <rect x="144" y="48" width="62" height="102" rx="4" fill="#0d9488"/>
            <rect x="254" y="25" width="62" height="125" rx="4" fill="#d97706"/>
            <rect x="364" y="5" width="62" height="145" rx="4" fill="#7c3aed"/>
            <text x="65" y="174" text-anchor="middle">Q1</text>
            <text x="175" y="174" text-anchor="middle">Q2</text>
            <text x="285" y="174" text-anchor="middle">Q3</text>
            <text x="395" y="174" text-anchor="middle">Q4</text>
          </g>
          <g transform="translate(540,70)">
            <circle cx="0" cy="0" r="6" fill="#2563eb"/>
            <text x="14" y="5">Revenue</text>
          </g>
        </svg>
        """
    )
    svg_output = mo.vstack(
        [mo.md("## Generic SVG"), generic_svg],
        gap=1,
    )
    lens_fixture("svg", svg_output)
    return


@app.cell(hide_code=True)
def _(anywidget):
    class CanvasOutput(anywidget.AnyWidget):
        _esm = """
        function render({ el }) {
          const canvas = document.createElement("canvas");
          canvas.width = 680;
          canvas.height = 240;
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", "Canvas revenue trend");
          canvas.dataset.lensFixtureContent = "canvas";
          canvas.style.width = "min(100%, 680px)";
          canvas.style.height = "240px";
          const context = canvas.getContext("2d");
          context.fillStyle = "#f8fafc";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "#0f172a";
          context.font = "700 18px system-ui";
          context.fillText("Canvas revenue trend", 28, 34);
          context.strokeStyle = "#2563eb";
          context.lineWidth = 5;
          context.beginPath();
          context.moveTo(52, 184);
          context.bezierCurveTo(180, 170, 260, 86, 370, 112);
          context.bezierCurveTo(470, 134, 535, 52, 630, 62);
          context.stroke();
          context.fillStyle = "#2563eb";
          for (const [x, y] of [[52, 184], [210, 130], [370, 112], [520, 78], [630, 62]]) {
            context.beginPath();
            context.arc(x, y, 7, 0, Math.PI * 2);
            context.fill();
          }
          el.replaceChildren(canvas);
        }
        export default { render };
        """

    return (CanvasOutput,)


@app.cell(hide_code=True)
def _(CanvasOutput, lens_fixture, mo):
    canvas_widget = mo.ui.anywidget(CanvasOutput())
    canvas_output = mo.vstack(
        [mo.md("## Generic canvas"), canvas_widget],
        gap=1,
    )
    lens_fixture("canvas", canvas_output)
    return


@app.cell(hide_code=True)
def _(anywidget, traitlets):
    class ShadowOutput(anywidget.AnyWidget):
        _esm = """
        function render({ model, el }) {
          const root = el.shadowRoot || el.attachShadow({ mode: "open" });
          const rows = model.get("rows");
          root.innerHTML = `
            <style>
              :host { color: CanvasText; font: 14px system-ui; }
              table { border-collapse: collapse; width: min(100%, 620px); }
              th, td { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 7px 10px; text-align: left; }
            </style>
            <table role="grid" aria-label="Shadow root sales grid"
                   data-lens-fixture-content="shadow-root">
              <thead><tr><th>Region</th><th>Revenue</th><th>Status</th></tr></thead>
              <tbody>${rows.map((row) => `<tr><td>${row.region}</td><td>${row.revenue}</td><td>${row.status}</td></tr>`).join("")}</tbody>
            </table>
          `;
        }
        export default { render };
        """
        rows = traitlets.List().tag(sync=True)

    return (ShadowOutput,)


@app.cell(hide_code=True)
def _(ShadowOutput, lens_fixture, mo):
    shadow_widget = mo.ui.anywidget(
        ShadowOutput(
            rows=[
                {"region": "North", "revenue": 76, "status": "ahead"},
                {"region": "South", "revenue": 71, "status": "steady"},
                {"region": "West", "revenue": 68, "status": "watch"},
            ]
        )
    )
    shadow_output = mo.vstack(
        [mo.md("## Open shadow root"), shadow_widget],
        gap=1,
    )
    lens_fixture("shadow-root", shadow_output)
    return


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    nested_layout = mo.hstack(
        [
            mo.Html(
                '<section data-lens-fixture-content="layout-left" '
                'style="padding:18px;border:1px solid #94a3b8">'
                "<strong>North</strong><p>76 revenue</p></section>"
            ),
            mo.vstack(
                [
                    mo.Html(
                        '<section data-lens-fixture-content="layout-top" '
                        'style="padding:12px;border:1px solid #94a3b8">'
                        "<strong>South</strong></section>"
                    ),
                    mo.Html(
                        '<section data-lens-fixture-content="layout-bottom" '
                        'style="padding:12px;border:1px solid #94a3b8">'
                        "<strong>West</strong></section>"
                    ),
                ],
                gap=1,
            ),
        ],
        gap=1,
        widths="equal",
    )
    nested_output = mo.vstack(
        [mo.md("## Nested layout"), nested_layout],
        gap=1,
    )
    lens_fixture("nested-layout", nested_output)
    return


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    _items = "".join(
        f'<li data-lens-scroll-record="{_index:02d}" '
        'style="padding:7px 10px;border-bottom:1px solid #cbd5e1">'
        f"Record {_index:02d}: revenue {_index * 7}</li>"
        for _index in range(1, 41)
    )
    scroll_content = mo.Html(
        f"""
        <section data-lens-fixture-content="scroll">
          <ol style="max-height:220px;overflow:auto;margin:0;padding:0 0 0 34px;border:1px solid #94a3b8">
            {_items}
          </ol>
        </section>
        """
    )
    scroll_output = mo.vstack(
        [
            mo.md("""
            ## Scrollable content

            Scroll inside the list, then annotate a record near the bottom.
            """),
            scroll_content,
        ],
        gap=1,
    )
    lens_fixture("scroll", scroll_output)
    return


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    oversized_content = mo.Html(
        """
        <section
          data-lens-fixture-content="oversized-output"
          style="position:relative;box-sizing:border-box;width:2304px;height:720px;padding:32px;background:#f8fafc;color:#0f172a;border:1px solid #94a3b8"
        >
          <header style="display:flex;align-items:end;justify-content:space-between;border-bottom:1px solid #cbd5e1;padding-bottom:20px">
            <div>
              <p style="margin:0 0 8px;color:#475569;font:600 13px system-ui;text-transform:uppercase;letter-spacing:0.06em">Regional performance</p>
              <h3 style="margin:0;font:700 28px system-ui">Annual revenue overview</h3>
            </div>
            <p style="margin:0;color:#475569;font:14px system-ui">2,304 px wide capture surface</p>
          </header>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:32px">
            <article style="padding:24px;border:1px solid #cbd5e1;background:#ffffff">
              <strong style="font:600 15px system-ui">North</strong>
              <p style="margin:18px 0 0;font:700 32px system-ui">$1.82M</p>
            </article>
            <article style="padding:24px;border:1px solid #cbd5e1;background:#ffffff">
              <strong style="font:600 15px system-ui">South</strong>
              <p style="margin:18px 0 0;font:700 32px system-ui">$1.47M</p>
            </article>
            <article style="padding:24px;border:1px solid #cbd5e1;background:#ffffff">
              <strong style="font:600 15px system-ui">West</strong>
              <p style="margin:18px 0 0;font:700 32px system-ui">$1.31M</p>
            </article>
            <article style="padding:24px;border:1px solid #cbd5e1;background:#ffffff">
              <strong style="font:600 15px system-ui">Central</strong>
              <p style="margin:18px 0 0;font:700 32px system-ui">$1.68M</p>
            </article>
          </div>
          <div style="position:absolute;left:32px;right:32px;bottom:32px;height:360px;border:1px solid #cbd5e1;background:#ffffff">
            <svg aria-label="Oversized annual revenue chart" role="img" viewBox="0 0 2238 360" width="2238" height="360">
              <line x1="90" y1="300" x2="2160" y2="300" stroke="#94a3b8" />
              <line x1="90" y1="70" x2="90" y2="300" stroke="#94a3b8" />
              <path d="M100 270 C420 255 520 175 790 205 S1210 115 1490 150 S1830 55 2140 78" fill="none" stroke="#2563eb" stroke-width="8" />
              <circle cx="790" cy="205" r="12" fill="#2563eb" />
              <circle cx="1490" cy="150" r="12" fill="#2563eb" />
              <circle cx="2140" cy="78" r="12" fill="#2563eb" />
              <text x="90" y="332" fill="#475569" font-family="system-ui" font-size="18">January</text>
              <text x="1030" y="332" fill="#475569" font-family="system-ui" font-size="18">June</text>
              <text x="2070" y="332" fill="#475569" font-family="system-ui" font-size="18">December</text>
            </svg>
            <article
              data-lens-oversized-detail="target"
              style="position:absolute;left:1570px;top:92px;box-sizing:border-box;width:420px;height:170px;padding:22px;background:#eff6ff;border:1px solid #60a5fa;color:#172554"
            >
              <strong style="font:700 16px system-ui">December detail</strong>
              <p style="margin:14px 0 0;font:15px/1.5 system-ui">Revenue reached $1.82M after the enterprise renewal cycle.</p>
            </article>
          </div>
        </section>
        """
    )
    oversized_output = mo.vstack(
        [
            mo.md("""
            ## Oversized output

            Select the December detail card. The full output crosses the 2,048
            px edge limit, so the image contains a scaled overview and a
            focused detail region.
            """),
            oversized_content,
        ],
        gap=1,
    )
    lens_fixture("oversized-output", oversized_output)
    return


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    media_content = mo.Html(
        """
        <figure data-lens-fixture-content="media" style="margin:0">
          <img alt="Revenue status illustration" width="520" height="160"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 520 160'%3E%3Crect width='520' height='160' rx='12' fill='%23f8fafc'/%3E%3Ccircle cx='92' cy='80' r='48' fill='%232563eb'/%3E%3Crect x='176' y='42' width='260' height='24' rx='6' fill='%230d9488'/%3E%3Crect x='176' y='92' width='184' height='24' rx='6' fill='%23d97706'/%3E%3C/svg%3E" />
        </figure>
        """
    )
    media_output = mo.vstack(
        [mo.md("## Media"), media_content],
        gap=1,
    )
    lens_fixture("media", media_output)
    return


@app.cell(hide_code=True)
def _(lens_fixture, mo, show_hideable):
    _output_visibility_style = mo.Html("""
    <style data-lens-output-visibility-style>
      [id^="output-"]:has(
        [data-lens-fixture="hideable-output"][data-lens-output-state="hidden"]
      ) {
        display: none !important;
      }
    </style>
    """)
    hideable_output = mo.vstack(
        [
            _output_visibility_style,
            lens_fixture(
                "hideable-output",
                mo.md("""
                ## Hideable output

                Select this sentence, then turn off **Show hideable output**.
                The output root becomes hidden while Lens keeps the selection
                and its capture-time image.
                """),
                visible=show_hideable.value,
            ),
        ],
        gap=0,
    )
    hideable_output
    return


@app.cell(hide_code=True)
def _(html, lens_fixture, mo):
    _same_origin_document = """
    <!doctype html>
    <html lang="en">
      <body style="font:14px system-ui;margin:0;padding:20px;background:#f8fafc;color:#0f172a">
        <h2 style="margin:0 0 12px">Same-origin iframe</h2>
        <table style="border-collapse:collapse">
          <tr><th style="border:1px solid #94a3b8;padding:8px">Region</th><th style="border:1px solid #94a3b8;padding:8px">Revenue</th></tr>
          <tr><td style="border:1px solid #94a3b8;padding:8px">North</td><td style="border:1px solid #94a3b8;padding:8px">76</td></tr>
        </table>
      </body>
    </html>
    """
    same_origin_frame = mo.Html(
        f"""
        <iframe data-lens-iframe="same-origin" title="Same-origin capture fixture"
          srcdoc="{html.escape(_same_origin_document, quote=True)}"
          style="width:100%;height:220px;border:1px solid #94a3b8"></iframe>
        """
    )
    same_origin_output = mo.vstack(
        [mo.md("## Same-origin iframe"), same_origin_frame],
        gap=1,
    )
    lens_fixture("same-origin-iframe", same_origin_output)
    return


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    external_frame = mo.Html(
        """
        <iframe data-lens-iframe="external" title="External capture boundary"
          src="https://example.com" loading="eager"
          style="width:100%;height:220px;border:1px solid #94a3b8"></iframe>
        """
    )
    external_output = mo.vstack(
        [
            mo.md("""
            ## External iframe

            Selecting this output exercises the explicit snapshot-failure
            state while preserving the cell reference and notebook provenance.
            """),
            external_frame,
        ],
        gap=1,
    )
    lens_fixture(
        "external-iframe",
        external_output,
        capture_expectation="failure",
    )
    return


@app.cell(hide_code=True)
def _(Lens, mo):
    lens = mo.ui.anywidget(Lens())
    lens
    return (lens,)


@app.cell(hide_code=True)
def _(lens_fixture, mo):
    read_context = mo.ui.run_button(label="Read context in Python")
    verifier_control = mo.vstack(
        [
            mo.md("""
            ## Python context verifier

            Create selections, then read one detached `LensContext` snapshot.
            """),
            read_context,
        ],
        gap=1,
    )
    lens_fixture("context-control", verifier_control)
    return (read_context,)


@app.cell(hide_code=True)
def _(lens, read_context):
    context = lens.context() if read_context.value else None
    return (context,)


@app.cell
def _(hashlib, html, io, json, mo):
    def render_context_verifier(context):
        if context is None:
            waiting = {
                "state": "waiting",
                "action": "Create selections and press Read context in Python.",
            }
            return mo.Html(
                '<section data-lens-context-summary="waiting">'
                "<h3>Lens context</h3>"
                f"<pre>{html.escape(json.dumps(waiting, indent=2))}</pre>"
                "</section>"
            )

        references = context.references
        selections = references.get("selections", [])
        labels_by_selection_id = {}
        selection_evidence = []
        for _selection in selections:
            _selection_id = str(_selection.get("id", ""))
            _selection_label = str(_selection.get("label", ""))
            if _selection_id and _selection_label:
                labels_by_selection_id[_selection_id] = _selection_label
            _snapshot = _selection.get("snapshot")
            selection_evidence.append(
                {
                    "label": _selection_label,
                    "note": str(_selection.get("note", "")),
                    "outputCellId": str(_selection.get("outputCellId", "")),
                    "cellStatus": str(_selection.get("cellStatus", "")),
                    "anchor": _selection.get("anchor"),
                    "domHint": _selection.get("domHint"),
                    "snapshotStatus": (
                        str(_snapshot.get("status", "failed"))
                        if isinstance(_snapshot, dict)
                        else "failed"
                    ),
                }
            )

        labels = [str(_selection.get("label", "")) for _selection in selections]
        image_checks = []
        rendered_images = []
        for _image in context.images:
            _data = _image.data
            _signature_ok = _data[:8] == b"\x89PNG\r\n\x1a\n"
            _computed_sha = hashlib.sha256(_data).hexdigest()
            _dimensions = (
                {
                    "width": int.from_bytes(_data[16:20], "big"),
                    "height": int.from_bytes(_data[20:24], "big"),
                }
                if _signature_ok and len(_data) >= 24 and _data[12:16] == b"IHDR"
                else None
            )
            _declared_dimensions = {
                "width": _image.width,
                "height": _image.height,
            }
            image_checks.append(
                {
                    "id": _image.id,
                    "selectionId": _image.selection_id,
                    "outdated": _image.outdated,
                    "pngSignature": _signature_ok,
                    "byteLength": len(_data),
                    "computedSha256": _computed_sha,
                    "declaredSha256": _image.sha256,
                    "shaMatches": _computed_sha == _image.sha256,
                    "computedDimensions": _dimensions,
                    "declaredDimensions": _declared_dimensions,
                    "dimensionsMatch": _dimensions == _declared_dimensions,
                }
            )
            _rendered_image = mo.image(
                io.BytesIO(_data),
                alt=f"Selection evidence {_image.id}",
                width="100%",
            )
            _label = labels_by_selection_id.get(
                _image.selection_id,
                _image.selection_id,
            )
            _safe_label = html.escape(_label, quote=True)
            _safe_id = html.escape(_image.id, quote=True)
            rendered_images.append(
                mo.Html(
                    f"""
                    <figure data-lens-context-image="{_safe_label}" data-lens-context-image-id="{_safe_id}" style="margin:16px 0">
                      {_rendered_image}
                      <figcaption>{_safe_id}: {len(_data)} bytes</figcaption>
                    </figure>
                    """
                )
            )

        summary = {
            "state": "ready",
            "protocol": references.get("protocol"),
            "version": references.get("version"),
            "revision": references.get("revision"),
            "currentSelectionId": references.get("currentSelectionId"),
            "current": context.current,
            "selectionCount": len(selections),
            "imageCount": len(context.images),
            "selectionEvidence": selection_evidence,
            "referencesBytes": len(
                json.dumps(
                    references,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            ),
            "textCharacters": len(context.text),
            "referenceKeys": list(references),
            "textLabels": [
                _label for _label in labels if _label and _label in context.text
            ],
            "textContainsAllLabels": all(
                _label in context.text for _label in labels if _label
            ),
            "images": image_checks,
        }
        summary_output = mo.Html(
            '<section data-lens-context-summary="ready">'
            "<h3>Lens context</h3>"
            f"<pre>{html.escape(json.dumps(summary, indent=2))}</pre>"
            "</section>"
        )
        return mo.vstack([summary_output, *rendered_images], gap=1)

    return (render_context_verifier,)


@app.cell(hide_code=True)
def _(context, render_context_verifier):
    render_context_verifier(context)
    return


@app.cell(hide_code=True)
def _():
    import hashlib
    import html
    import io
    import json

    import altair as alt
    import anywidget
    import marimo as mo
    import matplotlib.pyplot as plt
    import plotly.express as px
    import polars as pl
    import traitlets

    from marimo_lens import Lens

    return (
        Lens,
        alt,
        anywidget,
        hashlib,
        html,
        io,
        json,
        mo,
        pl,
        plt,
        px,
        traitlets,
    )


if __name__ == "__main__":
    app.run()
