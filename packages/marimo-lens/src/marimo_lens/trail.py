"""Steps in a user-paced notebook Trail."""

from typing import TypedDict

from typing_extensions import NotRequired


class TrailStep(TypedDict):
    """A notebook cell and the explanation shown while visiting it."""

    cell_id: str
    label: str
    message: NotRequired[str]
