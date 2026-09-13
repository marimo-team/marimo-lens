# /// script
# [tool.marimo.language_servers]
# pylsp = { enabled = false }
# basedpyright = { enabled = false }
# ty = { enabled = false }
# pyrefly = { enabled = false }
# ///

import marimo

__generated_with = "0.24.0"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import html
    import json
    import time

    import marimo as mo
    from marimo_lens import Lens, LensError

    return Lens, LensError, html, json, mo, time


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    # Regional revenue
    """)


@app.cell(hide_code=True)
def _(mo):
    target_mode = mo.ui.dropdown(
        ["Notebook outputs", "DOM roots"], value="Notebook outputs", label="Target mode"
    )
    show_revenue = mo.ui.checkbox(value=True, label="Show revenue")
    mo.hstack([target_mode, show_revenue], justify="start", wrap=True)
    return show_revenue, target_mode


@app.cell(hide_code=True)
def _(mo, workload):
    mo.Html(
        '<section aria-label="Streaming table" style="max-height:120px;overflow:auto">'
        '<span id="stream-tick">0</span><table>'
        + "".join(
            "<tr>"
            + "".join(f"<td>{_row * 8 + _col}</td>" for _col in range(8))
            + "</tr>"
            for _row in range(int(workload.value))
        )
        + "</table></section>"
    )


@app.cell(hide_code=True)
def _(mo, show_revenue):
    mo.stop(not show_revenue.value)
    mo.Html(
        """
        <section id="revenue-chart" aria-label="Revenue by month"
          style="display:grid;gap:16px;padding:20px;border:1px solid currentColor">
          <strong>Revenue by month</strong>
          <div style="display:flex;gap:12px;align-items:center">
            <span>January</span>
            <span style="width:30%;height:24px;background:#0880ea"></span>
            <span>42</span>
          </div>
          <div style="display:flex;gap:12px;align-items:center">
            <span>February</span>
            <span style="width:45%;height:24px;background:#0880ea"></span>
            <span>58</span>
          </div>
          <div style="display:flex;gap:12px;align-items:center">
            <span>March</span>
            <span style="width:55%;height:24px;background:#0880ea"></span>
            <span>67</span>
          </div>
        </section>
        """
    )


@app.cell(hide_code=True)
def _(Lens, target_mode):
    lens = Lens(
        dom_selector='[aria-label="Revenue by month"]'
        if target_mode.value == "DOM roots"
        else None
    )
    activity = {}
    return activity, lens


@app.cell(hide_code=True)
def _(mo):
    views = mo.ui.dropdown(
        ["Single", "Duplicate", "Hidden"], value="Single", label="Lens views"
    )
    workload = mo.ui.dropdown(["0", "1000"], value="0", label="Table rows")
    mo.hstack([views, workload], justify="start", wrap=True)
    return views, workload


@app.cell(hide_code=True)
def _(lens, mo, views):
    mo.stop(views.value == "Hidden")
    mo.output.replace(mo.vstack([lens, lens]) if views.value == "Duplicate" else lens)


@app.cell(hide_code=True)
def _(mo):
    action = mo.ui.dropdown(
        [
            "Inspect context",
            "Start activity",
            "Stop activity",
            "Reveal",
            "Resolve",
            "Remember revision",
            "Resolve remembered",
            "Resolve unknown",
        ],
        value="Inspect context",
        label="Agent action",
    )
    execute = mo.ui.run_button(label="Run agent action")
    mo.hstack([action, execute], justify="start", wrap=True)
    return action, execute


@app.cell(hide_code=True)
def _(LensError, action, activity, execute, html, json, lens, mo, time):
    mo.stop(not execute.value)
    _context = lens.context()
    _references = _context.references
    _selections = _references["selections"]
    _error = None
    if action.value == "Start activity":
        activity["handle"] = lens.start_activity(
            _selections[0],
            expected_revision=_references["revision"],
            message="Checking monthly revenue",
        )
    elif action.value == "Stop activity":
        lens.stop_activity(activity["handle"])
    elif action.value == "Reveal":
        lens.reveal(
            _selections[0],
            expected_revision=_references["revision"],
            duration_ms=10_000,
            message="Compare these months",
        )
    elif action.value == "Resolve":
        lens.resolve(
            [_selection["id"] for _selection in _selections],
            expected_revision=_references["revision"],
            summary="Checked the revenue totals",
        )
    elif action.value == "Remember revision":
        activity["revision"] = _references["revision"]
    elif action.value in {"Resolve remembered", "Resolve unknown"}:
        try:
            lens.resolve(
                [_selection["id"] for _selection in _selections]
                + (["missing-selection"] if action.value == "Resolve unknown" else []),
                expected_revision=activity["revision"]
                if action.value == "Resolve remembered"
                else _references["revision"],
            )
        except LensError as _caught:
            _error = {"code": _caught.code, "revision": _caught.revision}
    _started = time.perf_counter()
    _result = lens.context()
    _text = _result.text
    _elapsed_ms = (time.perf_counter() - _started) * 1000
    activity["sequence"] = activity.get("sequence", 0) + 1
    _report = {
        "action": action.value,
        "sequence": activity["sequence"],
        "error": _error,
        "context_ms": _elapsed_ms,
        "references": _result.references,
        "images": {
            _key: {"bytes": len(_image), "signature": _image[:8].hex()}
            for _key, _image in _result.images.items()
        },
        "text": _text,
    }
    mo.Html(
        '<pre aria-label="Agent result" style="max-height:160px;overflow:auto">'
        + html.escape(json.dumps(_report))
        + "</pre>"
    )


if __name__ == "__main__":
    app.run()
