"""Steps in an ordered reveal."""

from typing import TypedDict

from typing_extensions import NotRequired

from .context import SelectionReference


class RevealStep(TypedDict):
    """A cell or selection and the explanation shown while visiting it."""

    target: str | SelectionReference
    label: NotRequired[str]
    message: NotRequired[str]
