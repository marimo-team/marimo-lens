.PHONY: check docs docs-serve package

check:
	uv lock --check
	pnpm check
	pnpm test
	pnpm build
	uv run ruff format --check
	uv run ruff check
	uv run ty check
	uv run pyrefly check --min-severity warn
	uv run basedpyright
	uv run pytest -q
	pnpm test:e2e
	shellcheck scripts/*.sh
	git diff --check

docs:
	pnpm docs:build

docs-serve:
	pnpm --filter @marimo-lens/python build
	env -u BASE_PATH pnpm --filter @marimo-lens/docs dev

package:
	rm -rf dist
	pnpm --filter @marimo-lens/python build
	uv build --package marimo-lens --out-dir dist
	uvx twine check dist/marimo_lens-*.whl dist/marimo_lens-*.tar.gz
	mkdir -p dist/from-sdist
	uv build --wheel dist/marimo_lens-*.tar.gz --out-dir dist/from-sdist
	set -e; for wheel in dist/marimo_lens-*.whl dist/from-sdist/marimo_lens-*.whl; do \
		uv run --no-project --isolated --no-cache --exclude-newer "3 days" \
			--exclude-newer-package agent-plugins=false \
			--exclude-newer-package marimo=false \
			--default-index https://pypi.org/simple --with "$$wheel" \
			python scripts/verify_release.py "$$(uv version --package marimo-lens --short)"; \
	done
