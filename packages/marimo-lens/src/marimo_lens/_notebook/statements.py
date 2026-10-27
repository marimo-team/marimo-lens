"""Split cell code into comparable statements."""

from __future__ import annotations

import ast
import copy
from collections import Counter
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from functools import lru_cache
from types import MappingProxyType

MAX_STATEMENT_TEXT = 300

_PARSE_FLAGS = ast.PyCF_ONLY_AST | ast.PyCF_ALLOW_TOP_LEVEL_AWAIT


@dataclass(frozen=True, slots=True)
class Statements:
    """The statements of one code text, counted by structure.

    A statement is compared by its abstract syntax tree without positions, so
    formatting and comments do not change it. A compound statement such as
    ``def``, ``if``, or ``with`` contributes its header, and each statement in
    its body is counted separately, at every depth. Code that does not parse, or
    nests too deep to walk, is split into stripped, nonblank lines.
    """

    counts: Mapping[str, int]
    texts: Mapping[str, str]


@lru_cache(maxsize=4_096)
def statements(code: str) -> Statements:
    """Return the statements of ``code``, reusing results for repeated texts."""

    counts: Counter[str] = Counter()
    texts: dict[str, str] = {}
    try:
        tree = compile(code, "<cell>", "exec", flags=_PARSE_FLAGS)
        assert isinstance(tree, ast.Module)
        for node in _walk(tree.body):
            header = _header(node)
            key = ast.dump(header, include_attributes=False)
            counts[key] += 1
            if key not in texts:
                texts[key] = _bounded(ast.unparse(header))
    # Code nested deeper than the recursion limit, such as a long method
    # chain, parses but cannot be dumped, so it compares by lines too.
    except (SyntaxError, ValueError, RecursionError):
        return _lines(code)
    return _freeze(counts, texts)


def _lines(code: str) -> Statements:
    counts: Counter[str] = Counter()
    texts: dict[str, str] = {}
    for line in code.splitlines():
        stripped = line.strip()
        if stripped:
            key = f"line:{stripped}"
            counts[key] += 1
            texts.setdefault(key, _bounded(stripped))
    return _freeze(counts, texts)


@dataclass(frozen=True, slots=True)
class Flows:
    """What the top-level assignments of one code text read.

    ``reads`` maps an assignment's statement key to the names it assigns and
    the names its value reads. ``depends`` maps each assigned name to every
    name its last assignment reads, directly or through earlier assignments
    in the same code.
    """

    reads: Mapping[str, tuple[frozenset[str], frozenset[str]]]
    depends: Mapping[str, frozenset[str]]


@lru_cache(maxsize=4_096)
def flows(code: str) -> Flows:
    """Return what the top-level assignments of ``code`` read."""

    reads: dict[str, tuple[frozenset[str], frozenset[str]]] = {}
    depends: dict[str, frozenset[str]] = {}
    try:
        tree = compile(code, "<cell>", "exec", flags=_PARSE_FLAGS)
        assert isinstance(tree, ast.Module)
        for node in tree.body:
            if isinstance(node, ast.Assign):
                value = node.value
                targets = frozenset(
                    name for target in node.targets for name in _assigned(target)
                )
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                value = node.value
                targets = frozenset(_assigned(node.target))
            else:
                continue
            if not targets:
                continue
            names = frozenset(
                child.id
                for child in ast.walk(value)
                if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load)
            )
            reads[ast.dump(node, include_attributes=False)] = (targets, names)
            through = names.union(*(depends.get(name, frozenset()) for name in names))
            for target in targets:
                depends[target] = through
    except (SyntaxError, ValueError, RecursionError):
        return Flows(MappingProxyType({}), MappingProxyType({}))
    return Flows(MappingProxyType(reads), MappingProxyType(depends))


def _assigned(target: ast.expr) -> Iterator[str]:
    if isinstance(target, ast.Name):
        yield target.id
    elif isinstance(target, (ast.Tuple, ast.List)):
        for element in target.elts:
            yield from _assigned(element)
    elif isinstance(target, ast.Starred):
        yield from _assigned(target.value)


Shape = tuple[tuple[str, int], ...]


def statement_shape(code: str) -> Shape:
    """Return the statements of ``code`` as one comparable value.

    Two codes share a shape when they hold the same statements as often,
    whatever their formatting and comments.
    """

    return tuple(sorted(statements(code).counts.items()))


def _walk(nodes: list[ast.stmt]) -> Iterator[ast.AST]:
    for node in nodes:
        yield node
        yield from _children(node)


def _children(node: ast.AST) -> Iterator[ast.AST]:
    for _field, value in ast.iter_fields(node):
        if not isinstance(value, list):
            continue
        for child in value:
            if isinstance(child, ast.stmt):
                yield from _walk([child])
            elif isinstance(child, (ast.ExceptHandler, ast.match_case)):
                yield child
                yield from _walk(child.body)


def _header(node: ast.AST) -> ast.AST:
    """Return ``node`` with its nested statement lists emptied."""

    header = copy.copy(node)
    for field, value in ast.iter_fields(node):
        if isinstance(value, list) and any(
            isinstance(child, (ast.stmt, ast.ExceptHandler, ast.match_case))
            for child in value
        ):
            setattr(header, field, [])
    return header


def _bounded(text: str) -> str:
    if len(text) <= MAX_STATEMENT_TEXT:
        return text
    return text[: MAX_STATEMENT_TEXT - 3] + "..."


def _freeze(counts: Counter[str], texts: dict[str, str]) -> Statements:
    return Statements(
        counts=MappingProxyType(dict(counts)),
        texts=MappingProxyType(texts),
    )
