from __future__ import annotations

from marimo_lens.inspectors import ChartEntity
from marimo_lens.inspectors.charts.matplotlib import MatplotlibChartAdapter


class Axis:
    lines = [object()]
    patches = [object(), object()]
    collections: list[object] = []

    def get_title(self) -> str:
        return "Sales"

    def get_xlabel(self) -> str:
        return "Quarter"

    def get_ylabel(self) -> str:
        return "Revenue"

    def get_legend(self) -> object:
        return object()


MatplotlibFigure = type(
    "Figure",
    (),
    {
        "__module__": "matplotlib.figure",
        "__init__": lambda self: setattr(self, "axes", [Axis()]),
    },
)
MatplotlibAxesWrapper = type(
    "Axes",
    (),
    {
        "__module__": "matplotlib.axes",
        "__init__": lambda self: setattr(self, "figure", MatplotlibFigure()),
    },
)


def test_matplotlib_adapter_generates_axes_axis_legend_and_mark_parts() -> None:
    metadata = MatplotlibChartAdapter().inspect(ChartEntity(MatplotlibFigure()))

    assert metadata is not None
    parts = {
        (part["kind"], part["label"], part.get("detail")) for part in metadata["parts"]
    }

    assert metadata["library"] == "matplotlib"
    assert metadata["axesCount"] == 1
    assert ("plot-area", "axes 1", "Sales") in parts
    assert ("axis", "x axis", "Quarter") in parts
    assert ("axis", "y axis", "Revenue") in parts
    assert ("legend", "legend", "Sales") in parts
    assert ("mark", "lines", "1") in parts
    assert ("mark", "patches", "2") in parts


def test_matplotlib_adapter_accepts_axes_wrapped_objects() -> None:
    wrapped = MatplotlibAxesWrapper()
    metadata = MatplotlibChartAdapter().inspect(ChartEntity(wrapped))

    assert metadata is not None
    assert metadata["axesCount"] == 1
