from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import cast

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    """Require the browser artifacts that form the Python package boundary."""

    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        if version == "editable":
            return

        if self.target_name == "sdist":
            # Hatch force-includes the workspace VCS ignore file after applying
            # sdist selection. Keep the archive limited to package-owned files.
            raw_force_include = build_data.get("force_include")
            if isinstance(raw_force_include, dict):
                force_include = cast(dict[str, str], raw_force_include)
                for source, target in tuple(force_include.items()):
                    if target == ".gitignore":
                        del force_include[source]

        static = Path(self.root, "src", "marimo_lens", "static")
        manifest_path = static / "anywidget.json"
        required = [manifest_path]
        if manifest_path.is_file():
            required.extend(_manifest_artifacts(static, manifest_path))
        missing = [
            path.relative_to(self.root) for path in required if not path.is_file()
        ]
        if missing:
            details = "\n".join(f"  - {path}" for path in missing)
            raise RuntimeError(
                f"Build the @marimo-lens/python frontend before packaging:\n{details}"
            )


def _manifest_artifacts(static: Path, manifest_path: Path) -> list[Path]:
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("The anywidget bundle manifest is invalid.") from error
    if (
        not isinstance(raw, Mapping)
        or type(raw.get("version")) is not int
        or raw.get("version") != 1
    ):
        raise RuntimeError("The anywidget bundle manifest must use version 1.")

    entry = _manifest_reference(raw.get("entry"), field="entry")
    app = _manifest_reference(raw.get("app"), field="app")
    if "style" not in raw:
        raise RuntimeError(
            "The anywidget bundle manifest style must be a CSS path or null."
        )
    style_value = raw.get("style")
    style = (
        None if style_value is None else _manifest_reference(style_value, field="style")
    )
    modules_value = raw.get("modules")
    if not isinstance(modules_value, list):
        raise RuntimeError(
            "The anywidget bundle manifest modules must be JavaScript paths."
        )
    modules = [_manifest_reference(module, field="modules") for module in modules_value]
    if not modules or app not in modules:
        raise RuntimeError("The anywidget bundle manifest modules must include app.")

    relative_paths = [entry, *modules]
    if style is not None:
        relative_paths.append(style)
    return [static.joinpath(*PurePosixPath(path).parts) for path in relative_paths]


def _manifest_reference(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise RuntimeError(
            f"The anywidget bundle manifest {field} contains an invalid path."
        )
    parts = value.split("/")
    if (
        not value
        or value.startswith("/")
        or "\\" in value
        or any(part in ("", ".", "..") for part in parts)
    ):
        raise RuntimeError(
            f"The anywidget bundle manifest {field} contains an invalid path."
        )
    return value
