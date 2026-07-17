from __future__ import annotations

import pytest

from marimo_lens import LensContext, SelectionImage


def test_selection_image_repr_hides_png_bytes() -> None:
    image = _image(b"private-png-bytes")

    result = repr(image)

    assert "SelectionImage" in result
    assert "selection-1" in result
    assert "data=" not in result
    assert "private-png-bytes" not in result


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
        images=(),
    )

    assert context.current == {"id": "selection-2", "label": "S2"}


def test_context_current_is_none_when_no_selection_is_current() -> None:
    context = LensContext(
        references={"currentSelectionId": None, "selections": []},
        text="No marimo Lens selections were collected.",
        images=(),
    )

    assert context.current is None


def test_context_revision_returns_the_captured_selection_revision() -> None:
    context = LensContext(
        references={"revision": 7, "currentSelectionId": None, "selections": []},
        text="Current notebook context",
        images=(),
    )

    assert context.revision == 7


def test_context_revision_rejects_an_invalid_reference_packet() -> None:
    context = LensContext(
        references={"currentSelectionId": None, "selections": []},
        text="Current notebook context",
        images=(),
    )

    with pytest.raises(ValueError, match="valid revision"):
        _ = context.revision


def test_context_repr_summarizes_context_and_image_sizes() -> None:
    context = LensContext(
        references={
            "currentSelectionId": "selection-1",
            "selections": [{"note": "private selection content"}, {}],
        },
        text="private text content" * 10_000,
        images=(_image(b"x" * 100_000),),
    )

    result = repr(context)

    assert result == (
        "LensContext(selections=2, text_chars=200000, images=1, image_bytes=100000)"
    )
    assert "private selection content" not in result
    assert "private text content" not in result


def _image(data: bytes) -> SelectionImage:
    return SelectionImage(
        id="image:selection-1",
        selection_id="selection-1",
        media_type="image/png",
        data=data,
        width=10,
        height=10,
        sha256="0" * 64,
        captured_at="2026-07-14T11:58:00Z",
        outdated=False,
    )
