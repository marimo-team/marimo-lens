from __future__ import annotations

import inspect
from collections.abc import Mapping
from importlib import metadata as pkg
from typing import Any, Literal, cast, get_args, get_type_hints

import marimo_lens
import pytest
from marimo_lens import (
    ActivityHandle,
    CellReference,
    ChatRequestReference,
    Diagnostic,
    Lens,
    LensContext,
    LensError,
    LensReferences,
    NotebookReference,
    Record,
    RecordedChange,
    RecordedImage,
    RecordedRequest,
    RecordOptions,
    RequestReference,
    RevealStep,
    Selection,
    SelectionReference,
    SelectionTargetReference,
    agent,
    automatic_lens,
    notebook_context,
    notebook_lens,
    record_request,
)
from marimo_lens._notebook.snapshot import RuntimeSnapshot

from tests.support.factories import lens_context


def test_package_exports_the_public_api() -> None:
    expected = {
        "ActivityHandle": ActivityHandle,
        "CellReference": CellReference,
        "ChatRequestReference": ChatRequestReference,
        "Diagnostic": Diagnostic,
        "Lens": Lens,
        "LensContext": LensContext,
        "LensError": LensError,
        "LensReferences": LensReferences,
        "NotebookReference": NotebookReference,
        "Record": Record,
        "RecordOptions": RecordOptions,
        "RecordedChange": RecordedChange,
        "RecordedImage": RecordedImage,
        "RecordedRequest": RecordedRequest,
        "RequestReference": RequestReference,
        "Selection": Selection,
        "SelectionReference": SelectionReference,
        "SelectionTargetReference": SelectionTargetReference,
        "RevealStep": RevealStep,
        "__version__": pkg.version("marimo-lens"),
        "agent": agent,
        "automatic_lens": automatic_lens,
        "notebook_context": notebook_context,
        "notebook_lens": notebook_lens,
        "record_request": record_request,
    }

    assert set(marimo_lens.__all__) == set(expected)
    assert {name: getattr(marimo_lens, name) for name in expected} == expected


def test_public_classes_show_their_source_and_type_hints() -> None:
    for name in marimo_lens.__all__:
        value = getattr(marimo_lens, name)
        if isinstance(value, type) and value is not marimo_lens.LensError:
            assert inspect.getsource(value), name
            get_type_hints(value)


def test_lens_error_reads_as_part_of_the_package() -> None:
    assert marimo_lens.LensError.__module__ == "marimo_lens"


def test_context_exposes_typed_reference_dictionaries() -> None:
    references_getter = LensContext.references.fget
    current_getter = LensContext.current.fget
    request_getter = LensContext.request.fget
    assert references_getter is not None
    assert current_getter is not None
    assert request_getter is not None
    assert get_type_hints(references_getter)["return"] is LensReferences
    assert get_type_hints(current_getter)["return"] == SelectionReference | None
    assert get_type_hints(request_getter)["return"] == RequestReference | None
    assert get_type_hints(LensReferences)["notebook"] is NotebookReference
    assert get_type_hints(LensReferences)["selections"] == list[SelectionReference]
    assert get_type_hints(NotebookReference)["path"] is str
    assert get_type_hints(SelectionReference)["target"] is SelectionTargetReference
    assert get_type_hints(SelectionReference)["cells"] == list[CellReference]
    target_kinds = {
        get_type_hints(target)["kind"] for target in get_args(SelectionTargetReference)
    }
    assert target_kinds == {Literal["notebook"], Literal["dom"]}
    assert all(
        get_type_hints(target)["documentPath"] is str
        for target in get_args(SelectionTargetReference)
    )
    assert all(
        get_type_hints(target)["documentId"] is str
        for target in get_args(SelectionTargetReference)
    )


def test_context_exposes_immutable_png_bytes_by_selection_id() -> None:
    images = {"selection-1": b"png-bytes"}
    context = lens_context({}, images=images)
    images.clear()

    assert context.images == {"selection-1": b"png-bytes"}
    images_getter = LensContext.images.fget
    assert images_getter is not None
    assert get_type_hints(images_getter)["return"] == Mapping[str, bytes]
    with pytest.raises(TypeError):
        cast(Any, context.images)["selection-2"] = b"other"


def test_context_is_created_by_lens() -> None:
    with pytest.raises(TypeError, match=r"Lens\.context\(\)"):
        LensContext()


def test_context_references_are_detached_from_lens_state() -> None:
    lens = Lens()
    first = lens.context()

    first.references["revision"] = 9
    first.references["selections"].append(cast(SelectionReference, {"id": "x"}))
    second = lens.context()

    assert second.revision == 0
    assert second.references["selections"] == []
    lens.close()


def test_context_current_and_revision_read_the_reference_packet() -> None:
    current = lens_context(
        {
            "revision": 7,
            "currentSelectionId": "selection-2",
            "selections": [
                {"id": "selection-1", "label": "S1"},
                {"id": "selection-2", "label": "S2"},
            ],
        }
    )
    empty = lens_context({"currentSelectionId": None, "selections": []})

    assert current.current == {"id": "selection-2", "label": "S2"}
    assert current.revision == 7
    assert empty.current is None
    with pytest.raises(ValueError, match="valid revision"):
        _ = empty.revision


def test_lens_context_defers_and_caches_standalone_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._context.build as context_module
    from marimo_lens._marimo.adapter import MarimoRuntimeAdapter

    runtime = RuntimeSnapshot(
        available=False,
        filename="",
        reason="kernel unavailable",
        available_cell_ids=frozenset(),
        cells=(),
        controls=(),
    )
    monkeypatch.setattr(
        MarimoRuntimeAdapter,
        "snapshot",
        lambda _self, _output_cell_ids: runtime,
    )
    calls = 0

    def render_text(*_args: object, **_kwargs: object) -> str:
        nonlocal calls
        calls += 1
        return "detached text context"

    monkeypatch.setattr(context_module, "render_text", render_text)
    lens = Lens()

    context = lens.context()

    assert context.revision == 0
    assert calls == 0
    assert "text_chars=pending" in repr(context)
    assert calls == 0
    assert context.text == "detached text context"
    assert context.text == "detached text context"
    assert calls == 1
    lens.close()


def test_context_repr_summarizes_context_and_image_sizes() -> None:
    context = lens_context(
        {
            "currentSelectionId": "selection-1",
            "selections": [{"note": "private selection content"}, {}],
        },
        text="private text content" * 10_000,
        images={"selection-1": b"x" * 100_000},
    )

    _ = context.text
    result = repr(context)

    assert result == (
        "LensContext(selections=2, text_chars=200000, images=1, image_bytes=100000)"
    )
    assert "private selection content" not in result
    assert "private text content" not in result
