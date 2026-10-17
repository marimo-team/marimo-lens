#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
	printf 'ERROR: Usage: %s <40-character-commit-sha>\n' "$0" >&2
	exit 2
fi

commit="$1"
# Use the parent so tagging this commit later cannot change its preview version.
# Tag globs also match suffixes such as -rc1; only final tags supply the base.
tags="$(git tag --merged "$commit^" --list 'v*' --sort=-v:refname)"
if ! base="$(grep -m 1 -E '^v[0-9]+\.[0-9]+\.[0-9]+$' <<<"$tags")"; then
	printf 'ERROR: No vX.Y.Z release tag precedes %s. Fetch tags and full history, then retry.\n' "$commit" >&2
	exit 1
fi
[[ "$base" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]
major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"
count="$(git rev-list --count "$base..$commit")"

printf '%s.%s.%s.dev%s\n' "$major" "$minor" "$((patch + 1))" "$count"
