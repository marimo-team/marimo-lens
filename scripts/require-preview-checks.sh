#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ || -z "${GH_REPO:-}" ]]; then
	printf 'ERROR: Usage: GH_REPO=owner/repo %s <40-character-commit-sha>\n' "$0" >&2
	exit 2
fi

# Exit 3 means a required workflow has not passed for the commit yet. Other
# failures come from the GitHub API and should fail the caller.
commit="$1"
for workflow in ci.yml pages.yml; do
	run="$(gh run list --workflow "$workflow" --branch main --commit "$commit" \
		--event push --limit 1 --json status,conclusion,url \
		--jq 'if length == 0 then "" else (.[0] | [.status, .conclusion, .url] | .[]) end')"
	if [[ -z "$run" ]]; then
		printf 'ERROR: No main %s push run found for %s\n' "$workflow" "$commit" >&2
		exit 3
	fi
	{
		IFS= read -r status
		IFS= read -r conclusion
		IFS= read -r url
	} <<<"$run"
	if [[ "$status" != completed || "$conclusion" != success ]]; then
		printf 'ERROR: %s must pass for %s: %s/%s (%s)\n' \
			"$workflow" "$commit" "$status" "${conclusion:-pending}" "$url" >&2
		exit 3
	fi
done
