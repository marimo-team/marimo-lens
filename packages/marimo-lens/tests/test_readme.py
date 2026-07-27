from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from marimo_lens import Lens


def test_root_readme_python_examples_execute() -> None:
    readme = Path(__file__).resolve().parents[3] / "README.md"
    examples = re.findall(
        r"```python\n(.*?)\n```",
        readme.read_text(encoding="utf-8"),
        flags=re.DOTALL,
    )

    namespace: dict[str, Any] = {}
    for example in examples:
        # README snippets are repository-controlled executable test inputs.
        exec(compile(example, str(readme), "exec"), namespace)  # noqa: S102

    lens = namespace["lens"]
    assert isinstance(lens, Lens)
    lens.close()
