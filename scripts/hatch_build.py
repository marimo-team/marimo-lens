from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        root = Path(self.root)
        if (
            not (root / "package.json").exists()
            or not (root / "js/widget.tsx").exists()
        ):
            return
        if shutil.which("pnpm") is None:
            raise RuntimeError("Building marimo-lens requires pnpm for frontend assets")
        subprocess.run(["pnpm", "run", "build"], cwd=root, check=True)
