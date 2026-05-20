from __future__ import annotations


def _capabilities(**overrides: bool) -> dict[str, bool]:
    result = {
        "columnarDom": False,
        "columnarGrid": False,
        "visualSurface": False,
        "chartPart": False,
        "media": False,
        "document": False,
        "data": False,
        "diagnostic": False,
        "interactive": False,
    }
    result.update(overrides)
    return result
