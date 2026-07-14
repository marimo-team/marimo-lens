.PHONY: check

check:
	uv lock --check
	uv sync --locked --all-packages --all-groups
	pnpm install --frozen-lockfile
	pnpm check
	pnpm test
	pnpm build
	uv run --locked --all-packages --all-groups ruff format --check .
	uv run --locked --all-packages --all-groups ruff check .
	uv run --locked --all-packages --all-groups ty check packages/marimo-lens workbench
	uv run --locked --all-packages --all-groups pyrefly check --min-severity warn
	uv run --locked --all-packages --all-groups pytest -q packages/marimo-lens/tests
	git diff --check
