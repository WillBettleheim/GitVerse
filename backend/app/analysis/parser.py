"""Extracts imports, exports, declarations and metrics from JS/TS source with Tree-sitter.

Everything comes from the syntax tree. Nothing is guessed with regular expressions, and the
code is never evaluated.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from functools import cache
from typing import Literal

import tree_sitter_javascript
import tree_sitter_typescript
from tree_sitter import Language, Node, Parser, Tree

ImportKind = Literal["static", "type", "reexport", "require", "dynamic"]
FileLanguage = Literal["typescript", "tsx", "javascript", "jsx"]

FUNCTION_NODES = {
    "function_declaration",
    "generator_function_declaration",
    "function_expression",
    "function",
    "generator_function",
    "arrow_function",
    "method_definition",
}
CLASS_NODES = {"class_declaration", "abstract_class_declaration", "class"}
# Each adds one path through the code: McCabe's cyclomatic complexity.
DECISION_NODES = {
    "if_statement",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "switch_case",
    "catch_clause",
    "ternary_expression",
}
LOGICAL_OPERATORS = {"&&", "||", "??"}
NAMED_DECLARATIONS = {
    "function_declaration",
    "generator_function_declaration",
    "class_declaration",
    "abstract_class_declaration",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
    "internal_module",
}


@dataclass(frozen=True)
class ImportRef:
    specifier: str
    kind: ImportKind
    line: int


@dataclass
class ParsedFile:
    path: str
    language: FileLanguage
    total_lines: int
    # Lines holding at least one token that isn't a comment.
    code_lines: int
    functions: int
    classes: int
    # File-level cyclomatic complexity: 1 plus every decision point in the file.
    complexity: int
    imports: list[ImportRef] = field(default_factory=list)
    exports: list[str] = field(default_factory=list)
    parse_error: bool = False


def language_for(path: str) -> FileLanguage:
    if path.endswith(".tsx"):
        return "tsx"
    if path.endswith((".ts", ".mts", ".cts")):
        return "typescript"
    if path.endswith(".jsx"):
        return "jsx"
    return "javascript"


@cache
def _parser(language: FileLanguage) -> Parser:
    if language == "typescript":
        grammar = tree_sitter_typescript.language_typescript()
    elif language == "tsx":
        grammar = tree_sitter_typescript.language_tsx()
    else:
        # The JavaScript grammar includes JSX.
        grammar = tree_sitter_javascript.language()
    return Parser(Language(grammar))


def parse_source(path: str, source: bytes) -> ParsedFile:
    language = language_for(path)
    tree = _parser(language).parse(source)
    result = ParsedFile(
        path=path,
        language=language,
        total_lines=_count_lines(source),
        code_lines=0,
        functions=0,
        classes=0,
        complexity=1,
        parse_error=tree.root_node.has_error,
    )

    code_rows: set[int] = set()
    exports: dict[str, None] = {}
    for node in _walk(tree):
        kind = node.type
        if node.child_count == 0:
            # Zero-width leaves are the empty root or tokens the parser invented to recover.
            if kind != "comment" and node.end_byte > node.start_byte:
                code_rows.update(range(node.start_point.row, node.end_point.row + 1))
            continue
        if kind in FUNCTION_NODES:
            result.functions += 1
        elif kind in CLASS_NODES:
            result.classes += 1
        if kind in DECISION_NODES:
            result.complexity += 1
        elif kind == "binary_expression":
            operator = node.child_by_field_name("operator")
            if operator is not None and operator.type in LOGICAL_OPERATORS:
                result.complexity += 1

        if kind == "import_statement":
            _collect_import(node, result.imports)
        elif kind == "export_statement":
            _collect_export(node, result.imports, exports)
        elif kind == "call_expression":
            _collect_call(node, result.imports)
        elif kind == "assignment_expression":
            _collect_commonjs_export(node, exports)
        elif kind == "comment":
            continue

    result.code_lines = len(code_rows)
    result.exports = list(exports)
    return result


def _walk(tree: Tree) -> Iterator[Node]:
    """Depth-first, without recursion, so deeply nested code can't exhaust the stack."""
    cursor = tree.walk()
    while True:
        node = cursor.node
        if node is not None:
            yield node
        if cursor.goto_first_child() or cursor.goto_next_sibling():
            continue
        while True:
            if not cursor.goto_parent():
                return
            if cursor.goto_next_sibling():
                break


def _string_value(node: Node | None) -> str | None:
    """The value of a plain string literal. Template literals and expressions can't be known."""
    if node is None or node.type != "string":
        return None
    return "".join(
        (child.text or b"").decode("utf-8", "replace")
        for child in node.children
        if child.type in ("string_fragment", "escape_sequence")
    )


def _has_keyword(node: Node, keyword: str) -> bool:
    return any(child.type == keyword for child in node.children)


def _line(node: Node) -> int:
    return node.start_point.row + 1


def _collect_import(node: Node, imports: list[ImportRef]) -> None:
    source = node.child_by_field_name("source")
    for child in node.children:
        if child.type == "import_require_clause":
            source = child.child_by_field_name("source")
    specifier = _string_value(source)
    if specifier is not None:
        kind: ImportKind = "type" if _has_keyword(node, "type") else "static"
        imports.append(ImportRef(specifier, kind, _line(node)))


def _collect_export(node: Node, imports: list[ImportRef], exports: dict[str, None]) -> None:
    specifier = _string_value(node.child_by_field_name("source"))
    if specifier is not None:
        kind: ImportKind = "type" if _has_keyword(node, "type") else "reexport"
        imports.append(ImportRef(specifier, kind, _line(node)))

    if _has_keyword(node, "default"):
        exports["default"] = None
    declaration = node.child_by_field_name("declaration")
    if declaration is not None:
        for name in _declared_names(declaration):
            exports[name] = None
    for child in node.children:
        if child.type == "export_clause":
            for spec in child.children:
                if spec.type == "export_specifier":
                    named = spec.child_by_field_name("alias") or spec.child_by_field_name("name")
                    if named is not None and named.text:
                        exports[named.text.decode("utf-8", "replace")] = None
        elif child.type == "namespace_export":
            names = [c for c in child.children if c.type in ("identifier", "string")]
            if names and names[-1].text:
                exports[names[-1].text.decode("utf-8", "replace").strip("'\"")] = None
        elif child.type == "*" and specifier is not None:
            exports[f"* from {specifier}"] = None


def _declared_names(declaration: Node) -> list[str]:
    if declaration.type in NAMED_DECLARATIONS:
        name = declaration.child_by_field_name("name")
        return [name.text.decode("utf-8", "replace")] if name is not None and name.text else []
    if declaration.type in ("lexical_declaration", "variable_declaration"):
        names = []
        for child in declaration.children:
            if child.type == "variable_declarator":
                name = child.child_by_field_name("name")
                if name is not None and name.type == "identifier" and name.text:
                    names.append(name.text.decode("utf-8", "replace"))
        return names
    return []


def _collect_call(node: Node, imports: list[ImportRef]) -> None:
    function = node.child_by_field_name("function")
    arguments = node.child_by_field_name("arguments")
    if function is None or arguments is None:
        return
    is_require = function.type == "identifier" and function.text == b"require"
    is_dynamic = function.type == "import"
    if not (is_require or is_dynamic):
        return
    first = next((c for c in arguments.children if c.is_named), None)
    specifier = _string_value(first)
    if specifier is not None:
        imports.append(ImportRef(specifier, "require" if is_require else "dynamic", _line(node)))


def _collect_commonjs_export(node: Node, exports: dict[str, None]) -> None:
    left = node.child_by_field_name("left")
    if left is None or left.type != "member_expression" or not left.text:
        return
    target = left.text.decode("utf-8", "replace")
    if target == "module.exports":
        exports["default"] = None
    elif target.startswith(("exports.", "module.exports.")) and target.count(".") <= 2:
        exports[target.rsplit(".", 1)[1]] = None


def _count_lines(source: bytes) -> int:
    if not source:
        return 0
    return source.count(b"\n") + (0 if source.endswith(b"\n") else 1)
