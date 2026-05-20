"""Core chart-adapter protocol for visualization inspection."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from inspect import Parameter, signature
from typing import Any, Protocol, overload

from ._metadata import ChartMetadata, dedupe_chart_parts, with_chart_library


@dataclass(frozen=True)
class ChartEntity:
    """A visualization candidate plus render-context hints."""

    value: Any
    is_svg_html: bool = False


class ChartAdapter(Protocol):
    """Identify and describe one family of Python chart objects."""

    id: str

    def inspect(
        self, chart: ChartEntity
    ) -> ChartMetadata | Mapping[str, Any] | None: ...


ChartAdapterFunction = Callable[..., ChartMetadata | Mapping[str, Any] | None]


@dataclass(frozen=True)
class FunctionChartAdapter:
    """Function-backed chart adapter produced by ``chart_adapter``."""

    id: str
    inspect_chart: ChartAdapterFunction
    types: tuple[type[Any], ...] = ()
    library: str | None = None

    def inspect(self, chart: ChartEntity) -> ChartMetadata | Mapping[str, Any] | None:
        if self.types and not isinstance(chart.value, self.types):
            return None
        if self.types:
            if _accepts_context(self.inspect_chart):
                return self.inspect_chart(chart.value, chart)
            return self.inspect_chart(chart.value)
        return self.inspect_chart(chart)


@overload
def chart_adapter(
    subject: str | type[Any] | tuple[type[Any], ...],
    fn: ChartAdapterFunction,
    *,
    library: str | None = None,
    types: type[Any] | tuple[type[Any], ...] | None = None,
) -> FunctionChartAdapter: ...


@overload
def chart_adapter(
    subject: str | type[Any] | tuple[type[Any], ...],
    fn: None = None,
    *,
    library: str | None = None,
    types: type[Any] | tuple[type[Any], ...] | None = None,
) -> Callable[[ChartAdapterFunction], FunctionChartAdapter]: ...


def chart_adapter(
    subject: str | type[Any] | tuple[type[Any], ...],
    fn: ChartAdapterFunction | None = None,
    *,
    library: str | None = None,
    types: type[Any] | tuple[type[Any], ...] | None = None,
) -> FunctionChartAdapter | Callable[[ChartAdapterFunction], FunctionChartAdapter]:
    """Create a chart adapter from a function.

    Use ``@chart_adapter("library")`` for full context functions, or
    ``@chart_adapter(CustomChart, library="custom")`` for value functions:

    ```python
    @chart_adapter("acme")
    def acme_chart(chart: ChartEntity):
        ...

    @chart_adapter(AcmeChart, library="acme")
    def acme_chart(chart: AcmeChart):
        ...
    ```
    """
    adapter_id, adapter_types = _adapter_identity(
        subject,
        library=library,
        types=types,
    )

    def decorate(inspect_chart: ChartAdapterFunction) -> FunctionChartAdapter:
        return FunctionChartAdapter(
            id=adapter_id,
            inspect_chart=inspect_chart,
            types=adapter_types,
            library=library or adapter_id,
        )

    if fn is not None:
        return decorate(fn)
    return decorate


@dataclass(frozen=True)
class ChartRegistry:
    """Ordered chart adapter registry."""

    adapters: Sequence[ChartAdapter]
    strict: bool = False

    def inspect(
        self,
        value: Any,
        *,
        is_svg_html: bool = False,
    ) -> dict[str, Any] | None:
        chart = ChartEntity(value=value, is_svg_html=is_svg_html)
        for adapter in self.adapters:
            try:
                metadata = adapter.inspect(chart)
            except Exception:
                if self.strict:
                    raise
                continue
            if metadata is None:
                continue
            result = _metadata_dict(metadata)
            library = str(
                result.get("library") or getattr(adapter, "library", None) or adapter.id
            )
            result["library"] = library
            parts = result.get("parts")
            if isinstance(parts, Sequence) and not isinstance(
                parts, (str, bytes, bytearray)
            ):
                result["parts"] = with_chart_library(
                    library,
                    dedupe_chart_parts(
                        [part for part in parts if isinstance(part, Mapping)]
                    ),
                )
            return result
        return None

    def with_adapters(
        self,
        adapters: Sequence[ChartAdapter],
        *,
        prepend: bool = True,
    ) -> ChartRegistry:
        ordered = (
            (*adapters, *self.adapters) if prepend else (*self.adapters, *adapters)
        )
        return ChartRegistry(ordered, strict=self.strict)


def default_chart_adapters() -> tuple[ChartAdapter, ...]:
    from .altair import AltairChartAdapter
    from .matplotlib import MatplotlibChartAdapter
    from .plotly import PlotlyChartAdapter
    from .visual import VisualChartAdapter

    return (
        AltairChartAdapter(),
        PlotlyChartAdapter(),
        MatplotlibChartAdapter(),
        VisualChartAdapter(),
    )


def default_chart_registry() -> ChartRegistry:
    return ChartRegistry(default_chart_adapters())


def _metadata_dict(metadata: ChartMetadata | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(metadata, ChartMetadata):
        return metadata.to_dict()
    return dict(metadata)


def _adapter_identity(
    subject: str | type[Any] | tuple[type[Any], ...],
    *,
    library: str | None,
    types: type[Any] | tuple[type[Any], ...] | None,
) -> tuple[str, tuple[type[Any], ...]]:
    explicit_types = _normalize_types(types)
    if isinstance(subject, str):
        return subject, explicit_types
    subject_types = _normalize_types(subject)
    adapter_id = library or _type_slug(subject_types[0])
    return adapter_id, subject_types


def _normalize_types(
    types: type[Any] | tuple[type[Any], ...] | None,
) -> tuple[type[Any], ...]:
    if types is None:
        return ()
    if isinstance(types, type):
        return (types,)
    if not types:
        raise TypeError("chart_adapter types cannot be empty")
    if all(isinstance(item, type) for item in types):
        return types
    raise TypeError("chart_adapter types must be a type or tuple of types")


def _type_slug(value_type: type[Any]) -> str:
    return (
        value_type.__qualname__.replace(".", "-").replace("_", "-").lower() or "chart"
    )


def _accepts_context(fn: ChartAdapterFunction) -> bool:
    try:
        parameters = list(signature(fn).parameters.values())
    except (TypeError, ValueError):
        return False
    positional = [
        parameter
        for parameter in parameters
        if parameter.kind
        in {Parameter.POSITIONAL_ONLY, Parameter.POSITIONAL_OR_KEYWORD}
    ]
    return len(positional) >= 2 or any(
        parameter.kind is Parameter.VAR_POSITIONAL for parameter in parameters
    )
