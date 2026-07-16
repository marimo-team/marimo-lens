#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: ./scripts/release.sh <major|minor|patch|stable>

Runs the repository checks, updates marimo-lens through uv, creates a release
commit, and adds an annotated vX.Y.Z tag. The commit and tag stay local. Push
the command printed at the end to start PyPI publishing.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

case "${1:-}" in
  major | minor | patch | stable)
    BUMP="$1"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  printf 'Release from main. Current branch: %s\n' "$BRANCH" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Commit or stash working tree changes before releasing.\n' >&2
  git status --short >&2
  exit 1
fi

CURRENT_VERSION="$(uv version --package marimo-lens --short)"
NEXT_VERSION="$(uv version --package marimo-lens --dry-run --short --bump "$BUMP")"
TAG="v$NEXT_VERSION"

if git rev-parse --quiet --verify "refs/tags/$TAG" >/dev/null; then
  printf 'Tag already exists: %s\n' "$TAG" >&2
  exit 1
fi

printf 'Preparing marimo-lens %s -> %s\n' "$CURRENT_VERSION" "$NEXT_VERSION"
make check

uv version --package marimo-lens --no-sync --bump "$BUMP"
git add packages/marimo-lens/pyproject.toml uv.lock
git commit -m "release: $NEXT_VERSION"
git tag -a "$TAG" -m "release: $NEXT_VERSION"

printf '\nRelease %s is ready locally. Publish it with:\n\n' "$TAG"
printf '  git push --atomic origin main %s\n' "$TAG"
