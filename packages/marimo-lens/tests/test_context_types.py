from __future__ import annotations

from collections.abc import Mapping
from importlib import metadata as pkg
from typing import Any, cast, get_type_hints

import marimo_lens
import pytest
from marimo_lens import (
    Lens,
    LensContext,
    LensError,
    LensReferences,
    NotebookReference,
    SelectionReference,
)
from marimo_lens._runtime import RuntimeSnapshot


def test_package_exports_the_public_api() -> None:
    expected = {
        "Lens": Lens,
        "LensContext": LensContext,
        "LensError": LensError,
        "LensReferences": LensReferences,
        "NotebookReference": NotebookReference,
        "SelectionReference": SelectionReference,
        "__version__": pkg.version("marimo-lens"),
    }

    assert set(marimo_lens.__all__) == set(expected)
    assert {name: getattr(marimo_lens, name) for name in expected} == expected


def test_context_exposes_typed_reference_dictionaries() -> None:
    references_getter = LensContext.references.fget
    current_getter = LensContext.current.fget
    assert references_getter is not None
    assert current_getter is not None
    assert get_type_hints(references_getter)["return"] is LensReferences
    assert get_type_hints(current_getter)["return"] == SelectionReference | None
    assert get_type_hints(LensReferences)["notebook"] is NotebookReference
    assert get_type_hints(LensReferences)["selections"] == list[SelectionReference]
    assert get_type_hints(NotebookReference)["path"] is str
    assert get_type_hints(SelectionReference)["outputCellId"] is str


def test_context_exposes_immutable_png_bytes_by_selection_id() -> None:
    images = {"selection-1": b"png-bytes"}
    context = LensContext(references={}, text="", images=images)
    images.clear()

    assert context.images == {"selection-1": b"png-bytes"}
    images_getter = LensContext.images.fget
    assert images_getter is not None
    assert get_type_hints(images_getter)["return"] == Mapping[str, bytes]
    with pytest.raises(TypeError):
        cast(Any, context.images)["selection-2"] = b"other"


def test_context_current_returns_the_authoritative_selection() -> None:
    context = LensContext(
        references={
            "currentSelectionId": "selection-2",
            "selections": [
                {"id": "selection-1", "label": "S1"},
                {"id": "selection-2", "label": "S2"},
            ],
        },
        text="Current notebook context",
        images={},
    )

    assert context.current == {"id": "selection-2", "label": "S2"}


def test_context_current_is_none_when_no_selection_is_current() -> None:
    context = LensContext(
        references={"currentSelectionId": None, "selections": []},
        text="No Lens selections were collected.",
        images={},
    )

    assert context.current is None


def test_context_revision_returns_the_captured_selection_revision() -> None:
    context = LensContext(
        references={"revision": 7, "currentSelectionId": None, "selections": []},
        text="Current notebook context",
        images={},
    )

    assert context.revision == 7


def test_context_revision_rejects_an_invalid_reference_packet() -> None:
    context = LensContext(
        references={"currentSelectionId": None, "selections": []},
        text="Current notebook context",
        images={},
    )

    with pytest.raises(ValueError, match="valid revision"):
        _ = context.revision


def test_lens_context_defers_and_caches_standalone_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo_lens._context as context_module
    from marimo_lens._marimo_runtime import MarimoRuntimeAdapter

    runtime = RuntimeSnapshot(
        available=False,
        filename="",
        reason="kernel unavailable",
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
    context = LensContext(
        references={
            "currentSelectionId": "selection-1",
            "selections": [{"note": "private selection content"}, {}],
        },
        text="private text content" * 10_000,
        images={"selection-1": b"x" * 100_000},
    )

    result = repr(context)

    assert result == (
        "LensContext(selections=2, text_chars=200000, images=1, image_bytes=100000)"
    )
    assert "private selection content" not in result
    assert "private text content" not in result
