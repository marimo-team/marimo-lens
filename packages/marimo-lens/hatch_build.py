from __future__ import annotations

from pathlib import Path
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
        required = [static / "widget.js", static / "widget.css"]
        missing = [
            path.relative_to(self.root) for path in required if not path.is_file()
        ]
        if missing:
            details = "\n".join(f"  - {path}" for path in missing)
            raise RuntimeError(
                f"Build the @marimo-lens/python frontend before packaging:\n{details}"
            )
