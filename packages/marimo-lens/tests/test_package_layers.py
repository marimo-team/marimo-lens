from __future__ import annotations

import ast
import pathlib

import marimo_lens

PACKAGE = pathlib.Path(marimo_lens.__file__).parent

# Lowest first. A layer imports only the layers before it. The public modules
# `__init__`, `agent`, and `__main__` sit above every layer.
LAYERS = (
    "_core",
    "_schema",
    "_notebook",
    "_selection",
    "_record",
    "_checks",
    "_context",
    "_session",
    "_protocol",
    "_marimo",
    "_widget",
)
HOSTS = {"marimo", "anywidget", "traitlets"}
HOST_ADAPTERS = {"_marimo", "_widget"}


def _imports(path: pathlib.Path) -> set[str]:
    module = ["marimo_lens", *path.relative_to(PACKAGE).with_suffix("").parts]
    if module[-1] == "__init__":
        module.append("")
    found = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = module[: len(module) - node.level] if node.level else []
            source = ".".join([*base, *([node.module] if node.module else [])])
            found.update(f"{source}.{alias.name}" for alias in node.names)
    return found


def _sources(layer: str) -> list[pathlib.Path]:
    path = PACKAGE / layer
    return sorted(path.rglob("*.py")) if path.is_dir() else [path.with_suffix(".py")]


def test_each_layer_imports_only_the_layers_before_it():
    violations = []
    for index, layer in enumerate(LAYERS):
        allowed = {layer, *LAYERS[:index]}
        for path in _sources(layer):
            for name in _imports(path):
                top, _, rest = name.partition(".")
                if (top in HOSTS and layer not in HOST_ADAPTERS) or (
                    top == "marimo_lens" and rest.partition(".")[0] not in allowed
                ):
                    violations.append(f"{layer}/{path.name} imports {name}")
    assert violations == []
