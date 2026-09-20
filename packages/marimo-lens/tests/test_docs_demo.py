from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest


@pytest.mark.parametrize(
    "missing", [(), ("starter_chart",), ("starter_revenue", "starter_peak")]
)
def test_quickstart_trail_checks_every_target_before_revealing(
    monkeypatch: pytest.MonkeyPatch, missing: tuple[str, ...]
) -> None:
    import marimo_lens._marimo_runtime as runtime

    names = ("starter_revenue", "starter_chart", "starter_peak")
    snapshot = SimpleNamespace(
        available=True,
        cells=[
            SimpleNamespace(id=f"cell-{name}", defs=(name,))
            for name in names
            if name not in missing
        ],
    )
    monkeypatch.setattr(runtime, "collect_runtime_snapshot", lambda: snapshot)
    calls: list[tuple[list[dict[str, str]], dict[str, object]]] = []

    def reveal(steps: list[dict[str, str]], **kwargs: object) -> None:
        calls.append((steps, kwargs))

    namespace: dict[str, Any] = {
        "mo": SimpleNamespace(
            callout=lambda text, **kwargs: SimpleNamespace(text=text, **kwargs)
        ),
        "starter_walkthrough": SimpleNamespace(value=True),
        "starter_revenue": [{"month": "February", "revenue": 58}],
        "starter_peak": {"month": "February", "revenue": 58},
        "starter_lens": SimpleNamespace(reveal=reveal),
    }
    document = (
        Path(__file__).resolve().parents[3] / "docs/getting-started.md"
    ).read_text(encoding="utf-8")
    blocks = re.findall(r"```python marimo\n(.*?)\n```", document, re.DOTALL)
    code = next(block for block in blocks if "if starter_walkthrough.value:" in block)
    exec(code, namespace)  # noqa: S102 - Exercise the authored docs demo cell.

    feedback = namespace["_starter_feedback"]
    if missing:
        assert calls == []
        assert feedback.kind == "warn"
        assert all(name in feedback.text for name in missing)
        assert "Reload the demo and try again." in feedback.text
    else:
        assert feedback is None
        assert len(calls) == 1
        steps, options = calls[0]
        assert [step["target"] for step in steps] == [f"cell-{name}" for name in names]
        assert all(step["label"] and step["message"] for step in steps)
        assert options == {"duration_ms": None}
