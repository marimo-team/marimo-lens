"""Limits and bounded scalar types shared by Lens values, models, and arguments."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from functools import partial
from typing import Annotated, TypeAlias

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BeforeValidator,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
)
from pydantic_core import PydanticCustomError

MAX_SELECTIONS = 64

MAX_HISTORY_ENTRIES = 100

MAX_HISTORY_NOTE = 500

MAX_HISTORY_STATEMENT = 240

MAX_HISTORY_DEFINES = 8

MAX_HISTORY_CELL_NAMES = 256

MAX_CHAT_REQUESTS = 16

MAX_SELECTION_ID = 128

MAX_CELL_ID = 128

MAX_NOTE = 4_000

MAX_DOM_TEXT = 240

MAX_DOM_FIELD = 240

MAX_DOM_SELECTOR = 1_024

MAX_ERROR = 500

MAX_CELL_NAME = 256

MAX_ATTENTION_MESSAGE = 240

MAX_REVEAL_MESSAGE = 1_000

MAX_ATTENTION_LABEL = 40

MAX_ATTENTION_DURATION_MS = 300_000

MAX_TRAIL_STEPS = 16

MAX_SAFE_INTEGER = 9_007_199_254_740_991

_TIMESTAMP_PATTERN = (
    r"^(?:\d{4})-(?:\d{2})-(?:\d{2})T(?:\d{2}):(?:\d{2}):(?:\d{2})"
    r"(?:\.\d+)?(?:Z|[+-](?:\d{2}):(?:\d{2}))$"
)

_PROTOCOL_EDGE_WHITESPACE = re.compile(r"^[\s\ufeff]+|[\s\ufeff]+$")

_AWARE_DATETIME_ADAPTER = TypeAdapter(AwareDatetime)


def _valid_unicode(value: str) -> str:
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise PydanticCustomError(
            "unicode_text",
            "must contain valid Unicode text",
        ) from error
    return value


def nonblank(value: str) -> str:
    if all(character.isspace() or character == "\ufeff" for character in value):
        raise PydanticCustomError("text_blank", "must not be empty")
    return value


def bounded_utf16(value: str, *, maximum: int) -> str:
    if len(value.encode("utf-16-le")) // 2 > maximum:
        raise PydanticCustomError(
            "utf16_too_long",
            "must contain at most {maximum} UTF-16 code units",
            {"maximum": maximum},
        )
    return value


def utf16_prefix(text: str, maximum: int) -> str:
    """Return ``text``, or its prefix ending in "..." within ``maximum`` UTF-16 units."""

    if len(text.encode("utf-16-le")) // 2 <= maximum:
        return text
    prefix: list[str] = []
    units = 0
    for character in text:
        width = 2 if ord(character) > 0xFFFF else 1
        if units + width > maximum - 3:
            break
        prefix.append(character)
        units += width
    return "".join(prefix) + "..."


def utf16_text(value: str, maximum: int) -> str:
    """Return ``value`` with lone surrogates replaced, cut to ``maximum`` UTF-16 units.

    Paths and OS errors on POSIX can carry undecodable bytes as lone
    surrogates, which neither UTF-8 nor the browser accepts.
    """

    result: list[str] = []
    length = 0
    for character in value:
        codepoint = ord(character)
        if 0xD800 <= codepoint <= 0xDFFF:
            character = "\N{REPLACEMENT CHARACTER}"
        width = 2 if codepoint > 0xFFFF else 1
        if length + width > maximum:
            break
        result.append(character)
        length += width
    return "".join(result)


def safe_text(value: str, maximum: int) -> str:
    """Return ``value`` with lone surrogates replaced, cut to ``maximum`` UTF-8 bytes."""

    sanitized = "".join(
        "\N{REPLACEMENT CHARACTER}" if 0xD800 <= ord(character) <= 0xDFFF else character
        for character in value
    )
    if len(sanitized.encode("utf-8")) <= maximum:
        return sanitized
    result: list[str] = []
    size = 0
    for character in sanitized:
        width = len(character.encode("utf-8"))
        if size + width > maximum - 3:
            break
        result.append(character)
        size += width
    return "".join(result) + "..."


def utcnow() -> str:
    """Return the current UTC time as ``TimestampText``."""

    return datetime.now(timezone.utc).isoformat()


def parse_timestamp(value: str) -> datetime:
    """Return the instant that a validated ``TimestampText`` names."""

    return _AWARE_DATETIME_ADAPTER.validate_python(value)


def _valid_timestamp(value: str) -> str:
    try:
        _AWARE_DATETIME_ADAPTER.validate_python(value)
    except ValidationError as error:
        raise PydanticCustomError(
            "timestamp",
            "must be an ISO 8601 timestamp with a UTC offset",
        ) from error
    return value


def _optional_text(value: object) -> object:
    if not isinstance(value, str):
        return value
    trimmed = _PROTOCOL_EDGE_WHITESPACE.sub("", value)
    return trimmed or None


UnicodeText: TypeAlias = Annotated[
    str,
    StringConstraints(strict=True),
    AfterValidator(_valid_unicode),
]

Identifier: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=MAX_SELECTION_ID)),
]

CellId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=MAX_CELL_ID)),
]

RequestId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=256)),
]

# The largest label number whose successor still fits in a label.
MAX_SELECTION_LABEL = 10**15 - 2

SelectionLabel: TypeAlias = Annotated[
    UnicodeText,
    StringConstraints(pattern=r"^S[1-9][0-9]*$"),
    AfterValidator(partial(bounded_utf16, maximum=16)),
]

NoteText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(bounded_utf16, maximum=MAX_NOTE)),
]

DomFieldText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(bounded_utf16, maximum=MAX_DOM_FIELD)),
]

DomContentText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(bounded_utf16, maximum=MAX_DOM_TEXT)),
]

DomSelectorText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=MAX_DOM_SELECTOR)),
]

ErrorText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(partial(bounded_utf16, maximum=MAX_ERROR)),
]

NonEmptyErrorText: TypeAlias = Annotated[ErrorText, AfterValidator(nonblank)]

AttentionText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=MAX_ATTENTION_MESSAGE)),
]

OptionalAttentionText: TypeAlias = Annotated[
    AttentionText | None,
    BeforeValidator(_optional_text),
]

RevealText: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=MAX_REVEAL_MESSAGE)),
]

OptionalRevealText: TypeAlias = Annotated[
    RevealText | None,
    BeforeValidator(_optional_text),
]

AttentionLabel: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=MAX_ATTENTION_LABEL)),
]

OptionalAttentionLabel: TypeAlias = Annotated[
    AttentionLabel | None,
    BeforeValidator(_optional_text),
]

TimestampText: TypeAlias = Annotated[
    UnicodeText,
    StringConstraints(
        min_length=1,
        pattern=_TIMESTAMP_PATTERN,
    ),
    AfterValidator(partial(bounded_utf16, maximum=64)),
    AfterValidator(_valid_timestamp),
]

Sha256: TypeAlias = Annotated[
    str,
    StringConstraints(strict=True, pattern=r"^[a-f0-9]{64}$"),
]

NormalizedNumber: TypeAlias = Annotated[
    float,
    Field(strict=True, ge=0, le=1, allow_inf_nan=False),
]

PositiveNormalizedNumber: TypeAlias = Annotated[
    float,
    Field(strict=True, gt=0, le=1, allow_inf_nan=False),
]

PositiveSafeInteger: TypeAlias = Annotated[
    int,
    Field(strict=True, ge=1, le=MAX_SAFE_INTEGER),
]

NonNegativeSafeInteger: TypeAlias = Annotated[
    int,
    Field(strict=True, ge=0, le=MAX_SAFE_INTEGER),
]

AttentionDuration: TypeAlias = Annotated[
    int,
    Field(strict=True, ge=1, le=MAX_ATTENTION_DURATION_MS),
]

Revision: TypeAlias = NonNegativeSafeInteger

SelectionImageId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=len("image:") + MAX_SELECTION_ID)),
]

OutputImageId: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=len("image:") + 256)),
]

ErrorCode: TypeAlias = Annotated[
    UnicodeText,
    AfterValidator(nonblank),
    AfterValidator(partial(bounded_utf16, maximum=128)),
]

SELECTION_ID_ADAPTER = TypeAdapter(Identifier)

NOTE_ADAPTER = TypeAdapter(NoteText)

REQUEST_ID_ADAPTER = TypeAdapter(RequestId)

CELL_ID_ADAPTER = TypeAdapter(CellId)

DOM_SELECTOR_ADAPTER = TypeAdapter(DomSelectorText)

REVISION_ADAPTER = TypeAdapter(Revision)

OPTIONAL_ATTENTION_TEXT_ADAPTER = TypeAdapter(OptionalAttentionText)

OPTIONAL_REVEAL_TEXT_ADAPTER = TypeAdapter(OptionalRevealText)

OPTIONAL_ATTENTION_LABEL_ADAPTER = TypeAdapter(OptionalAttentionLabel)

ATTENTION_DURATION_ADAPTER = TypeAdapter(AttentionDuration)
