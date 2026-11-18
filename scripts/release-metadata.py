"""Read coordinated release metadata; --sync updates version mirrors."""

import json
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib
version = tomllib.loads(
    Path("packages/marimo-lens/pyproject.toml").read_text(encoding="utf-8")
)["project"]["version"]
print(json.dumps({"version": version}))
