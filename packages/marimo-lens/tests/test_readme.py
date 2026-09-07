from __future__ import annotations

import re
import runpy
from pathlib import Path

import pytest
from marimo_lens import Lens


@pytest.mark.parametrize("path", ["README.md", "packages/marimo-lens/README.md"])
def test_readme_python_examples_execute(tmp_path: Path, path: str) -> None:
    readme = Path(__file__).resolve().parents[3] / path
    examples = re.findall(
        r"```python\n(.*?)\n```",
        readme.read_text(encoding="utf-8"),
        flags=re.DOTALL,
    )

    script = tmp_path / "readme_examples.py"
    script.write_text("\n\n".join(examples), encoding="utf-8")
    namespace = runpy.run_path(str(script))

    lens = namespace["lens"]
    assert isinstance(lens, Lens)
    lens.close()
