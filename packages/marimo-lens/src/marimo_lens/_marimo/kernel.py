"""Read marimo's kernel context: runtime scope, running cell, and notebook file."""

from __future__ import annotations

import pathlib
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager, nullcontext
from typing import Any, cast


def current_runtime_scope() -> object | None:
    """Return the active marimo UI registry as an opaque runtime identity."""

    try:
        return read_runtime_attribute(runtime_context(), "ui_element_registry")
    except RuntimeReadError:
        return None


def current_cell_id() -> str | None:
    """Return the ID of the notebook cell that is executing, if any."""

    try:
        execution = read_runtime_attribute(runtime_context(), "execution_context")
        cell_id = read_runtime_attribute(execution, "cell_id")
    except RuntimeReadError:
        return None
    return str(cell_id) if cell_id is not None else None


def edit_session() -> bool:
    """Return whether the active marimo kernel serves the notebook editor."""

    try:
        from marimo import app_meta
    except ImportError:
        return False
    return app_meta().mode == "edit"


def notebook_cell_codes() -> tuple[str, ...]:
    """Return the code of each cell in the active marimo dataflow graph."""

    try:
        context = runtime_context()
    except RuntimeReadError:
        return ()

    graph = getattr(context, "graph", None)
    if graph is None:
        return ()
    with graph_lock(getattr(graph, "lock", None)):
        raw_cells = getattr(graph, "cells", {})
        if not isinstance(raw_cells, Mapping):
            return ()
        return tuple(
            str(getattr(cell, "code", "") or "") for cell in tuple(raw_cells.values())
        )


class RuntimeReadError(RuntimeError):
    """A host-owned runtime value could not be read."""

    def __init__(self, source: Exception) -> None:
        self.source = source
        name = type(source).__name__
        detail = source.args[0] if len(source.args) == 1 else None
        super().__init__(f"{name}: {detail}" if isinstance(detail, str) else name)


def record_path() -> pathlib.Path | None:
    """Return the notebook's Lens record file, or None for an unsaved notebook.

    The record lives in the notebook's ``__marimo__`` folder, which marimo
    resolves through ``notebook_output_dir()`` and ``sys.pycache_prefix``.
    """

    try:
        context = runtime_context()
    except RuntimeReadError:
        return None
    namespace, _complete = runtime_globals(context)
    filename = notebook_filename(context, namespace)
    if not filename:
        return None
    return record_path_for(pathlib.Path(filename))


def notebook_filename(context: Any, namespace: Mapping[str, Any]) -> str:
    # marimo updates the notebook's __file__ when it renames the file, but
    # keeps the runtime context's filename from kernel start.
    try:
        current = read_namespace_value(namespace, "__file__")
    except (KeyError, RuntimeReadError):
        current = None
    if isinstance(current, str) and current:
        return current
    return str(getattr(context, "filename", "") or "")


def runtime_globals(context: Any) -> tuple[Mapping[str, Any], bool]:
    # The private runtime context may expose globals through a failing descriptor.
    try:
        value = read_runtime_attribute(context, "globals")
    except RuntimeReadError:
        return {}, False
    if not isinstance(value, Mapping):
        return {}, False
    return value, True


def runtime_context() -> Any:
    """Return marimo's runtime context or raise ``RuntimeReadError``."""

    try:
        from marimo._runtime.context import get_context
    except ImportError as error:
        raise RuntimeReadError(error) from error
    return read_runtime_context(get_context)


def read_runtime_context(get_context: Callable[[], Any]) -> Any:
    try:
        return get_context()
    except Exception as error:
        raise RuntimeReadError(error) from error


def read_runtime_attribute(value: Any, name: str) -> Any:
    try:
        return getattr(value, name, None)
    except Exception as error:
        raise RuntimeReadError(error) from error


def read_namespace_value(namespace: Mapping[str, Any], name: str) -> Any:
    try:
        return namespace[name]
    except KeyError:
        raise
    except Exception as error:
        raise RuntimeReadError(error) from error


def graph_lock(value: Any) -> AbstractContextManager[Any]:
    if hasattr(value, "__enter__") and hasattr(value, "__exit__"):
        return cast(AbstractContextManager[Any], value)
    return nullcontext()


def record_path_for(notebook: pathlib.Path) -> pathlib.Path:
    """Return the Lens record file of the notebook at ``notebook``.

    marimo mirrors only absolute paths under ``sys.pycache_prefix``, and the
    kernel names its notebook by absolute path, so a relative one resolves
    from the working directory first.
    """

    from marimo._utils.paths import notebook_output_dir

    notebook = notebook.absolute()
    return notebook_output_dir(notebook) / "lens" / f"{notebook.name}.jsonl"
