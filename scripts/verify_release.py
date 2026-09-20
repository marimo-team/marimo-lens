from __future__ import annotations

import pydoc
import subprocess
import sys
from importlib.metadata import distribution
from pathlib import Path
from types import SimpleNamespace

import agent_plugins as ap
import marimo._code_mode as code_mode
import marimo_lens.agent
from marimo_lens import (
    ActivityHandle,
    Lens,
    LensContext,
    LensError,
    LensReferences,
    NotebookReference,
    SelectionReference,
    __version__,
)
from marimo_lens.agent import MountedLens, add_lens_cell, connect


def verify_release(expected_version: str) -> None:
    installed_distribution = distribution("marimo-lens")
    installed_version = installed_distribution.version
    if installed_version != expected_version:
        raise SystemExit(
            f"Installed marimo-lens version {installed_version} does not match "
            f"release {expected_version}"
        )
    if __version__ != installed_version:
        raise SystemExit(
            f"marimo_lens.__version__ {__version__} does not match installed "
            f"distribution {installed_version}"
        )

    requirements = installed_distribution.requires or ()
    if "agent-plugins>=0.2.4" not in requirements:
        raise SystemExit("marimo-lens must require agent-plugins>=0.2.4")

    capabilities = [
        entry_point
        for entry_point in installed_distribution.entry_points
        if entry_point.group == "marimo.agent.capability"
    ]
    if [(entry.name, entry.value) for entry in capabilities] != [
        ("lens", "marimo_lens.agent")
    ]:
        raise SystemExit("marimo-lens has an invalid agent capability entry point")
    if capabilities[0].load() is not marimo_lens.agent:
        raise SystemExit("The Lens capability does not load marimo_lens.agent")
    if code_mode.capabilities().get("lens") != "marimo_lens.agent":
        raise SystemExit("Marimo code mode cannot discover the Lens capability")

    plugin = marimo_lens.agent.plugin()
    skill = marimo_lens.agent.skill()
    if plugin.manifest.name != "marimo-lens":
        raise SystemExit("The installed Agent Plugin manifest is not marimo-lens")
    if plugin.path.name != f"marimo_lens-{installed_version}.agent-plugin":
        raise SystemExit(f"Unexpected installed Agent Plugin path: {plugin.path}")
    if skill not in plugin.skills or skill.path.name != "marimo-lens":
        raise SystemExit("The installed Agent Plugin cannot resolve the Lens skill")
    expected_skill_files = {
        "SKILL.md",
        "agents/openai.yaml",
        "references/setup.md",
        "references/targets.md",
        "references/selections.md",
        "references/workflow.md",
    }
    if {
        path.relative_to(skill.path).as_posix() for path in skill.files
    } != expected_skill_files:
        raise SystemExit(
            "The installed Lens skill inventory does not match its authored resources"
        )
    if skill.frontmatter.splitlines()[0] != "name: marimo-lens":
        raise SystemExit("The installed Lens skill has invalid frontmatter")
    help_text = pydoc.render_doc(marimo_lens.agent)
    if str(plugin.path) not in help_text or str(skill / "SKILL.md") not in help_text:
        raise SystemExit("marimo_lens.agent help cannot locate its packaged resources")
    briefing = ap.read("marimo-lens")
    if marimo_lens.agent.__doc__ != briefing or skill.source not in briefing:
        raise SystemExit("Lens module help does not expose the installed core briefing")
    cli = subprocess.run(
        [sys.executable, "-m", "agent_plugins", "read", "marimo-lens"],
        capture_output=True,
        text=True,
        check=True,
    )
    if cli.stdout != briefing:
        raise SystemExit("Lens CLI and Python briefings differ")

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
        "LensReferences": LensReferences,
        "MountedLens": MountedLens,
        "NotebookReference": NotebookReference,
        "SelectionReference": SelectionReference,
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
    if not isinstance(ActivityHandle("activity"), str):
        raise SystemExit("ActivityHandle values must be JSON-safe strings")
    if not all(
        callable(function)
        for function in (
            add_lens_cell,
            marimo_lens.agent.plugin,
            marimo_lens.agent.skill,
            connect,
        )
    ):
        raise SystemExit("marimo_lens.agent handoff exports are not callable")

    lens = Lens()
    try:
        context = lens.context()
        if not isinstance(context, LensContext):
            raise SystemExit(
                f"Lens.context() returned {type(context).__name__}, expected LensContext"
            )
        if context.revision != 0 or context.current is not None or context.images:
            raise SystemExit("A new Lens returned unexpected selection state")
        mounted = marimo_lens.agent.connect(SimpleNamespace(globals={"lens": lens}))
        if mounted.context().revision != context.revision:
            raise SystemExit("The agent adapter cannot bind an existing Lens")
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
