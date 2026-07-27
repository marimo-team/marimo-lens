from __future__ import annotations

from typing import get_type_hints

import marimo_lens
import pytest
from marimo_lens import Lens, LensContext, LensError, SelectionImage
from marimo_lens._runtime import RuntimeSnapshot

from tests.support.factories import png


def test_package_exports_the_public_api() -> None:
    assert marimo_lens.__all__ == [
        "Lens",
        "LensContext",
        "LensError",
        "SelectionImage",
    ]
    assert [getattr(marimo_lens, name) for name in marimo_lens.__all__] == [
        Lens,
        LensContext,
        LensError,
        SelectionImage,
    ]


def test_selection_image_repr_hides_png_bytes() -> None:
    image = _image(b"private-png-bytes")

    result = repr(image)

    assert "SelectionImage" in result
    assert "selection-1" in result
    assert "data=" not in result
    assert "private-png-bytes" not in result


def test_selection_images_render_through_marimo_display_protocol() -> None:
    from marimo import Html
    from marimo._output.formatting import try_format

    image = _image(png())
    rendered = image.render()
    formatted = try_format(image)

    assert isinstance(rendered, Html)
    assert formatted.mimetype == "text/html"
    assert "<img" in formatted.data
    assert not hasattr(image, "__dict__")


def test_image_render_return_type_is_runtime_resolvable() -> None:
    from marimo import Html

    assert get_type_hints(SelectionImage.render)["return"] is Html


def test_selection_image_render_forwards_presentation_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import marimo

    calls: list[tuple[bytes, dict[str, object]]] = []
    sentinel = marimo.Html("<span>rendered</span>")

    def render_image(data: bytes, **options: object) -> marimo.Html:
        calls.append((data, options))
        return sentinel

    monkeypatch.setattr(marimo, "image", render_image)
    image = _image(png())

    result = image.render(alt="Cell output", width="100%", height=120)

    assert result is sentinel
    assert calls == [
        (
            image.data,
            {"alt": "Cell output", "width": "100%", "height": 120},
        )
    ]


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
        text="No Lens selections were collected.",
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
