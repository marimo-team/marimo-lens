# Release

A release publishes the package version already committed to `main`. The local
script verifies repository state and successful CI, then creates and pushes one
annotated `vX.Y.Z` tag. The tag starts GitHub Actions, which rebuilds and
validates the archives, publishes them to PyPI through
[Trusted Publishing](https://docs.pypi.org/trusted-publishers/),
verifies a fresh public installation, and creates GitHub release notes.

Publishing changes external state. [PyPI](https://pypi.org/) versions and uploaded artifacts are
immutable. Prepare and validate the version before pushing its tag.

## Release actors

| Stage                                 | Owner                                          |
| ------------------------------------- | ---------------------------------------------- |
| Version change                        | Release-bearing pull request                   |
| Local preflight and annotated tag     | `scripts/release.sh`                           |
| Archive build and validation          | `build` job in `.github/workflows/publish.yml` |
| PyPI upload                           | `publish` job and `pypi` environment           |
| Public index and install verification | `verify-pypi` job                              |
| GitHub release notes                  | `release-notes` job                            |

## Prepare the release pull request

Start from a branch based on current `main`.

1. Choose `major`, `minor`, or `patch` from the user-visible behavior change.
2. Update the package version:

   ```sh
   uv version --package marimo-lens --bump patch
   ```

3. Inspect the package metadata and `uv.lock` changes.
4. Run:

   ```sh
   make check
   make package
   shellcheck scripts/*.sh
   ```

5. Inspect the direct wheel, source distribution, and rebuilt wheel described in
   [Build and distribution](build-and-distribution.md#make-package).
6. Confirm the user documentation, package README, and public API reference
   describe the release-bearing behavior.
7. Merge the pull request and wait for the push-triggered CI workflow on `main`.

Use `major` or `minor` in the command when that is the chosen release level.
The package version must use final `X.Y.Z` form before tagging.

## Prepare local `main`

The release script requires:

- `gh`, `git`, and `uv` on `PATH`.
- Authenticated GitHub CLI access to the repository.
- A local branch named `main`.
- A clean worktree.
- Local `HEAD` equal to `origin/main` after fetch.
- A final `X.Y.Z` package version.
- No existing local release tag for that version.
- A completed successful push-triggered `ci.yml` run for the exact commit.

Synchronize local `main` with the remote through the repository's normal
fast-forward workflow before release.

## Dry run

Run:

```sh
./scripts/release.sh --dry-run
```

The dry run performs repository and CI preflight. It also runs
`git fetch origin main --tags`, so it requires network access and updates local
remote-tracking and tag references. It does not create or push the release tag.

A successful dry run prints:

- The planned `vX.Y.Z` tag.
- The exact commit.
- The successful CI run URL.
- The command that starts the release.

Resolve every preflight failure before continuing. Do not bypass clean-tree,
commit, version, tag, or CI checks.

## Start the release

Run:

```sh
./scripts/release.sh
```

The script creates an annotated tag with message `release: X.Y.Z` and pushes it
to `origin`. If the push fails, the script deletes the newly created local tag
so the command can be retried after the transport problem is fixed.

A successful push prints the publish workflow URL. At that point GitHub Actions
owns the release.

## Publish workflow

The `build` job:

1. Checks out the tag with complete history.
2. Installs the configured Python, Node.js, pnpm, uv, and Vite+ toolchain.
3. Verifies final-version tag syntax.
4. Verifies package version and tag equality.
5. Verifies that the Git object is an annotated tag.
6. Verifies that the tagged commit is on `origin/main`.
7. Runs `make check`.
8. Runs `make package`.
9. Uploads the wheel and source distribution as a one-day workflow artifact.

The `publish` job downloads that artifact and runs `uv publish` with mandatory
Trusted Publishing in the protected `pypi` environment.

The `verify-pypi` job waits up to three minutes for both archive names to appear
on the public simple index. It then installs exact `marimo-lens==X.Y.Z` from
PyPI in a fresh isolated environment and runs `scripts/verify_release.py`.

The `release-notes` job runs after publication and public verification. It uses
`changelogithub` with the repository token to create or update the GitHub
release notes.

## Monitor the release

List recent publish runs:

```sh
gh run list --workflow publish.yml --limit 5
```

Watch the run ID printed by GitHub CLI:

```sh
gh run watch RUN_ID --exit-status
```

Confirm all four jobs succeed. Then verify:

- PyPI lists the expected wheel and source distribution.
- A fresh environment imports the exact version.
- The `lens` marimo capability loads.
- The Agent Plugin and Agent Skill resolve from the installed distribution.
- The GitHub release points to the annotated tag and contains release notes.

## Recovery

### Local preflight fails

Follow the script's recovery text. Clean or preserve the worktree as appropriate,
fast-forward local `main`, wait for exact-commit CI, or correct the version in a
new pull request. Run the dry run again.

### Tag push fails

The script removes the local tag it created. Fix authentication or transport,
confirm the remote tag is absent, then rerun the script from the same validated
commit.

### Build job fails before publication

Inspect the failing `make check` or `make package` step. A transient service or
runner failure can use GitHub's failed-job rerun. A source defect requires a new
commit on `main` and a new package version. Do not move a release tag onto a
different commit.

### Trusted Publishing fails

Confirm whether PyPI accepted either artifact before retrying. If neither
artifact exists, repair the `pypi` environment or publishing trust and rerun the
failed job. If the version or either artifact is public, treat that version as
published and use a new version for source or artifact changes.

### Public verification fails

Inspect whether the failure is index propagation, download, installation,
metadata, capability, Agent Skill, browser resource, or public API validation.
Rerun a transient index or network failure. A package defect after publication
requires a new version.

### Release notes fail

The package is already published and verified. Repair repository-token or
`changelogithub` behavior and rerun the release-notes job. Do not republish the
package.

## Release invariants

- Package version and tag version match exactly.
- The release tag is annotated and its commit belongs to `main`.
- Exact-commit `main` CI passed before tag creation.
- The workflow rebuilds archives from the tag.
- Direct wheel and source-distribution rebuild both pass installed verification.
- PyPI publishing uses Trusted Publishing.
- Public verification installs the exact released version from PyPI.
- A published version is never rebuilt with different contents.
