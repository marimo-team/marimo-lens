"""The base model for values that cross the browser transport."""

from __future__ import annotations

from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
)
from pydantic.alias_generators import to_camel


class TransportModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="ignore",
        frozen=True,
        populate_by_name=True,
        strict=True,
    )


def dump_model(model: BaseModel) -> dict[str, Any]:
    """Return one browser-shaped mapping from a validated model."""

    return model.model_dump(
        by_alias=True,
        exclude_none=True,
        mode="json",
    )
