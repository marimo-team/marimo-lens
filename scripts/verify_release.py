from __future__ import annotations

import sys
from importlib.metadata import distribution
from pathlib import Path

from marimo_lens import Lens, LensContext, LensError, SelectionImage


def verify_release(expected_version: str) -> None:
    installed_distribution = distribution("marimo-lens")
    installed_version = installed_distribution.version
    if installed_version != expected_version:
        raise SystemExit(
            f"Installed marimo-lens version {installed_version} does not match "
            f"release {expected_version}"
        )

    license_paths = [
        path
        for path in installed_distribution.files or ()
        if path.name == "LICENSE" and path.parent.name == "licenses"
    ]
    if len(license_paths) != 1:
        raise SystemExit(
            f"Installed marimo-lens contains {len(license_paths)} license files, "
            "expected one"
        )
    installed_license = Path(
        str(installed_distribution.locate_file(license_paths[0]))
    ).read_bytes()
    repository_license = (Path(__file__).resolve().parents[1] / "LICENSE").read_bytes()
    if installed_license != repository_license:
        raise SystemExit(
            "Installed marimo-lens license does not match the repository license"
        )

    public_types = {
        "Lens": Lens,
        "LensContext": LensContext,
        "LensError": LensError,
        "SelectionImage": SelectionImage,
    }
    invalid_types = [
        name
        for name, public_type in public_types.items()
        if not isinstance(public_type, type)
    ]
    if invalid_types:
        raise SystemExit(
            f"marimo-lens exports are not classes: {', '.join(invalid_types)}"
        )

    lens = Lens()
    try:
        context = lens.context()
        if not isinstance(context, LensContext):
            raise SystemExit(
                f"Lens.context() returned {type(context).__name__}, expected LensContext"
            )
        if context.revision != 0 or context.current is not None:
            raise SystemExit("A new Lens returned unexpected selection state")
    finally:
        lens.close()


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/verify_release.py VERSION")

    expected_version = sys.argv[1]
    verify_release(expected_version)
    print(f"Verified marimo-lens {expected_version}")


if __name__ == "__main__":
    main()
