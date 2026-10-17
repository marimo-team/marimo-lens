# Release

A release publishes the package version already committed to `main`. The local
script verifies repository state and successful CI, then creates and pushes one
annotated `vX.Y.Z` tag. The tag starts GitHub Actions, which rebuilds and
validates the archives, publishes them to PyPI through
[Trusted Publishing](https://docs.pypi.org/trusted-publishers/),
verifies a fresh public installation, and creates GitHub release notes.
Every validated `main` commit also publishes a wheel to the rolling
[`preview` GitHub prerelease](https://github.com/marimo-team/marimo-lens/releases/tag/preview).
See [Rolling previews](#rolling-previews).

Publishing changes external state. [PyPI](https://pypi.org/) versions and uploaded artifacts are
immutable. Prepare and validate the version before pushing its tag.

## Release actors

| Stage                                 | Owner                                            |
| ------------------------------------- | ------------------------------------------------ |
| Version change                        | Release-bearing pull request                     |
| Local preflight and annotated tag     | `scripts/release.sh`                             |
| Channel and version resolution        | `resolve` job in `.github/workflows/publish.yml` |
| Archive build and validation          | `build` job                                      |
| Build provenance                      | `attest` job                                     |
| PyPI upload                           | `publish` job and `pypi` environment             |
| Public index and install verification | `verify-pypi` job                                |
| GitHub release notes                  | `release-notes` job                              |

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

The `attest` job signs SLSA build provenance for both archives with
[GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations).
Verify a downloaded release archive with
`gh attestation verify marimo_lens-X.Y.Z-py3-none-any.whl -R marimo-team/marimo-lens`.

The `publish` job downloads that artifact and runs `uv publish` with mandatory
Trusted Publishing in the protected `pypi` environment.

The `verify-pypi` job waits up to three minutes for both archive names to appear
on the public simple index. It then installs exact `marimo-lens==X.Y.Z` from
PyPI in a fresh isolated environment and runs `scripts/verify_release.py`.

The `release-notes` job runs after publication and public verification. It uses
`changelogithub` with the repository token to create or update the GitHub
release notes.

## Rolling previews

`publish.yml` also listens for completed push-event `CI` and `GitHub Pages`
workflows on `main`. A preview starts once both workflows pass for the exact
commit. Pull request and fork runs cannot publish. Completions queue per commit,
and the `resolve` job skips a version whose checksum manifest is already
published.

`scripts/preview-version.sh` versions a preview as `X.Y.(Z+1).devN`, where
`vX.Y.Z` is the newest final tag reachable from the commit's parent and `N`
counts commits since that tag. Tagging the commit later keeps its preview
version, and previews sort below the next patch release.

The `build` job checks out the validated commit, stamps that version into the
disposable checkout with `uv version --no-sync`, runs `make package`, and
writes `marimo-lens-X.Y.Z.devN-SHA256SUMS`. The `attest` job signs the wheel,
source distribution, and manifest with the
[preview predicate](#preview-provenance-v1). The `preview` job runs
`scripts/publish-preview.sh`, which:

1. Checks the transferred archives against the manifest.
2. Uploads the wheel and source distribution. A retry compares bytes with
   already published assets and replaces empty starter assets left by a failed
   upload.
3. Rewrites the release notes with install and verification commands when this
   build is the newest available one. An older build finishing later leaves the
   newest links in place.
4. Comments the install command on the merged pull request once.
5. Deletes builds outside the newest 30, including partial uploads.
6. Uploads the manifest last. Its presence marks a finished publication.

Install a preview by URL in a notebook's inline script metadata or a uv project:

```console
uv add "marimo-lens @ https://github.com/marimo-team/marimo-lens/releases/download/preview/marimo_lens-X.Y.Z.devN-py3-none-any.whl"
```

The `preview` tag stays on the commit that created the release. Versioned asset
names and attestations identify each build. Publication runs in the `preview`
environment, which allows deployments from `main`. The job needs
`contents: write` for release assets and `pull-requests: write` for the
announcement.

A pending or failed upstream workflow defers publication. Its later successful
completion, or a rerun, retries readiness. A GitHub API failure fails the run.
Rerun it with `gh run rerun RUN_ID --failed`.

### Preview provenance v1

Preview attestations use this predicate type:

```text
https://github.com/marimo-team/marimo-lens/blob/main/development_docs/release.md#preview-provenance-v1
```

A `workflow_run` signs from the newest `main` workflow, which can be ahead of
the validated commit. GitHub's attestation API restricts build types under the
standard SLSA predicate, so `scripts/preview-provenance.mjs` writes this custom
predicate in the SLSA v1 shape:

| Field                                               | Value                                                |
| --------------------------------------------------- | ---------------------------------------------------- |
| `buildDefinition.buildType`                         | The predicate type URI                               |
| `buildDefinition.externalParameters.workflow`       | Signing repository, ref, and workflow path           |
| `buildDefinition.externalParameters.checkoutCommit` | Packaged source commit                               |
| `buildDefinition.resolvedDependencies`              | Signing workflow commit, then packaged source commit |
| `runDetails.builder.id`                             | Signing workflow reference                           |
| `runDetails.metadata.invocationId`                  | Workflow run and attempt URL                         |

Verify a downloaded preview wheel with the predicate type and publishing
workflow. `gh attestation download` prints the bundle filename:

```console
gh attestation download WHEEL_FILE -R marimo-team/marimo-lens
gh attestation verify WHEEL_FILE -R marimo-team/marimo-lens \
  --bundle BUNDLE_FILE \
  --predicate-type "https://github.com/marimo-team/marimo-lens/blob/main/development_docs/release.md#preview-provenance-v1" \
  --signer-workflow "marimo-team/marimo-lens/.github/workflows/publish.yml"
```

Read `checkoutCommit` from the verified statement to identify the packaged
source. The certificate's source digest identifies the signing workflow commit.

The CI `Preview provenance` job signs a probe file with the same predicate,
downloads its attestation from GitHub with up to five attempts, verifies it, and
checks the signed checkout commit. It runs on `main` and same-repository pull
requests that change preview publication. `scripts/tests/` covers versioning,
readiness, retries, ordering, retention, and the probe step through the shell
and workflow boundary.

## Monitor the release

List recent publish runs:

```sh
gh run list --workflow publish.yml --limit 5
```

Watch the run ID printed by GitHub CLI:

```sh
gh run watch RUN_ID --exit-status
```

Confirm the `resolve`, `build`, `attest`, `publish`, `verify-pypi`, and
`release-notes` jobs succeed. Then verify:

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
- A preview publishes only after `CI` and `GitHub Pages` pass for its exact
  `main` commit.
- Preview archives carry signed provenance that names their source commit.
