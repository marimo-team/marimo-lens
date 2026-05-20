from __future__ import annotations

import subprocess
import tarfile
import zipfile
from pathlib import Path


def test_built_package_contains_current_inspector_tree(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    subprocess.run(
        ["uv", "build", "--out-dir", str(dist_dir)],
        check=True,
        text=True,
    )

    wheel = next(dist_dir.glob("marimo_lens-*.whl"))
    sdist = next(dist_dir.glob("marimo_lens-*.tar.gz"))

    with zipfile.ZipFile(wheel) as archive:
        wheel_names = set(archive.namelist())
    assert "marimo_lens/agent_activity.py" in wheel_names
    assert "marimo_lens/charts.py" in wheel_names
    assert "marimo_lens/pair.py" in wheel_names
    assert "marimo_lens/py.typed" in wheel_names
    assert "marimo_lens/selection.py" in wheel_names
    assert "marimo_lens/inspectors/media.py" in wheel_names
    assert "marimo_lens/inspectors/outputs.py" in wheel_names
    assert "marimo_lens/_pipeline.py" in wheel_names
    assert "marimo_lens/pipeline.py" not in wheel_names
    assert "marimo_lens/inspectors/visualization.py" not in wheel_names
    assert "marimo_lens/static/widget.js" in wheel_names

    with tarfile.open(sdist) as archive:
        sdist_names = {
            name.split("/", 1)[1] for name in archive.getnames() if "/" in name
        }
    assert "src/marimo_lens/inspectors/media.py" in sdist_names
    assert "src/marimo_lens/agent_activity.py" in sdist_names
    assert "src/marimo_lens/charts.py" in sdist_names
    assert "src/marimo_lens/pair.py" in sdist_names
    assert "src/marimo_lens/py.typed" in sdist_names
    assert "src/marimo_lens/selection.py" in sdist_names
    assert "src/marimo_lens/inspectors/outputs.py" in sdist_names
    assert "src/marimo_lens/_pipeline.py" in sdist_names
    assert "src/marimo_lens/pipeline.py" not in sdist_names
    assert "scripts/hatch_build.py" in sdist_names
