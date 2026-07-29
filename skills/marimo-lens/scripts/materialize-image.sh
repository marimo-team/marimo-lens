#!/usr/bin/env bash
# Materialize a validated marimo Lens image transfer, or remove its image directory.
set -euo pipefail

prefix="__MARIMO_LENS_IMAGE__"

usage() {
  cat >&2 <<'EOF'
Usage:
  materialize-image.sh < transfer.txt
  materialize-image.sh cleanup IMAGE_DIR...
EOF
  exit 2
}

canonical_image_dir() {
  local requested_dir="$1"
  local tmp_root canonical_dir

  tmp_root=$(cd "${TMPDIR:-/tmp}" && pwd -P)
  [[ -d "$requested_dir" && ! -L "$requested_dir" ]] || return 1
  canonical_dir=$(cd "$requested_dir" && pwd -P)
  [[ "$(dirname "$canonical_dir")" == "$tmp_root" ]] || return 1
  [[ "$(basename "$canonical_dir")" == marimo-lens.* ]] || return 1
  [[ -f "$canonical_dir/.marimo-lens-images" ]] || return 1
  printf '%s\n' "$canonical_dir"
}

cleanup_image_dirs() {
  local requested_dir canonical_dir image_dirs_json
  local canonical_dirs=()

  [[ $# -gt 0 ]] || usage
  for requested_dir in "$@"; do
    canonical_dir=$(canonical_image_dir "$requested_dir") || {
      echo "Refusing to remove a directory not created by marimo Lens." >&2
      return 1
    }
    canonical_dirs+=("$canonical_dir")
  done
  for canonical_dir in "${canonical_dirs[@]}"; do
    rm -rf -- "$canonical_dir"
  done
  image_dirs_json=$(jq -cn '$ARGS.positional' --args "${canonical_dirs[@]}")
  jq -cn \
    --argjson imageDirs "$image_dirs_json" \
    '{
      status: "removed",
      imageDirs: $imageDirs,
      count: ($imageDirs | length)
    }'
}

if [[ "${1:-}" == "cleanup" ]]; then
  shift
  cleanup_image_dirs "$@"
  exit
fi
[[ $# -eq 0 ]] || usage

# An 8 MiB Lens PNG remains below this limit after base64 and metadata.
max_transfer_bytes=$((12 * 1024 * 1024))
tmp_root=$(cd "${TMPDIR:-/tmp}" && pwd -P)
transfer_path=$(mktemp "${tmp_root}/marimo-lens-transfer.XXXXXX")
chmod 600 "$transfer_path"
cleanup_transfer() {
  rm -f -- "$transfer_path"
}
trap cleanup_transfer EXIT

head -c "$((max_transfer_bytes + 1))" >"$transfer_path"
transfer_bytes=$(wc -c <"$transfer_path" | tr -d ' ')
if [[ "$transfer_bytes" -gt "$max_transfer_bytes" ]]; then
  echo "Lens image transfer exceeds the 12 MiB limit." >&2
  exit 1
fi

payload=""
match_count=0
while IFS= read -r line; do
  case "$line" in
    "$prefix"*)
      payload="${line#"$prefix"}"
      match_count=$((match_count + 1))
      ;;
  esac
done <"$transfer_path"

rm -f -- "$transfer_path"
trap - EXIT

if [[ "$match_count" -ne 1 ]] || ! jq -e '
  .protocol == "marimo-lens.image-transfer"
  and .version == 1
  and (.status == "pending" or .status == "available" or .status == "failed")
  and (.source == "selection" or .source == "cell")
  and (.cellId | type == "string")
' >/dev/null <<<"$payload"; then
  echo "Lens returned an invalid image transfer." >&2
  exit 1
fi

status=$(jq -r '.status' <<<"$payload")
if [[ "$status" != "available" ]]; then
  jq -c 'del(.protocol, .version, .image)' <<<"$payload"
  [[ "$status" == "pending" ]]
  exit
fi

if ! jq -e '
  (.image | type == "object")
  and .image.mediaType == "image/png"
  and (.image.data | type == "string")
  and (.image.bytes | type == "number")
  and (.image.width | type == "number")
  and (.image.height | type == "number")
  and (.image.sha256 | type == "string")
  and (.image.capturedAt | type == "string")
' >/dev/null <<<"$payload"; then
  echo "Lens returned invalid image metadata." >&2
  exit 1
fi

image_dir=$(mktemp -d "${tmp_root}/marimo-lens.XXXXXX")
chmod 700 "$image_dir"
: >"$image_dir/.marimo-lens-images"
image_path="$image_dir/image.png"

cleanup_failed_materialization() {
  local exit_code=$?
  if [[ "$exit_code" -ne 0 && -n "${image_dir:-}" && -d "$image_dir" ]]; then
    rm -rf -- "$image_dir"
  fi
  exit "$exit_code"
}
trap cleanup_failed_materialization EXIT

if base64 --help 2>&1 | grep -q -- '--decode'; then
  jq -r '.image.data' <<<"$payload" | base64 --decode >"$image_path"
else
  jq -r '.image.data' <<<"$payload" | base64 -D >"$image_path"
fi
chmod 600 "$image_path"

expected_bytes=$(jq -r '.image.bytes' <<<"$payload")
actual_bytes=$(wc -c <"$image_path" | tr -d ' ')
expected_sha=$(jq -r '.image.sha256' <<<"$payload")
if command -v sha256sum >/dev/null 2>&1; then
  actual_sha=$(sha256sum "$image_path" | awk '{print $1}')
else
  actual_sha=$(shasum -a 256 "$image_path" | awk '{print $1}')
fi
png_signature=$(od -An -tx1 -N8 "$image_path" | tr -d ' \n')

if [[ "$actual_bytes" != "$expected_bytes" ||
      "$actual_sha" != "$expected_sha" ||
      "$png_signature" != "89504e470d0a1a0a" ]]; then
  echo "Decoded image does not match Lens metadata." >&2
  exit 1
fi

jq -c \
  --arg path "$image_path" \
  --arg imageDir "$image_dir" \
  '
    .image as $image
    | del(.protocol, .version, .image)
    | . + ($image | del(.data))
    | . + {path: $path, imageDir: $imageDir, temporary: true}
  ' <<<"$payload"

trap - EXIT
