"""Protect preview publication through its scripts and workflow steps."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from base64 import b64encode
from hashlib import sha256
from pathlib import Path
from typing import Any

import pytest
import yaml
from packaging.version import Version

pytestmark = pytest.mark.skipif(
    os.name == "nt", reason="Publication scripts run on POSIX runners"
)

ROOT = Path(__file__).resolve().parents[2]
COMMIT = "a" * 40
REPOSITORY = "marimo-team/marimo-lens"
DOWNLOADS = f"https://github.com/{REPOSITORY}/releases/download/preview"
PREVIEW_PREDICATE_TYPE = (
    f"https://github.com/{REPOSITORY}/blob/main/"
    "development_docs/release.md#preview-provenance-v1"
)


def _workflow(name: str) -> dict[str, Any]:
    return yaml.load(
        (ROOT / ".github" / "workflows" / name).read_text(), Loader=yaml.BaseLoader
    )


def _git(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=root,
        env={
            **os.environ,
            "GIT_AUTHOR_NAME": "Lens",
            "GIT_AUTHOR_EMAIL": "lens@example.test",
            "GIT_COMMITTER_NAME": "Lens",
            "GIT_COMMITTER_EMAIL": "lens@example.test",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
        },
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _commit(root: Path) -> str:
    _git(root, "commit", "--allow-empty", "-m", "change")
    return _git(root, "rev-parse", "HEAD")


def _version(root: Path, commit: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(ROOT / "scripts/preview-version.sh"), commit],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )


def test_preview_versions_sort_between_releases_and_survive_tagging(
    tmp_path: Path,
) -> None:
    _git(tmp_path, "init", "--quiet")
    _commit(tmp_path)
    _git(tmp_path, "tag", "-a", "v0.2.3", "-m", "release")
    first = _commit(tmp_path)
    candidate = _commit(tmp_path)
    before_tag = _version(tmp_path, candidate).stdout.strip()
    _git(tmp_path, "tag", "-a", "v0.2.4", "-m", "release", candidate)
    next_commit = _commit(tmp_path)

    versions = [
        _version(tmp_path, first).stdout.strip(),
        before_tag,
        _version(tmp_path, candidate).stdout.strip(),
        _version(tmp_path, next_commit).stdout.strip(),
    ]

    assert versions == ["0.2.4.dev1", "0.2.4.dev2", "0.2.4.dev2", "0.2.5.dev1"]
    assert (
        Version(versions[0])
        < Version(versions[1])
        < Version("0.2.4")
        < Version(versions[3])
    )


def test_preview_version_ignores_suffixed_and_unreachable_tags(
    tmp_path: Path,
) -> None:
    _git(tmp_path, "init", "--quiet")
    released = _commit(tmp_path)
    _git(tmp_path, "tag", "v0.2.3", released)
    _git(tmp_path, "checkout", "--detach", released)
    _git(tmp_path, "commit", "--allow-empty", "-m", "unreachable release")
    _git(tmp_path, "tag", "v9.0.0")
    _git(tmp_path, "checkout", "--detach", released)
    _commit(tmp_path)
    _git(tmp_path, "tag", "v0.2.4-rc1")
    _git(tmp_path, "tag", "v0.2.4.dev10")
    candidate = _commit(tmp_path)

    completed = _version(tmp_path, candidate)

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "0.2.4.dev2"


def test_preview_version_reads_a_zero_padded_patch_as_decimal(tmp_path: Path) -> None:
    _git(tmp_path, "init", "--quiet")
    _commit(tmp_path)
    _git(tmp_path, "tag", "v0.2.08")
    candidate = _commit(tmp_path)

    completed = _version(tmp_path, candidate)

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "0.2.9.dev1"


def test_preview_version_requires_a_previous_final_release(tmp_path: Path) -> None:
    _git(tmp_path, "init", "--quiet")
    _commit(tmp_path)
    candidate = _commit(tmp_path)

    completed = _version(tmp_path, candidate)

    assert completed.returncode == 1
    assert "No vX.Y.Z release tag precedes" in completed.stderr


def _artifacts(version: str) -> dict[str, bytes]:
    artifacts = {
        f"marimo_lens-{version}-py3-none-any.whl": f"wheel {version}".encode(),
        f"marimo_lens-{version}.tar.gz": f"source {version}".encode(),
    }
    artifacts[f"marimo-lens-{version}-SHA256SUMS"] = "".join(
        f"{sha256(contents).hexdigest()}  {name}\n"
        for name, contents in sorted(artifacts.items())
    ).encode()
    return artifacts


# Keeps the preview release as JSON so tests can inspect what a reader of the
# GitHub release would see. Empty assets stand for GitHub's upload starters.
_GH = """import json, os, sys
from base64 import b64decode, b64encode
from hashlib import sha256
from pathlib import Path
state_path = Path(os.environ["FAKE_GITHUB"])
state = json.loads(state_path.read_text())
args = sys.argv[1:]
state["calls"].append(args)
state_path.write_text(json.dumps(state))
operation = " ".join(args[:2])
if state["fail"] == operation:
    state["fail"] = ""
    state_path.write_text(json.dumps(state))
    sys.exit(1)
if args[0] == "release":
    assert args[2] == "preview"
if operation == "run list":
    assert args[args.index("--branch") + 1] == "main"
    assert args[args.index("--event") + 1] == "push"
    assert args[args.index("--limit") + 1] == "1"
    print(state["runs"][args[args.index("--workflow") + 1]], end="")
elif operation == "attestation download":
    assert "--predicate-type" not in args
    if state.get("attestation_unavailable"):
        sys.exit(1)
    digest = sha256(Path(args[2]).read_bytes()).hexdigest()
    Path(f"sha256:{digest}.jsonl").write_text(json.dumps(state["attestations"]))
elif operation == "attestation verify":
    predicate_type = os.environ["PREVIEW_PREDICATE_TYPE"]
    assert args[args.index("--predicate-type") + 1] == predicate_type
    assert args[args.index("--signer-workflow") + 1] == (
        "marimo-team/marimo-lens/.github/workflows/ci.yml"
    )
    print(Path(args[args.index("--bundle") + 1]).read_text())
elif operation == "release view":
    if state.get("release_error"):
        print(state["release_error"], file=sys.stderr)
        sys.exit(1)
    if not state["exists"]:
        print("release not found", file=sys.stderr)
        sys.exit(1)
    if "--json" in args:
        query = args[args.index("--jq") + 1]
        if '"starter"' in query:
            names = state["starters"]
        elif '"uploaded"' in query:
            names = [name for name, data in state["assets"].items() if b64decode(data)]
        else:
            names = [*state["assets"], *state["starters"]]
        print("\\n".join(names))
elif operation == "release create":
    assert "--prerelease" in args and "--latest=false" in args
    state["exists"] = True
    state["target"] = args[args.index("--target") + 1]
elif operation == "release upload":
    path = Path(args[3])
    assert path.name not in state["assets"]
    assert path.name not in state["starters"]
    state["assets"][path.name] = b64encode(path.read_bytes()).decode()
elif operation == "release download":
    name = args[args.index("--pattern") + 1]
    directory = Path(args[args.index("--dir") + 1])
    (directory / name).write_bytes(b64decode(state["assets"][name]))
elif operation == "release edit":
    state["notes"] = Path(args[args.index("--notes-file") + 1]).read_text()
elif operation == "release delete-asset":
    if args[3] in state["starters"]:
        state["starters"].remove(args[3])
    else:
        del state["assets"][args[3]]
elif args[0] == "api":
    if args[1].endswith("/pulls"):
        print(state["pull"])
    else:
        print("\\n".join(state["comments"]))
elif operation == "pr comment":
    state["comments"].append(Path(args[args.index("--body-file") + 1]).read_text())
else:
    raise AssertionError(args)
state_path.write_text(json.dumps(state))
"""


class _GitHub:
    def __init__(self, root: Path, *, versions: tuple[str, ...] = ()) -> None:
        self.root = root
        self.state_path = root / "github.json"
        self.commands = root / "commands"
        self.commands.mkdir()
        assets = {
            name: b64encode(contents).decode()
            for version in versions
            for name, contents in _artifacts(version).items()
        }
        self.write(
            {
                "exists": bool(assets),
                "assets": assets,
                "starters": [],
                "notes": "",
                "comments": [],
                "calls": [],
                "fail": "",
                "pull": "95",
                "runs": {
                    "ci.yml": "completed\nsuccess\nhttps://example.test/ci\n",
                    "pages.yml": "completed\nsuccess\nhttps://example.test/pages\n",
                },
            }
        )
        command = self.commands / "gh"
        command.write_text(f"#!{sys.executable}\n{_GH}", encoding="utf-8")
        command.chmod(0o755)

    def state(self) -> dict[str, Any]:
        return json.loads(self.state_path.read_text())

    def write(self, state: dict[str, Any]) -> None:
        self.state_path.write_text(json.dumps(state))

    def fail(self, operation: str) -> None:
        state = self.state()
        state["fail"] = operation
        self.write(state)

    def env(self) -> dict[str, str]:
        return {
            **os.environ,
            "FAKE_GITHUB": str(self.state_path),
            "GH_REPO": REPOSITORY,
            "GH_TOKEN": "test-token",
            "PREVIEW_PREDICATE_TYPE": PREVIEW_PREDICATE_TYPE,
            "GITHUB_SERVER_URL": "https://github.com",
            "PATH": f"{self.commands}{os.pathsep}{os.environ['PATH']}",
        }

    def publish(
        self, version: str, *, corrupt: bool = False
    ) -> subprocess.CompletedProcess[str]:
        # Each invocation receives exactly one build, like download-artifact.
        dist = self.root / "dist"
        shutil.rmtree(dist, ignore_errors=True)
        dist.mkdir()
        for name, contents in _artifacts(version).items():
            (dist / name).write_bytes(contents)
        if corrupt:
            (dist / f"marimo_lens-{version}-py3-none-any.whl").write_bytes(b"damaged")
        return subprocess.run(
            ["bash", str(ROOT / "scripts/publish-preview.sh"), str(dist), COMMIT],
            env=self.env(),
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

    def resolve(
        self, root: Path, commit: str, *, event: str = "workflow_run"
    ) -> tuple[int, str, str]:
        scripts = root / "scripts"
        scripts.mkdir(exist_ok=True)
        for name in ("preview-version.sh", "require-preview-checks.sh"):
            shutil.copy2(ROOT / "scripts" / name, scripts / name)
        step = next(
            step
            for step in _workflow("publish.yml")["jobs"]["resolve"]["steps"]
            if step.get("id") == "identity"
        )
        output = root / "output"
        output.touch()
        completed = subprocess.run(
            ["bash", "-eu", "-o", "pipefail", "-c", step["run"]],
            cwd=root,
            env={
                **self.env(),
                "PUBLICATION_EVENT": event,
                "PREVIEW_COMMIT": commit if event == "workflow_run" else "",
                "GITHUB_SHA": "b" * 40 if event == "workflow_run" else commit,
                "GITHUB_REF_NAME": "v0.2.4",
                "GITHUB_OUTPUT": str(output),
            },
            capture_output=True,
            text=True,
            check=False,
        )
        return completed.returncode, output.read_text(), completed.stderr


def _released_repository(root: Path) -> str:
    _git(root, "init", "--quiet")
    _commit(root)
    _git(root, "tag", "v0.2.3")
    return _commit(root)


@pytest.mark.parametrize("workflow", ["ci.yml", "pages.yml"])
@pytest.mark.parametrize(
    "run",
    [
        "",
        "in_progress\n\nhttps://example.test/run\n",
        "completed\nfailure\nhttps://example.test/run\n",
        "completed\ncancelled\nhttps://example.test/run\n",
        "completed\nskipped\nhttps://example.test/run\n",
    ],
)
def test_preview_waits_for_both_exact_commit_workflows(
    tmp_path: Path, workflow: str, run: str
) -> None:
    github = _GitHub(tmp_path)
    state = github.state()
    state["runs"][workflow] = run
    github.write(state)

    completed = subprocess.run(
        ["bash", str(ROOT / "scripts/require-preview-checks.sh"), COMMIT],
        env=github.env(),
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 3
    assert workflow in completed.stderr
    for call in github.state()["calls"]:
        assert call[call.index("--commit") + 1] == COMMIT


@pytest.mark.parametrize("published", ["none", "partial", "starter", "complete"])
def test_preview_readiness_uses_the_validated_commit_and_completion_marker(
    tmp_path: Path, published: str
) -> None:
    github = _GitHub(tmp_path, versions=() if published == "none" else ("0.2.4.dev1",))
    if published in {"partial", "starter"}:
        state = github.state()
        del state["assets"]["marimo-lens-0.2.4.dev1-SHA256SUMS"]
        if published == "starter":
            state["starters"].append("marimo-lens-0.2.4.dev1-SHA256SUMS")
        github.write(state)
    candidate = _released_repository(tmp_path)

    returncode, output, stderr = github.resolve(tmp_path, candidate)

    assert returncode == 0, stderr
    assert f"commit={candidate}\n" in output
    assert "version=0.2.4.dev1\n" in output
    assert f"publish={'false' if published == 'complete' else 'true'}\n" in output


def test_pending_workflow_defers_preview_publication(tmp_path: Path) -> None:
    github = _GitHub(tmp_path)
    state = github.state()
    state["runs"]["pages.yml"] = "in_progress\n\nhttps://example.test/pages\n"
    github.write(state)
    candidate = _released_repository(tmp_path)

    returncode, output, stderr = github.resolve(tmp_path, candidate)

    assert returncode == 0, stderr
    assert "publish=false\n" in output
    assert all(call[:2] != ["release", "view"] for call in github.state()["calls"])


def test_tag_push_resolves_a_release_publication(tmp_path: Path) -> None:
    github = _GitHub(tmp_path)

    returncode, output, stderr = github.resolve(tmp_path, COMMIT, event="push")

    assert returncode == 0, stderr
    assert output == (
        f"channel=release\ncommit={COMMIT}\nversion=0.2.4\npublish=true\n"
    )
    assert github.state()["calls"] == []


def test_built_checksum_manifest_completes_the_preview(tmp_path: Path) -> None:
    github = _GitHub(tmp_path)
    candidate = _released_repository(tmp_path)
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "marimo_lens-0.2.4.dev1-py3-none-any.whl").write_bytes(b"wheel")
    (dist / "marimo_lens-0.2.4.dev1.tar.gz").write_bytes(b"source")
    step = next(
        step
        for step in _workflow("publish.yml")["jobs"]["build"]["steps"]
        if step["name"] == "Record preview checksums"
    )
    subprocess.run(
        ["bash", "-eu", "-o", "pipefail", "-c", step["run"]],
        cwd=dist,
        env={**os.environ, "VERSION": "0.2.4.dev1"},
        check=True,
    )

    published = subprocess.run(
        ["bash", str(ROOT / "scripts/publish-preview.sh"), str(dist), candidate],
        env=github.env(),
        capture_output=True,
        text=True,
        check=False,
    )
    returncode, output, stderr = github.resolve(tmp_path, candidate)

    assert published.returncode == 0, published.stderr
    assert "marimo-lens-0.2.4.dev1-SHA256SUMS" in github.state()["assets"]
    assert returncode == 0, stderr
    assert "publish=false\n" in output


def test_readiness_api_failure_fails_publication_resolution(tmp_path: Path) -> None:
    github = _GitHub(tmp_path)
    github.fail("run list")
    candidate = _released_repository(tmp_path)

    returncode, output, _ = github.resolve(tmp_path, candidate)

    assert returncode == 1
    assert "publish=" not in output
    assert all(call[:2] != ["release", "view"] for call in github.state()["calls"])


def test_release_api_failure_fails_publication_resolution(tmp_path: Path) -> None:
    github = _GitHub(tmp_path, versions=("0.2.4.dev1",))
    state = github.state()
    state["release_error"] = "HTTP 502: Bad Gateway"
    github.write(state)
    candidate = _released_repository(tmp_path)

    returncode, output, stderr = github.resolve(tmp_path, candidate)

    assert returncode == 1
    assert "HTTP 502" in stderr
    assert "publish=" not in output


@pytest.mark.parametrize(
    ("path", "ref", "event"),
    [
        ("publish.yml", "refs/heads/main", "workflow_run"),
        ("ci.yml", "refs/pull/95/merge", "pull_request"),
    ],
)
def test_preview_provenance_records_checkout_and_signing_workflow_separately(
    tmp_path: Path, path: str, ref: str, event: str
) -> None:
    output = tmp_path / "predicate.json"
    step_output = tmp_path / "step-output"
    workflow_commit = "b" * 40
    subprocess.run(
        ["node", str(ROOT / "scripts/preview-provenance.mjs"), COMMIT, str(output)],
        env={
            **os.environ,
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_REPOSITORY": REPOSITORY,
            "GITHUB_WORKFLOW_REF": f"{REPOSITORY}/.github/workflows/{path}@{ref}",
            "GITHUB_REF": ref,
            "GITHUB_SHA": workflow_commit,
            "GITHUB_EVENT_NAME": event,
            "GITHUB_OUTPUT": str(step_output),
            "GITHUB_REPOSITORY_ID": "123",
            "GITHUB_REPOSITORY_OWNER_ID": "456",
            "RUNNER_ENVIRONMENT": "github-hosted",
            "GITHUB_RUN_ID": "789",
            "GITHUB_RUN_ATTEMPT": "2",
        },
        check=True,
        capture_output=True,
        text=True,
    )
    predicate = json.loads(output.read_text())

    definition = predicate["buildDefinition"]
    assert step_output.read_text() == f"predicate_type={PREVIEW_PREDICATE_TYPE}\n"
    assert definition["buildType"] == PREVIEW_PREDICATE_TYPE
    assert definition["externalParameters"]["workflow"]["path"] == (
        f".github/workflows/{path}"
    )
    assert definition["externalParameters"]["checkoutCommit"] == COMMIT
    assert definition["resolvedDependencies"] == [
        {
            "uri": f"git+https://github.com/{REPOSITORY}@{ref}",
            "digest": {"gitCommit": workflow_commit},
        },
        {
            "uri": f"git+https://github.com/{REPOSITORY}@{COMMIT}",
            "digest": {"gitCommit": COMMIT},
        },
    ]
    assert predicate["runDetails"]["metadata"]["invocationId"].endswith(
        "/runs/789/attempts/2"
    )


def test_preview_attestation_signs_the_validated_commit() -> None:
    jobs = _workflow("publish.yml")["jobs"]
    steps = jobs["attest"]["steps"]
    provenance = next(step for step in steps if step.get("id") == "provenance")
    attest = steps[-1]

    assert provenance["env"]["PREVIEW_COMMIT"] == "${{ needs.resolve.outputs.commit }}"
    assert attest["with"]["predicate-type"] == (
        "${{ steps.provenance.outputs.predicate_type }}"
    )
    assert "preview-provenance.json" in attest["with"]["predicate-path"]
    assert jobs["preview"]["steps"][-1]["env"]["PREVIEW_PREDICATE_TYPE"] == (
        "${{ needs.attest.outputs.predicate_type }}"
    )


@pytest.mark.parametrize(
    ("checkout_commit", "availability", "attempts"),
    [
        (COMMIT, "ready", 1),
        ("b" * 40, "ready", 1),
        (COMMIT, "delayed", 2),
        (COMMIT, "unavailable", 5),
    ],
)
def test_ci_probe_requires_the_attested_checkout_commit(
    tmp_path: Path, checkout_commit: str, availability: str, attempts: int
) -> None:
    github = _GitHub(tmp_path)
    state = github.state()
    state["attestations"] = [
        {
            "verificationResult": {
                "statement": {
                    "predicate": {
                        "buildDefinition": {
                            "externalParameters": {"checkoutCommit": checkout_commit}
                        }
                    }
                }
            }
        }
    ]
    if availability == "delayed":
        state["fail"] = "attestation download"
    state["attestation_unavailable"] = availability == "unavailable"
    github.write(state)
    (tmp_path / "preview-provenance-probe.txt").write_text("probe\n")
    verify = _workflow("ci.yml")["jobs"]["preview-provenance"]["steps"][-1]

    completed = subprocess.run(
        ["bash", "-eu", "-o", "pipefail", "-c", "sleep() { :; }\n" + verify["run"]],
        env={
            **github.env(),
            "GITHUB_SHA": COMMIT,
            "GITHUB_REPOSITORY": REPOSITORY,
            "RUNNER_TEMP": str(tmp_path),
        },
        capture_output=True,
        text=True,
        check=False,
    )

    expected = 0 if checkout_commit == COMMIT and availability != "unavailable" else 1
    assert completed.returncode == expected, completed.stderr
    calls = github.state()["calls"]
    assert sum(call[:2] == ["attestation", "download"] for call in calls) == attempts
    assert sum(call[:2] == ["attestation", "verify"] for call in calls) == (
        0 if availability == "unavailable" else 1
    )


def test_preview_publishes_packages_and_install_instructions(tmp_path: Path) -> None:
    github = _GitHub(tmp_path)

    completed = github.publish("0.2.4.dev9")

    assert completed.returncode == 0, completed.stderr
    state = github.state()
    wheel_url = f"{DOWNLOADS}/marimo_lens-0.2.4.dev9-py3-none-any.whl"
    assert set(state["assets"]) == set(_artifacts("0.2.4.dev9"))
    assert state["target"] == COMMIT
    assert f'# dependencies = ["marimo-lens @ {wheel_url}"]' in state["notes"]
    assert f'uv add "marimo-lens @ {wheel_url}"' in state["notes"]
    assert "gh attestation download" in state["notes"]
    assert "--bundle BUNDLE_FILE" in state["notes"]
    assert f'--predicate-type "{PREVIEW_PREDICATE_TYPE}"' in state["notes"]
    assert (
        f'--signer-workflow "{REPOSITORY}/.github/workflows/publish.yml"'
        in state["notes"]
    )
    assert len(state["comments"]) == 1
    assert f'uv add "marimo-lens @ {wheel_url}"' in state["comments"][0]


def test_older_preview_completion_keeps_the_newest_install_links(
    tmp_path: Path,
) -> None:
    github = _GitHub(tmp_path)
    assert github.publish("0.2.4.dev15").returncode == 0
    notes = github.state()["notes"]

    completed = github.publish("0.2.4.dev9")

    assert completed.returncode == 0, completed.stderr
    assert github.state()["notes"] == notes
    assert set(github.state()["assets"]) == {
        *_artifacts("0.2.4.dev15"),
        *_artifacts("0.2.4.dev9"),
    }


def test_preview_retention_removes_whole_builds(tmp_path: Path) -> None:
    github = _GitHub(
        tmp_path, versions=tuple(f"0.2.4.dev{number}" for number in range(1, 31))
    )

    completed = github.publish("0.2.5.dev1")

    assert completed.returncode == 0, completed.stderr
    assets = github.state()["assets"]
    assert len(assets) == 30 * 3
    assert set(_artifacts("0.2.4.dev1")).isdisjoint(assets)
    assert set(_artifacts("0.2.5.dev1")).issubset(assets)


def test_preview_retention_removes_old_interrupted_builds(tmp_path: Path) -> None:
    github = _GitHub(
        tmp_path, versions=tuple(f"0.2.4.dev{number}" for number in range(2, 32))
    )
    state = github.state()
    orphan = "marimo_lens-0.2.4.dev1.tar.gz"
    state["assets"][orphan] = b64encode(b"orphan").decode()
    state["starters"].append("marimo_lens-0.2.4.dev1-py3-none-any.whl")
    github.write(state)

    completed = github.publish("0.2.4.dev32")

    assert completed.returncode == 0, completed.stderr
    assert orphan not in github.state()["assets"]
    assert github.state()["starters"] == []
    assert len(github.state()["assets"]) == 30 * 3


def test_preview_announcement_failure_preserves_older_builds(tmp_path: Path) -> None:
    github = _GitHub(
        tmp_path, versions=tuple(f"0.2.4.dev{number}" for number in range(1, 31))
    )
    github.fail("pr comment")

    assert github.publish("0.2.4.dev31").returncode == 1
    assert set(_artifacts("0.2.4.dev1")).issubset(github.state()["assets"])

    completed = github.publish("0.2.4.dev31")

    assert completed.returncode == 0, completed.stderr
    assert len(github.state()["assets"]) == 30 * 3
    assert set(_artifacts("0.2.4.dev1")).isdisjoint(github.state()["assets"])


def test_older_build_keeps_newer_links_after_announcement_failure(
    tmp_path: Path,
) -> None:
    github = _GitHub(tmp_path)
    github.fail("pr comment")
    assert github.publish("0.2.4.dev15").returncode == 1
    notes = github.state()["notes"]

    completed = github.publish("0.2.4.dev9")

    assert completed.returncode == 0, completed.stderr
    assert github.state()["notes"] == notes


@pytest.mark.parametrize(
    "starter",
    ["marimo_lens-0.2.4.dev1-py3-none-any.whl", "marimo-lens-0.2.4.dev1-SHA256SUMS"],
)
def test_preview_retry_replaces_starter_assets(tmp_path: Path, starter: str) -> None:
    github = _GitHub(tmp_path, versions=("0.2.4.dev1",))
    state = github.state()
    del state["assets"][starter]
    state["starters"].append(starter)
    github.write(state)

    completed = github.publish("0.2.4.dev1")

    assert completed.returncode == 0, completed.stderr
    assert github.state()["starters"] == []
    assert set(github.state()["assets"]) == set(_artifacts("0.2.4.dev1"))


def test_late_preview_outside_retention_skips_announcement(tmp_path: Path) -> None:
    github = _GitHub(
        tmp_path, versions=tuple(f"0.2.4.dev{number}" for number in range(2, 32))
    )

    completed = github.publish("0.2.4.dev1")

    assert completed.returncode == 0, completed.stderr
    assert "Its assets were removed" in completed.stdout
    assert len(github.state()["assets"]) == 30 * 3
    assert set(_artifacts("0.2.4.dev1")).isdisjoint(github.state()["assets"])
    assert github.state()["comments"] == []


def test_preview_rejects_transfer_damage_before_github_writes(tmp_path: Path) -> None:
    github = _GitHub(tmp_path)

    completed = github.publish("0.2.4.dev1", corrupt=True)

    assert completed.returncode == 1
    assert "FAILED" in completed.stdout
    assert github.state()["calls"] == []


@pytest.mark.parametrize("failure", ["release edit", "pr comment"])
def test_preview_retry_finishes_publication_without_overwriting_assets(
    tmp_path: Path, failure: str
) -> None:
    github = _GitHub(tmp_path)
    github.fail(failure)
    assert github.publish("0.2.4.dev1").returncode == 1
    assert "marimo-lens-0.2.4.dev1-SHA256SUMS" not in github.state()["assets"]

    completed = github.publish("0.2.4.dev1")
    repeated = github.publish("0.2.4.dev1")

    assert completed.returncode == repeated.returncode == 0, (
        completed.stderr + repeated.stderr
    )
    assert set(github.state()["assets"]) == set(_artifacts("0.2.4.dev1"))
    assert len(github.state()["comments"]) == 1
    uploads = [
        call for call in github.state()["calls"] if call[:2] == ["release", "upload"]
    ]
    assert len(uploads) == 3


def test_preview_retry_rejects_different_published_bytes(tmp_path: Path) -> None:
    github = _GitHub(tmp_path, versions=("0.2.4.dev1",))
    state = github.state()
    wheel = "marimo_lens-0.2.4.dev1-py3-none-any.whl"
    state["assets"][wheel] = b64encode(b"different").decode()
    github.write(state)

    completed = github.publish("0.2.4.dev1")

    assert completed.returncode == 1
    assert "Published preview bytes differ" in completed.stderr
    assert github.state()["assets"] == state["assets"]


def test_preview_rejects_final_release_artifacts_before_github_writes(
    tmp_path: Path,
) -> None:
    github = _GitHub(tmp_path)

    completed = github.publish("0.2.4")

    assert completed.returncode == 1
    assert "Expected one marimo-lens preview wheel" in completed.stderr
    assert github.state()["calls"] == []
