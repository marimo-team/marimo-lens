#!/usr/bin/env bash
set -euo pipefail
uv version --package marimo-lens --no-sync "$1"
python3 scripts/release-metadata.py --sync
