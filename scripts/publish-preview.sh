#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 || ! "$2" =~ ^[0-9a-f]{40}$ || -z "${GH_REPO:-}" || -z "${PREVIEW_PREDICATE_TYPE:-}" ]]; then
	printf 'ERROR: Usage: GH_REPO=owner/repo PREVIEW_PREDICATE_TYPE=uri %s <dist-directory> <40-character-commit-sha>\n' "$0" >&2
	exit 2
fi

dist="$1"
commit="$2"
shopt -s nullglob
wheels=("$dist"/marimo_lens-*.whl)
if [[ "${#wheels[@]}" -ne 1 || ! "$(basename "${wheels[0]}")" =~ ^marimo_lens-([0-9]+\.[0-9]+\.[0-9]+\.dev[0-9]+)-py3-none-any\.whl$ ]]; then
	printf 'ERROR: Expected one marimo-lens preview wheel\n' >&2
	exit 1
fi
version="${BASH_REMATCH[1]}"
wheel="$(basename "${wheels[0]}")"
artifacts=(
	"${wheels[0]}"
	"$dist/marimo_lens-$version.tar.gz"
	"$dist/marimo-lens-$version-SHA256SUMS"
)
for artifact in "${artifacts[@]}"; do
	if [[ ! -f "$artifact" ]]; then
		printf 'ERROR: Missing preview artifact: %s\n' "$artifact" >&2
		exit 1
	fi
done
(cd "$dist" && sha256sum --check "marimo-lens-$version-SHA256SUMS")

tag=preview
retained=30
server="${GITHUB_SERVER_URL:-https://github.com}"
release_url="$server/$GH_REPO/releases/tag/$tag"
wheel_url="$server/$GH_REPO/releases/download/$tag/$wheel"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

# The tag stays on the first preview commit. Versioned asset URLs identify builds.
if ! gh release view "$tag" >/dev/null 2>&1; then
	gh release create "$tag" --prerelease --latest=false --target "$commit" \
		--title "Preview builds" --notes "Packages built from main."
fi
assets() {
	gh release view "$tag" --json assets --jq '.assets[].name'
}
uploaded_assets() {
	gh release view "$tag" --json assets --jq '.assets[] | select(.state == "uploaded" and .size > 0) | .name'
}
published="$(uploaded_assets)"
starters="$(gh release view "$tag" --json assets --jq '.assets[] | select(.state == "starter") | .name')"
upload() {
	local artifact="$1" name
	name="$(basename "$artifact")"
	# A failed upload can leave an empty starter asset that blocks a retry with
	# the same name.
	if grep -qxF "$name" <<<"$starters"; then
		gh release delete-asset "$tag" "$name" --yes
	fi
	if grep -qxF "$name" <<<"$published"; then
		gh release download "$tag" --pattern "$name" --dir "$temporary"
		if ! cmp -s "$artifact" "$temporary/$name"; then
			printf 'ERROR: Published preview bytes differ: %s\n' "$name" >&2
			exit 1
		fi
	else
		gh release upload "$tag" "$artifact"
	fi
}
for artifact in "${artifacts[@]:0:2}"; do
	upload "$artifact"
done

listing="$(assets)"
published="$(uploaded_assets)"
package_names() {
	printf '%s\n' "marimo_lens-$1-py3-none-any.whl" "marimo_lens-$1.tar.gz"
}
# Discover interrupted builds too, so orphaned assets leave with their build.
# macOS and GNU version sorts disagree on devN. Numeric keys keep newest-first
# ordering identical on both.
versions="$(sed -nE \
	-e 's/^marimo_lens-([0-9]+\.[0-9]+\.[0-9]+\.dev[0-9]+)-py3-none-any\.whl$/\1/p' \
	-e 's/^marimo_lens-([0-9]+\.[0-9]+\.[0-9]+\.dev[0-9]+)\.tar\.gz$/\1/p' \
	-e 's/^marimo-lens-([0-9]+\.[0-9]+\.[0-9]+\.dev[0-9]+)-SHA256SUMS$/\1/p' \
	<<<"$listing" | sort -t. -u -k1,1nr -k2,2nr -k3,3nr -k4.4,4nr)"
# A build whose packages uploaded counts as available even if its announcement
# failed, so it still decides the newest links and the retention window.
builds="$(while IFS= read -r candidate; do
	available=true
	while IFS= read -r name; do
		if ! grep -qxF "$name" <<<"$published"; then
			available=false
		fi
	done < <(package_names "$candidate")
	if [[ "$available" == true ]]; then
		printf '%s\n' "$candidate"
	fi
done <<<"$versions")"
if [[ "$(head -n 1 <<<"$builds")" == "$version" ]]; then
	cat >"$temporary/notes.md" <<EOF
Packages built from \`main\` after CI and GitHub Pages pass for the same commit. The newest is marimo-lens \`$version\` from [\`${commit:0:7}\`]($server/$GH_REPO/commit/$commit).

Declare it in a notebook's inline script metadata, then open the notebook with \`marimo edit --sandbox\`:

\`\`\`python
# /// script
# dependencies = ["marimo-lens @ $wheel_url"]
# ///
\`\`\`

Or add it to a uv project:

\`\`\`console
uv add "marimo-lens @ $wheel_url"
\`\`\`

This release keeps the newest $retained builds. Install \`marimo-lens\` from PyPI for released versions. The preview tag stays on its original commit. The versioned assets and their provenance identify each build.

Download the wheel's attestation, then replace \`BUNDLE_FILE\` with the \`.jsonl\` filename printed by \`gh\`:

\`\`\`console
gh attestation download $wheel -R $GH_REPO
gh attestation verify $wheel -R $GH_REPO \\
  --bundle BUNDLE_FILE \\
  --predicate-type "$PREVIEW_PREDICATE_TYPE" \\
  --signer-workflow "$GH_REPO/.github/workflows/publish.yml"
\`\`\`

The signed predicate's \`buildDefinition.externalParameters.checkoutCommit\` identifies the packaged source commit. Its resolved dependencies also record the signing workflow commit, which can be newer.
EOF
	gh release edit "$tag" --notes-file "$temporary/notes.md"
fi

stale=""
if [[ "$(wc -l <<<"$builds")" -ge "$retained" ]]; then
	cutoff="$(head -n "$retained" <<<"$builds" | tail -n 1)"
	stale="$(awk -v cutoff="$cutoff" 'older { print } $0 == cutoff { older = 1 }' <<<"$versions")"
fi

# An old run can finish after thirty newer builds. Its URLs are about to be
# pruned, so it skips the announcement.
if ! grep -qxF "$version" <<<"$stale"; then
	pull="$(gh api "repos/$GH_REPO/commits/$commit/pulls" \
		--jq '[.[] | select(.merged_at != null and .base.ref == "main")][0].number // empty')"
	if [[ -n "$pull" ]]; then
		comments="$(gh api --paginate "repos/$GH_REPO/issues/$pull/comments" --jq '.[].body')"
		if ! grep -qF "$wheel_url" <<<"$comments"; then
			cat >"$temporary/comment.md" <<EOF
marimo-lens \`$version\` from this pull request is available as a [preview build]($release_url):

\`\`\`console
uv add "marimo-lens @ $wheel_url"
\`\`\`
EOF
			gh pr comment "$pull" --body-file "$temporary/comment.md"
		fi
	fi
fi

# Announce before pruning, so an announcement failure keeps older builds.
while IFS= read -r old_version; do
	if [[ -n "$old_version" ]]; then
		while IFS= read -r name; do
			if grep -qxF "$name" <<<"$listing"; then
				gh release delete-asset "$tag" "$name" --yes
			fi
		done < <(package_names "$old_version"; printf '%s\n' "marimo-lens-$old_version-SHA256SUMS")
	fi
done <<<"$stale"

# The checksum manifest uploads last. Its presence marks a finished publication.
if grep -qxF "$version" <<<"$stale"; then
	printf 'Preview %s is outside the newest %s builds. Its assets were removed.\n' "$version" "$retained"
else
	upload "${artifacts[2]}"
	printf 'Published %s\n' "$wheel_url"
fi
