from __future__ import annotations

import base64
import datetime as dt
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import anywidget
import pytest
import traitlets
from marimo_lens._marimo.snapshot import collect_runtime_snapshot
from marimo_lens._notebook.controls import (
    RuntimeControl,
    safe_value,
    serialize_controls,
)

from tests.support.controls import control_context, controls_context, install_context
from tests.support.factories import build_context, selection


class _TrackingWidget(anywidget.AnyWidget):
    _esm = "export default { render() {} };"

    secret = traitlets.Unicode("unrelated-secret").tag(sync=True)

    def __init__(self) -> None:
        self.state_reads = 0
        super().__init__()

    def get_state(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        self.state_reads += 1
        return super().get_state(*args, **kwargs)


@dataclass
class _Case:
    controls: dict[str, object]
    secrets: tuple[str, ...] = ()
    reads: Callable[[], int] = lambda: 0
    custom: bool = False


def _composite() -> _Case:
    control = _ExplosiveCompositeControl("private-before")
    return _Case(
        {"composite": control},
        ("private-before",),
        lambda: control.elements_reads,
        True,
    )


def _custom_scalar() -> _Case:
    control = _CustomScalarControl("wire-secret")
    return _Case(
        {"custom": control}, ("wire-secret",), lambda: control.frontend_reads, True
    )


def _backend_only() -> _Case:
    return _Case(
        {"token": _BackendOnlyControl("backend-only-secret")},
        ("backend-only-secret",),
        custom=True,
    )


def _failed_sanitization() -> _Case:
    return _Case({"date": _ExplodingFrontendControl()}, custom=True)


def _password() -> _Case:
    import marimo as mo

    password = mo.ui.text(value="password-before", kind="password", label="API token")
    password._update("password-after")
    return _Case({"token": password}, ("password-before", "password-after"))


def _fresh_password() -> _Case:
    import marimo as mo

    # A password's frontend value starts empty while its backend holds the secret.
    return _Case(
        {"token": mo.ui.text(value="secret-a", kind="password")}, ("secret-a",)
    )


def _nested_initial_password() -> _Case:
    import marimo as mo

    passwords = mo.ui.array([mo.ui.text(value="nested-secret-a", kind="password")])
    return _Case({"tokens": passwords}, ("nested-secret-a",))


def _composite_passwords() -> _Case:
    import marimo as mo

    password_array = mo.ui.array([mo.ui.text(kind="password")])
    password_form = mo.ui.text(kind="password").form()
    password_array._update({"0": "array-secret-before"})
    password_form._update("form-secret-before")
    return _Case(
        {"password_array": password_array, "password_form": password_form},
        ("array-secret-before", "form-secret-before"),
    )


def _anywidget() -> _Case:
    widget = _TrackingWidget()
    return _Case({"widget": widget}, ("unrelated-secret",), lambda: widget.state_reads)


def _file_upload() -> _Case:
    import marimo as mo

    upload = mo.ui.file(label="Upload")
    encoded = base64.b64encode(b"private-before").decode()
    upload._update([("private-before.txt", encoded)])
    return _Case({"upload": upload}, ("private-before", "private-before.txt", encoded))


@pytest.mark.parametrize(
    "make",
    [
        _composite,
        _custom_scalar,
        _backend_only,
        _failed_sanitization,
        _password,
        _fresh_password,
        _nested_initial_password,
        _composite_passwords,
        _anywidget,
        _file_upload,
    ],
)
def test_sensitive_controls_never_reach_context(
    monkeypatch: pytest.MonkeyPatch, make: Callable[[], _Case]
) -> None:
    import marimo_lens._marimo.controls as control_state_module

    case = make()
    if case.custom:
        monkeypatch.setattr(control_state_module, "_is_ui_element", lambda _value: True)
    install_context(monkeypatch, controls_context(case.controls))
    reads = case.reads()

    runtime = collect_runtime_snapshot(("cell-control", "cell-view"))
    references, text = build_context(
        runtime, [selection()], revision=1, current_selection_id="selection-1"
    )

    assert case.reads() == reads
    for secret in case.secrets:
        assert secret not in str(references) + text
    assert text.count("[redacted]") == len(case.controls)


def _date_range() -> object:
    import marimo as mo

    period = mo.ui.date_range(
        start="2025-01-01",
        stop="2026-12-31",
        value=("2025-01-01", "2025-12-31"),
        label="Period",
    )
    period._update(("2026-01-01", "2026-12-31"))
    return period


def _tabs() -> object:
    import marimo as mo

    tabs = mo.ui.tabs(
        {"Austria": "A", "Germany": "G"}, value="Austria", label="Country"
    )
    tabs._update("1")
    return tabs


def _dropdown() -> object:
    import marimo as mo

    environment = mo.ui.dropdown(
        {
            "Production": {"token": "backend-token-before"},
            "Staging": {"token": "backend-token-after"},
        },
        value="Production",
        label="Environment",
    )
    environment._update(["Staging"])
    return environment


@pytest.mark.parametrize(
    ("make", "shown", "hidden"),
    [
        (_date_range, '["2026-01-01","2026-12-31"]', ()),
        (_tabs, 'value: "1"', ()),
        (_dropdown, '["Staging"]', ("backend-token-before", "backend-token-after")),
    ],
)
def test_native_controls_show_their_current_frontend_value(
    monkeypatch: pytest.MonkeyPatch,
    make: Callable[[], object],
    shown: str,
    hidden: tuple[str, ...],
) -> None:
    install_context(monkeypatch, control_context("control", make()))

    runtime = collect_runtime_snapshot(("cell-control", "cell-view"))
    _references, text = build_context(
        runtime, [selection()], revision=1, current_selection_id="selection-1"
    )

    assert shown in text
    assert "[redacted]" not in text
    for value in hidden:
        assert value not in text


def test_safe_value_stops_iterating_after_the_item_limit() -> None:
    value = _CountingMapping()

    result = safe_value(value)

    assert value.items_visited == 21
    assert result["..."] == "more items omitted"


def test_safe_value_does_not_treat_shared_values_as_cycles() -> None:
    shared = {"value": 3}

    result = safe_value([shared, shared])

    assert result == [{"value": 3}, {"value": 3}]


@pytest.mark.parametrize(
    ("value", "canonical"),
    [
        ({"b": 2, "a": 1}, {"a": 1, "b": 2}),
        (("2025-01-01", "2025-12-31"), ["2025-01-01", "2025-12-31"]),
    ],
)
def test_control_serialization_is_canonical(value: object, canonical: object) -> None:
    serialized = serialize_controls((_runtime_control(value),))

    assert serialized.controls[0].value == canonical
    assert serialized.controls[0].complete is True
    assert serialized.state_truncated is False


_CYCLE: list[Any] = []
_CYCLE.append(_CYCLE)


@pytest.mark.parametrize(
    "value",
    [float("nan"), {1: "one"}, {"Austria", "Germany"}, _CYCLE],
    ids=["nan", "int-key", "set", "cycle"],
)
def test_control_serialization_marks_lossy_values_incomplete(value: object) -> None:
    serialized = serialize_controls((_runtime_control(value),))

    assert serialized.controls[0].complete is False
    assert serialized.state_truncated is True


def _runtime_control(value: object) -> RuntimeControl:
    return RuntimeControl(
        name="country",
        cell_ids=("cell-controls",),
        kind="marimo-ui",
        component="dropdown",
        label="Country",
        value=value,
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
