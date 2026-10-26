"""Validate public Lens method arguments into typed values and wire addresses."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from pydantic import TypeAdapter, ValidationError

from .._core.bounds import (
    ATTENTION_DURATION_ADAPTER,
    CELL_ID_ADAPTER,
    DOM_SELECTOR_ADAPTER,
    MAX_ATTENTION_DURATION_MS,
    MAX_SELECTIONS,
    MAX_TRAIL_STEPS,
    OPTIONAL_ATTENTION_LABEL_ADAPTER,
    OPTIONAL_ATTENTION_TEXT_ADAPTER,
    OPTIONAL_REVEAL_TEXT_ADAPTER,
    REVISION_ADAPTER,
    SELECTION_ID_ADAPTER,
)
from .._protocol.messages import (
    AttentionAddress,
    CellAttentionAddress,
    SelectionAttentionAddress,
)


def validated_dom_selector(dom_selector: str | None) -> str | None:
    if dom_selector is None:
        return None
    if not isinstance(dom_selector, str):
        raise TypeError("dom_selector must be a string or None.")
    selector = dom_selector.strip()
    if not selector:
        raise ValueError("dom_selector must not be empty.")
    try:
        return DOM_SELECTOR_ADAPTER.validate_python(selector)
    except ValidationError as error:
        raise ValueError(
            "dom_selector must contain nonblank valid Unicode with at most "
            "1,024 UTF-16 code units."
        ) from error


def selection_ids(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        values: Sequence[object] = (value,)
    elif isinstance(value, Sequence) and not isinstance(
        value,
        (bytes, bytearray, memoryview),
    ):
        values = value
    else:
        raise TypeError("selection_ids must be a string or a sequence of strings.")
    if not values:
        raise ValueError("selection_ids must contain at least one selection ID.")
    if len(values) > MAX_SELECTIONS:
        raise ValueError(
            f"selection_ids must contain at most {MAX_SELECTIONS} selection IDs."
        )
    selection_ids = tuple(
        _validated_identifier(SELECTION_ID_ADAPTER, item, name="selection_id")
        for item in values
    )
    if len(selection_ids) != len(set(selection_ids)):
        raise ValueError("selection_ids must not contain duplicates.")
    return selection_ids


def cell_id(value: object) -> str:
    return _validated_identifier(CELL_ID_ADAPTER, value, name="cell_id")


def activity_id(value: object) -> str:
    return _validated_identifier(SELECTION_ID_ADAPTER, value, name="activity")


def attention_address(
    target: object,
    *,
    expected_revision: int | None,
) -> tuple[AttentionAddress, int | None]:
    if isinstance(target, str):
        revision = (
            checked_revision(expected_revision)
            if expected_revision is not None
            else None
        )
        return CellAttentionAddress(kind="cell", cell_id=cell_id(target)), revision
    if not isinstance(target, Mapping):
        raise TypeError("target must be a cell ID or SelectionReference.")
    if expected_revision is None:
        raise TypeError(
            "expected_revision is required when target is a SelectionReference."
        )
    revision = checked_revision(expected_revision)
    return (
        SelectionAttentionAddress(
            kind="selection",
            selection_id=_validated_identifier(
                SELECTION_ID_ADAPTER, target.get("id"), name="selection_id"
            ),
            revision=revision,
        ),
        revision,
    )


def _validated_identifier(
    adapter: TypeAdapter[str],
    value: object,
    *,
    name: str,
) -> str:
    try:
        return adapter.validate_python(value)
    except ValidationError as error:
        error_type, message = _validation_detail(error)
        if error_type == "string_type":
            raise TypeError(f"{name} must be a string.") from None
        raise ValueError(f"{name} {message}.") from None


def checked_revision(value: object) -> int:
    try:
        return REVISION_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, _ = _validation_detail(error)
        if error_type == "int_type":
            raise TypeError("expected_revision must be an integer.") from None
        raise ValueError(
            "expected_revision must be a non-negative integer within JSON's safe range."
        ) from None


def validated_duration_ms(value: object) -> int:
    try:
        return ATTENTION_DURATION_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, _ = _validation_detail(error)
        if error_type == "int_type":
            raise TypeError("duration_ms must be an integer.") from None
        raise ValueError(
            f"duration_ms must be between 1 and {MAX_ATTENTION_DURATION_MS} milliseconds."
        ) from None


def attention_label(value: object) -> str | None:
    try:
        return OPTIONAL_ATTENTION_LABEL_ADAPTER.validate_python(value)
    except ValidationError as error:
        error_type, message = _validation_detail(error)
        if error_type in {"string_type", "none_required"}:
            raise TypeError("label must be a string or None.") from None
        raise ValueError(f"label {message}.") from None


def optional_text(
    value: object,
    *,
    name: str,
    adapter: TypeAdapter[str | None] = OPTIONAL_ATTENTION_TEXT_ADAPTER,
) -> str | None:
    try:
        return adapter.validate_python(value)
    except ValidationError as error:
        error_type, message = _validation_detail(error)
        if error_type in {"string_type", "none_required"}:
            raise TypeError(f"{name} must be a string or None.") from None
        raise ValueError(f"{name} {message}.") from None


def _validation_detail(error: ValidationError) -> tuple[str, str]:
    detail = error.errors(
        include_url=False,
        include_context=False,
        include_input=False,
    )[0]
    return str(detail["type"]), str(detail["msg"])


def reveal_steps(
    target: object,
    *,
    expected_revision: int | None,
    label: str | None,
    message: str | None,
) -> list[tuple[tuple[AttentionAddress, int | None], str | None, str | None]]:
    """Normalize ``Lens.reveal`` arguments into addressed, labeled steps."""

    if isinstance(target, Sequence) and not isinstance(target, (str, bytes)):
        if label is not None or message is not None:
            raise TypeError("Put label and message on each reveal step.")
        steps = target
    else:
        steps = [{"target": target, "label": label, "message": message}]
    if not 1 <= len(steps) <= MAX_TRAIL_STEPS:
        raise ValueError(f"reveal requires 1–{MAX_TRAIL_STEPS} steps.")
    normalized = []
    for step in steps:
        if not isinstance(step, Mapping) or "target" not in step:
            raise TypeError("Each reveal step must contain a target.")
        if set(step) - {"target", "label", "message"}:
            raise TypeError("Reveal steps accept only target, label, and message.")
        normalized.append(
            (
                attention_address(step["target"], expected_revision=expected_revision),
                attention_label(step.get("label")),
                optional_text(
                    step.get("message"),
                    name="message",
                    adapter=OPTIONAL_REVEAL_TEXT_ADAPTER,
                ),
            )
        )
    return normalized
