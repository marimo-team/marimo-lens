from __future__ import annotations

from typing import Any

from marimo_lens.inspectors import OutputInspector

from tests.support.assertions import _capabilities
from tests.support.sample_entities import lens_entity


class MimeOutput:
    def __init__(self, bundle: Any) -> None:
        self._bundle = bundle

    def _mime_(self) -> Any:
        return self._bundle


def test_output_inspector_prefers_data_over_media_mime() -> None:
    metadata = OutputInspector().inspect(
        lens_entity(
            "payload",
            MimeOutput({"image/png": b"image", "application/json": {"rows": 3}}),
        )
    )

    assert metadata is not None
    assert metadata["kind"] == "data"
    assert metadata["capabilities"] == _capabilities(data=True)
    assert metadata["data"]["payload"] == {"rows": 3}


def test_output_inspector_classifies_html_media_and_document_markers() -> None:
    image = OutputInspector().inspect(
        lens_entity("plot_image", MimeOutput(("text/html", '<img src="/plot.png" />')))
    )
    document = OutputInspector().inspect(
        lens_entity(
            "report", MimeOutput(("text/html", '<iframe src="/report.pdf"></iframe>'))
        )
    )

    assert image is not None
    assert image["kind"] == "media"
    assert image["family"] == "image"
    assert image["selectionPolicy"]["prefer"] == ["media", "selector"]
    assert document is not None
    assert document["kind"] == "document"
    assert document["selectionPolicy"]["prefer"] == ["document", "selector"]


def test_output_inspector_preserves_payload_without_redaction() -> None:
    metadata = OutputInspector().inspect(
        lens_entity(
            "payload",
            MimeOutput(("application/json", {"api_token": "secret-token"})),
        )
    )

    assert metadata is not None
    assert metadata["data"]["payload"]["api_token"] == "secret-token"


def test_output_inspector_uses_repr_fallbacks_and_ignores_failing_reprs() -> None:
    class RichOutput:
        def _repr_html_(self) -> str:
            return '<img src="/plot.png" />'

        def _repr_png_(self) -> bytes:
            raise RuntimeError("png failed")

    metadata = OutputInspector().inspect(lens_entity("plot", RichOutput()))

    assert metadata is not None
    assert metadata["kind"] == "media"
    assert metadata["media"]["renderer"] == "html"


def test_output_inspector_classifies_diagnostic_mime() -> None:
    metadata = OutputInspector().inspect(
        lens_entity(
            "traceback", MimeOutput(("application/vnd.marimo+traceback", "Traceback"))
        )
    )

    assert metadata is not None
    assert metadata["kind"] == "diagnostic"
    assert metadata["capabilities"] == _capabilities(diagnostic=True)
    assert metadata["diagnostic"]["payload"] == "Traceback"


def test_output_inspector_returns_none_for_unsupported_mime() -> None:
    assert (
        OutputInspector().inspect(
            lens_entity("unknown", MimeOutput(("application/octet-stream", b"raw")))
        )
        is None
    )
