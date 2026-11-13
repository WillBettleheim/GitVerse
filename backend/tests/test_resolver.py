import pytest

from app.analysis.resolver import ModuleResolver, Resolution

SOURCES = {
    "src/index.ts",
    "src/app.tsx",
    "src/utils/index.ts",
    "src/utils/helper.ts",
    "src/legacy.js",
    "src/esm.mts",
    "packages/ui/src/button.tsx",
    "packages/ui/src/theme.ts",
}
OTHER = {"src/styles.css", "src/data.json", "src/global.d.ts", "src/types/index.d.ts"}
SKIPPED = {"src/vendor.min.js"}


def resolver(configs: dict[str, bytes] | None = None) -> ModuleResolver:
    return ModuleResolver(SOURCES, SOURCES | OTHER | SKIPPED, SKIPPED, configs or {})


@pytest.mark.parametrize(
    ("importer", "specifier", "target"),
    [
        ("src/index.ts", "./app", "src/app.tsx"),
        ("src/index.ts", "./app.tsx", "src/app.tsx"),
        ("src/index.ts", "./utils", "src/utils/index.ts"),
        ("src/index.ts", "./utils/", "src/utils/index.ts"),
        ("src/utils/helper.ts", "..", "src/index.ts"),
        ("src/utils/helper.ts", "../legacy", "src/legacy.js"),
        ("src/utils/helper.ts", "./index", "src/utils/index.ts"),
        # TypeScript's ESM convention: the .js extension names the .ts source.
        ("src/index.ts", "./utils/helper.js", "src/utils/helper.ts"),
        ("src/index.ts", "./app.jsx", "src/app.tsx"),
        ("src/index.ts", "./esm.mjs", "src/esm.mts"),
        # Query strings and fragments are dropped.
        ("src/index.ts", "./app?raw", "src/app.tsx"),
    ],
)
def test_resolves_relative_imports(importer: str, specifier: str, target: str) -> None:
    assert resolver().resolve(importer, specifier) == Resolution("internal", target=target)


def test_prefers_typescript_over_javascript_like_tsc() -> None:
    both = ModuleResolver({"a.ts", "b.js", "b.ts"}, {"a.ts", "b.js", "b.ts"}, set(), {})
    assert both.resolve("a.ts", "./b").target == "b.ts"


@pytest.mark.parametrize(
    ("specifier", "kind", "package"),
    [
        ("react", "external", "react"),
        ("react-dom/client", "external", "react-dom"),
        ("@scope/pkg", "external", "@scope/pkg"),
        ("@scope/pkg/deep/path", "external", "@scope/pkg"),
        ("fs", "builtin", "fs"),
        ("fs/promises", "builtin", "fs"),
        ("node:path", "builtin", "path"),
        ("node:test", "builtin", "test"),
    ],
)
def test_classifies_packages_and_builtins(specifier: str, kind: str, package: str) -> None:
    result = resolver().resolve("src/index.ts", specifier)
    assert (result.kind, result.package) == (kind, package)


@pytest.mark.parametrize(
    ("specifier", "kind", "target"),
    [
        ("./styles.css", "asset", "src/styles.css"),
        ("./data", "asset", "src/data.json"),
        ("./global", "declaration", "src/global.d.ts"),
        ("./types", "declaration", "src/types/index.d.ts"),
        ("./vendor.min.js", "skipped", "src/vendor.min.js"),
    ],
)
def test_recognises_files_that_exist_but_arent_analyzed(
    specifier: str, kind: str, target: str
) -> None:
    result = resolver().resolve("src/index.ts", specifier)
    assert (result.kind, result.target) == (kind, target)


@pytest.mark.parametrize(
    ("specifier", "reason"),
    [
        ("./missing", "No file matches"),
        ("../../../etc/passwd", "outside the repository"),
        ("/abs/path", "Absolute paths"),
        ("#internal", "package.json imports"),
        ("style-loader!./styles.css", "Loader syntax"),
        ("", "Empty"),
        ("@scope", "valid package name"),
    ],
)
def test_reports_unresolved_imports_with_a_reason(specifier: str, reason: str) -> None:
    result = resolver().resolve("src/index.ts", specifier)
    assert result.kind == "unresolved"
    assert reason in (result.reason or "")


def test_applies_tsconfig_paths_and_base_url() -> None:
    configs = {
        "tsconfig.json": b"""{
          // comments and trailing commas are allowed
          "compilerOptions": {
            "baseUrl": "./src",
            "paths": { "@/*": ["./*"], "~ui": ["../packages/ui/src/button.tsx"], },
          },
        }"""
    }
    r = resolver(configs)
    assert r.resolve("src/app.tsx", "@/utils/helper").target == "src/utils/helper.ts"
    assert r.resolve("src/app.tsx", "~ui").target == "packages/ui/src/button.tsx"
    # baseUrl makes non-relative paths resolve from src/.
    assert r.resolve("src/app.tsx", "utils").target == "src/utils/index.ts"
    # Anything the config doesn't map is still a package.
    assert r.resolve("src/app.tsx", "react").kind == "external"


BASE_CONFIG = b'{"compilerOptions": {"paths": {"#theme": ["packages/ui/src/theme.ts"]}}}'


def test_uses_the_nearest_config_and_follows_local_extends() -> None:
    configs = {
        "tsconfig.base.json": BASE_CONFIG,
        "packages/ui/tsconfig.json": b'{"extends": "../../tsconfig.base.json"}',
    }
    r = resolver(configs)
    # Inherited paths stay relative to the config that declared them.
    assert r.resolve("packages/ui/src/button.tsx", "#theme").target == "packages/ui/src/theme.ts"
    # Outside the package no config applies, and "#" can't be a package name.
    assert r.resolve("src/index.ts", "#theme").kind == "unresolved"


def test_an_inheriting_base_url_rebases_inherited_paths_like_tsc() -> None:
    configs = {
        "tsconfig.base.json": BASE_CONFIG,
        "packages/ui/tsconfig.json": b'{"extends": "../../tsconfig.base.json", '
        b'"compilerOptions": {"baseUrl": "src"}}',
    }
    r = resolver(configs)
    # The package's own baseUrl applies to bare paths...
    assert r.resolve("packages/ui/src/button.tsx", "theme").target == "packages/ui/src/theme.ts"
    # ...and, as in TypeScript, to the inherited paths, which then point nowhere.
    assert r.resolve("packages/ui/src/button.tsx", "#theme").kind == "unresolved"


def test_paths_without_base_url_dont_make_packages_look_local() -> None:
    sources = SOURCES | {"react.ts"}
    configs = {"tsconfig.json": b'{"compilerOptions": {"paths": {"@/*": ["src/*"]}}}'}
    r = ModuleResolver(sources, sources, set(), configs)
    assert r.resolve("src/index.ts", "@/app").target == "src/app.tsx"
    # Without baseUrl, a bare name is a package even if a same-named file sits at the root.
    assert r.resolve("src/index.ts", "react").kind == "external"


def test_ignores_broken_configs() -> None:
    r = resolver({"tsconfig.json": b"{ not json"})
    assert r.resolve("src/index.ts", "react").kind == "external"
    assert r.resolve("src/index.ts", "./app").target == "src/app.tsx"


def test_config_paths_cant_escape_the_repository() -> None:
    configs = {"tsconfig.json": b'{"compilerOptions": {"paths": {"x": ["../../outside.ts"]}}}'}
    assert resolver(configs).resolve("src/index.ts", "x").kind == "external"
