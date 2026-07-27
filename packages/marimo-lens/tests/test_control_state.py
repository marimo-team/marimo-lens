from __future__ import annotations

import base64
import datetime as dt
from collections.abc import Iterator, Mapping
from types import SimpleNamespace
from typing import Any

import anywidget
import pytest
import traitlets
from marimo_lens._context import build_context
from marimo_lens._control_state import (
    RuntimeControl,
    _safe_value,
    serialize_controls,
)
from marimo_lens._marimo_runtime import collect_runtime_snapshot

from tests.support.factories import selection


class _TrackingWidget(anywidget.AnyWidget):
    _esm = "export default { render() {} };"

    secret = traitlets.Unicode("unrelated-secret").tag(sync=True)

    def __init__(self) -> None:
        self.state_reads = 0
        super().__init__()

    def get_state(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        self.state_reads += 1
        return super().get_state(*args, **kwargs)


def test_composite_child_getters_are_not_inspected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    control = _ExplosiveCompositeControl("private-before")
    context = _control_context("composite", control)
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))
    _references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert runtime.controls[0].value is None
    assert runtime.controls[0].sensitive is True
    assert runtime.controls[0].complete is False
    assert control.elements_reads == 0
    assert "private-before" not in text
    assert "[redacted]" in text


def test_custom_ui_scalar_is_opaque_and_never_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    control = _CustomScalarControl("wire-secret")
    context = _control_context("custom", control)
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))
    _references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert runtime.controls[0].value is None
    assert runtime.controls[0].sensitive is True
    assert runtime.controls[0].complete is False
    assert control.frontend_reads == 0
    assert "wire-secret" not in text
    assert "[redacted]" in text


def test_control_never_falls_back_to_arbitrary_backend_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    control = _BackendOnlyControl("backend-only-secret")
    context = _control_context("token", control)
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot()
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )
    packet = str(runtime.controls) + str(references) + text

    assert runtime.controls[0].value is None
    assert runtime.controls[0].complete is False
    assert runtime.controls[0].sensitive is True
    assert "backend-only-secret" not in packet
    assert "[redacted]" in text


def test_frontend_sanitization_failure_marks_control_opaque(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._marimo_control_state as control_state_module

    control = _ExplodingFrontendControl()
    context = _control_context("date", control)
    _install_context(monkeypatch, context)
    monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)

    runtime = collect_runtime_snapshot(("cell-view",))

    assert runtime.available is True
    assert len(runtime.controls) == 1
    assert runtime.controls[0].value is None
    assert runtime.controls[0].sensitive is True
    assert runtime.controls[0].complete is False


def test_native_date_range_is_canonical_in_current_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    period = mo.ui.date_range(
        start="2025-01-01",
        stop="2026-12-31",
        value=("2025-01-01", "2025-12-31"),
        label="Period",
    )
    context = _control_context("period", period)
    _install_context(monkeypatch, context)

    period._update(("2026-01-01", "2026-12-31"))
    runtime = collect_runtime_snapshot()
    control = runtime.controls[0]
    _references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert control.value == ["2026-01-01", "2026-12-31"]
    assert control.complete is True
    assert control.sensitive is False
    assert '["2026-01-01","2026-12-31"]' in text


def test_native_tabs_retains_safe_scalar_frontend_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    tabs = mo.ui.tabs(
        {"Austria": "A", "Germany": "G"},
        value="Austria",
        label="Country",
    )
    context = _control_context("tabs", tabs)
    _install_context(monkeypatch, context)

    tabs._update("1")
    runtime = collect_runtime_snapshot(("cell-view",))
    _references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert runtime.controls[0].value == "1"
    assert runtime.controls[0].sensitive is False
    assert "`tabs`" in text
    assert 'value: "1"' in text


def test_native_control_uses_safe_frontend_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    country = mo.ui.dropdown(
        {
            "Production": {"token": "backend-token-before"},
            "Staging": {"token": "backend-token-after"},
        },
        value="Production",
        label="Environment",
    )
    context = _control_context("country", country)
    _install_context(monkeypatch, context)

    country._update(["Staging"])
    runtime = collect_runtime_snapshot()
    _references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert runtime.controls[0].value == ["Staging"]
    assert runtime.controls[0].sensitive is False
    assert "backend-token-before" not in text
    assert "backend-token-after" not in text
    assert '["Staging"]' in text


def test_password_control_is_redacted_from_current_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    password = mo.ui.text(
        value="password-before",
        kind="password",
        label="API token",
    )
    context = _control_context("token", password)
    _install_context(monkeypatch, context)

    password._update("password-after")
    runtime = collect_runtime_snapshot()
    control = runtime.controls[0]
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )
    packet = str(references) + text

    assert control.value is None
    assert control.sensitive is True
    assert "password-after" not in packet
    assert "[redacted]" in text


def test_fresh_password_backend_value_is_not_exposed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    password = mo.ui.text(value="secret-a", kind="password")
    assert password._value_frontend == ""

    _install_context(monkeypatch, _control_context("token", password))
    runtime = collect_runtime_snapshot(("cell-view",))
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )
    packet = repr(runtime.controls) + repr(references) + text

    assert "secret-a" not in packet
    assert "[redacted]" in text


def test_nested_initial_passwords_are_opaque(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    passwords = mo.ui.array([mo.ui.text(value="nested-secret-a", kind="password")])
    assert passwords._value_frontend == {"0": ""}

    _install_context(monkeypatch, _control_context("tokens", passwords))
    runtime = collect_runtime_snapshot(("cell-view",))
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )
    packet = repr(runtime.controls) + repr(references) + text

    assert runtime.controls[0].complete is False
    assert "nested-secret-a" not in packet
    assert "[redacted]" in text


def test_composite_password_controls_are_opaque(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    password_array = mo.ui.array([mo.ui.text(kind="password")])
    password_form = mo.ui.text(kind="password").form()
    password_array._update({"0": "array-secret-before"})
    password_form._update("form-secret-before")
    context = SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-control": _cell(
                    "password_array, password_form = controls()",
                    defs={"password_array", "password_form"},
                ),
                "cell-view": _cell(
                    "render(password_array.value, password_form.value)",
                    refs={"password_array", "password_form"},
                ),
            },
            definitions={
                "password_array": {"cell-control"},
                "password_form": {"cell-control"},
            },
            parents={
                "cell-control": set(),
                "cell-view": {"cell-control"},
            },
        ),
        globals={
            "password_array": password_array,
            "password_form": password_form,
        },
        filename="demo.py",
        cell_id="cell-lens",
    )
    _install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot()
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )
    packet = str(runtime.controls) + str(references) + text

    assert all(control.value is None for control in runtime.controls)
    assert all(control.sensitive for control in runtime.controls)
    for secret in (
        "array-secret-before",
        "form-secret-before",
    ):
        assert secret not in packet
    assert text.count("[redacted]") == 2


def test_anywidget_state_is_opaque_and_never_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    widget = _TrackingWidget()
    baseline_reads = widget.state_reads
    context = _control_context("widget", widget)
    _install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot()
    assert widget.state_reads == baseline_reads
    control = runtime.controls[0]
    references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )
    packet = str(references) + text

    assert control.value is None
    assert control.sensitive is True
    assert control.complete is False
    assert "unrelated-secret" not in packet
    assert "[redacted]" in text


def test_file_control_contents_never_enter_text_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo as mo

    upload = mo.ui.file(label="Upload")
    encoded_before = base64.b64encode(b"private-before").decode()
    upload._update([("private-before.txt", encoded_before)])
    context = _control_context("upload", upload)
    _install_context(monkeypatch, context)

    runtime = collect_runtime_snapshot()
    control = runtime.controls[0]
    _references, text = build_context(
        runtime,
        [selection()],
        revision=1,
        current_selection_id="selection-1",
    )

    assert control.value is None
    assert control.sensitive is True
    for secret in (
        "private-before",
        "private-before.txt",
        encoded_before,
    ):
        assert secret not in text
    assert "[redacted]" in text


def test_safe_value_stops_iterating_after_the_item_limit() -> None:
    value = _CountingMapping()

    result = _safe_value(value)

    assert value.items_visited == 21
    assert result["..."] == "more items omitted"


def test_safe_value_does_not_treat_shared_values_as_cycles() -> None:
    shared = {"value": 3}

    result = _safe_value([shared, shared])

    assert result == [{"value": 3}, {"value": 3}]


def test_control_mapping_serialization_is_canonical() -> None:
    first = serialize_controls((_runtime_control({"b": 2, "a": 1}),))
    second = serialize_controls((_runtime_control({"a": 1, "b": 2}),))

    assert first.controls[0].value == {"a": 1, "b": 2}
    assert first.controls[0].value == second.controls[0].value
    assert first.control_complete == (True,)
    assert first.state_complete is True
    assert second.state_complete is True


@pytest.mark.parametrize(
    "value",
    [
        float("nan"),
        {1: "one"},
        {"Austria", "Germany"},
    ],
)
def test_control_serialization_marks_lossy_values_incomplete(value: object) -> None:
    serialized = serialize_controls((_runtime_control(value),))

    assert serialized.control_complete == (False,)
    assert serialized.state_complete is False


def test_control_tuple_serialization_is_canonical() -> None:
    serialized = serialize_controls((_runtime_control(("2025-01-01", "2025-12-31")),))

    assert serialized.controls[0].value == ["2025-01-01", "2025-12-31"]
    assert serialized.control_complete == (True,)


def test_control_serialization_marks_cycles_incomplete() -> None:
    value: list[Any] = []
    value.append(value)

    serialized = serialize_controls((_runtime_control(value),))

    assert serialized.state_complete is False


def _runtime_control(value: object) -> RuntimeControl:
    return RuntimeControl(
        name="country",
        cell_ids=("cell-controls",),
        kind="marimo-ui",
        component="dropdown",
        label="Country",
        value=value,
    )


def _install_context(monkeypatch: pytest.MonkeyPatch, context: Any) -> None:
    import marimo._runtime.context as context_module

    monkeypatch.setattr(context_module, "get_context", lambda: context)


def _control_context(name: str, control: object) -> SimpleNamespace:
    return SimpleNamespace(
        graph=SimpleNamespace(
            cells={
                "cell-control": _cell(f"{name} = control()", defs={name}),
                "cell-view": _cell(f"render({name}.value)", refs={name}),
            },
            definitions={name: {"cell-control"}},
            parents={
                "cell-control": set(),
                "cell-view": {"cell-control"},
            },
        ),
        globals={name: control},
        filename="demo.py",
        cell_id="cell-lens",
    )


def _cell(
    code: str,
    *,
    defs: set[str] | None = None,
    refs: set[str] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        code=code,
        defs=defs or set(),
        refs=refs or set(),
        language="python",
        runtime_state="idle",
        run_result_status="success",
        stale=False,
        config=SimpleNamespace(disabled=False),
    )


class _CountingMapping(Mapping[str, int]):
    def __init__(self) -> None:
        self.items_visited = 0

    def __getitem__(self, key: str) -> int:
        return int(key)

    def __iter__(self) -> Iterator[str]:
        for index in range(10_000):
            self.items_visited += 1
            yield str(index)

    def __len__(self) -> int:
        return 10_000


class _ExplosiveCompositeControl:
    __module__ = "marimo._plugins.ui._core.test"

    def __init__(self, value: str) -> None:
        self._args = SimpleNamespace(
            component_name="marimo-form",
            label="Composite",
            args={"element-id": "child"},
        )
        self._frontend_value = value
        self.elements_reads = 0

    @property
    def _value_frontend(self) -> str:
        return self._frontend_value

    @property
    def elements(self) -> object:
        self.elements_reads += 1
        raise RuntimeError("children unavailable")


class _CustomScalarControl:
    def __init__(self, value: str) -> None:
        self._args = SimpleNamespace(
            component_name="custom-control",
            label="Custom",
            args={},
        )
        self._frontend_value = value
        self.frontend_reads = 0

    @property
    def _value_frontend(self) -> str:
        self.frontend_reads += 1
        return self._frontend_value


class _ExplodingDate(dt.date):
    def isoformat(self) -> str:
        raise RuntimeError("sanitization failed")


class _ExplodingFrontendControl:
    __module__ = "marimo._plugins.ui._core.test"

    def __init__(self) -> None:
        self._args = SimpleNamespace(
            component_name="marimo-date",
            label="Date",
            args={},
        )

    @property
    def _value_frontend(self) -> dt.date:
        return _ExplodingDate(2026, 7, 27)


class _BackendOnlyControl:
    __module__ = "marimo._plugins.ui._core.test"

    def __init__(self, value: object) -> None:
        self._args = SimpleNamespace(
            component_name="marimo-custom",
            label="Token",
            args={},
            slotted_html="",
        )
        self.value = value
