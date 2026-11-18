# Release

Use the [release PR workflow](../RELEASING.md) to request and approve a version.

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
5. Keeps the newest 30 complete builds. Partial uploads newer than the oldest
   kept build stay available for a retry. Older builds and partial uploads are
   deleted.
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

A tag run succeeds when the `resolve`, `build`, `attest`, `publish`,
`verify-pypi`, and `release-notes` jobs succeed. A preview run uses `resolve`,
`build`, `attest`, and `preview`, and skips the PyPI jobs. After a tag run,
verify:

- PyPI lists the expected wheel and source distribution.
- A fresh environment imports the exact version.
- The `lens` marimo capability loads.
- The Agent Plugin and Agent Skill resolve from the installed distribution.
- The GitHub release points to the annotated tag and contains release notes.

## Recovery

### Preparation or tagging fails

Use the retry instructions in [the maintainer runbook](https://github.com/marimo-team/github-maintenance/blob/main/docs/releases.md#retry-a-failed-release) (internal).

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
