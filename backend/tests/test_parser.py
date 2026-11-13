from app.analysis.parser import ImportRef, language_for, parse_source


def parse(source: str, path: str = "src/file.ts"):  # type: ignore[no-untyped-def]
    return parse_source(path, source.encode())


def test_detects_every_import_form_with_its_line() -> None:
    result = parse(
        """import a from "./static";
import type { T } from "./types";
export * from "./reexported";
export { x } from "./named";
export type { Y } from "./type-reexport";
const r = require("./required");
const d = import("./dynamic");
import legacy = require("./legacy");
import "./side-effect";
"""
    )
    assert result.imports == [
        ImportRef("./static", "static", 1),
        ImportRef("./types", "type", 2),
        ImportRef("./reexported", "reexport", 3),
        ImportRef("./named", "reexport", 4),
        ImportRef("./type-reexport", "type", 5),
        ImportRef("./required", "require", 6),
        ImportRef("./dynamic", "dynamic", 7),
        ImportRef("./legacy", "static", 8),
        ImportRef("./side-effect", "static", 9),
    ]


def test_ignores_specifiers_that_cant_be_known_statically() -> None:
    result = parse('const name = "./x";\nrequire(name);\nimport(`./${name}`);\nrequire();\n')
    assert result.imports == []


def test_doesnt_mistake_other_calls_or_strings_for_imports() -> None:
    result = parse('obj.require("./no");\nconst s = "import x from \'./no\'";\n')
    assert result.imports == []


def test_counts_functions_of_every_kind() -> None:
    result = parse(
        """function a() {}
function* gen() {}
const b = function () {};
const c = () => 1;
class K {
  method() {}
  get value() { return 1; }
}
"""
    )
    assert result.functions == 6
    assert result.classes == 1


def test_counts_class_declarations_and_expressions() -> None:
    result = parse("class A {}\nabstract class B {}\nconst C = class {};\n")
    assert result.classes == 3


def test_complexity_counts_each_decision_point() -> None:
    result = parse(
        """function f(a, b, c) {
  if (a && b) {}           // if, &&
  else if (b || c) {}      // if, ||
  for (;;) {}              // for
  for (const x of c) {}    // for-of
  while (a) {}             // while
  do {} while (b);         // do
  switch (a) {             // two cases, default doesn't count
    case 1: break;
    case 2: break;
    default: break;
  }
  try {} catch {}          // catch
  const v = a ? b : c;     // ternary
  return c ?? v;           // ??
}
"""
    )
    assert result.complexity == 1 + 13


def test_straight_line_code_has_complexity_one() -> None:
    assert parse("const a = 1 + 2;\n").complexity == 1


def test_lines_of_code_exclude_blank_and_comment_lines() -> None:
    result = parse(
        """// header comment

/*
 * block comment
 */
const a = 1; // trailing comment counts as code
const template = `line one
line two`;

"""
    )
    assert result.total_lines == 9
    assert result.code_lines == 3


def test_collects_export_names() -> None:
    result = parse(
        """export default function main() {}
export function helper() {}
export class Store {}
export const a = 1, b = 2;
export interface Shape {}
export type Id = string;
export enum Color { Red }
const hidden = 1;
export { hidden as shown };
export * from "./all";
export * as ns from "./namespace";
"""
    )
    assert result.exports == [
        "default",
        "main",
        "helper",
        "Store",
        "a",
        "b",
        "Shape",
        "Id",
        "Color",
        "shown",
        "* from ./all",
        "ns",
    ]


def test_collects_commonjs_exports() -> None:
    result = parse("module.exports = {};\nexports.one = 1;\nmodule.exports.two = 2;\n", "a.js")
    assert result.exports == ["default", "one", "two"]


def test_parses_jsx_and_tsx() -> None:
    jsx = parse("export default () => <div>{x ? <A /> : null}</div>;\n", "a.jsx")
    assert jsx.language == "jsx"
    assert not jsx.parse_error
    assert jsx.complexity == 2

    tsx = parse("export const C = (p: { n: number }) => <span>{p.n}</span>;\n", "a.tsx")
    assert tsx.language == "tsx"
    assert not tsx.parse_error


def test_flags_syntax_errors_but_keeps_what_it_can() -> None:
    result = parse('import x from "./ok";\nconst broken = (;\nexport function kept() {}\n')
    assert result.parse_error
    assert result.imports == [ImportRef("./ok", "static", 1)]
    assert result.functions == 1


def test_handles_empty_files() -> None:
    result = parse("")
    assert (result.total_lines, result.code_lines, result.functions, result.complexity) == (
        0,
        0,
        0,
        1,
    )


def test_survives_deep_nesting() -> None:
    deep = "const x = " + "[" * 3000 + "]" * 3000 + ";\n"
    assert parse(deep).code_lines == 1


def test_picks_the_grammar_from_the_extension() -> None:
    assert [language_for(p) for p in ("a.ts", "a.mts", "a.cts", "a.tsx")] == [
        "typescript",
        "typescript",
        "typescript",
        "tsx",
    ]
    assert [language_for(p) for p in ("a.js", "a.mjs", "a.cjs", "a.jsx")] == [
        "javascript",
        "javascript",
        "javascript",
        "jsx",
    ]
