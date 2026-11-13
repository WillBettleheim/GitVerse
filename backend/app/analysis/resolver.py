"""Resolves JS/TS import specifiers to files in the repository.

Supported: relative paths with extension and index lookup (TypeScript's "bundler" and "node"
behaviour), `.js` written for a `.ts` file (TypeScript's ESM convention), and `baseUrl` and `paths`
from the nearest tsconfig.json or jsconfig.json, following local `extends`. Not supported:
package.json `exports` or `imports`, workspace packages, or loaders. Imports those would resolve
are reported as unresolved or external, never guessed.
"""

import json
import posixpath
from dataclasses import dataclass
from typing import Any, Literal

from app.analysis.archive import DECLARATION_SUFFIXES, SOURCE_EXTENSIONS

ResolutionKind = Literal[
    "internal", "external", "builtin", "asset", "declaration", "skipped", "unresolved"
]

# Resolution order matches TypeScript: TypeScript sources first, then JavaScript.
_EXTENSION_ORDER = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
# A .js specifier in TypeScript usually names the .ts file it compiles from.
_JS_TO_TS = {
    ".js": (".ts", ".tsx"),
    ".jsx": (".tsx",),
    ".mjs": (".mts",),
    ".cjs": (".cts",),
}
_MAX_EXTENDS_DEPTH = 5

NODE_BUILTINS = frozenset(
    """assert async_hooks buffer child_process cluster console constants crypto dgram
    diagnostics_channel dns domain events fs http http2 https inspector module net os path
    perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls
    trace_events tty url util v8 vm wasi worker_threads zlib test""".split()
)


@dataclass(frozen=True)
class Resolution:
    kind: ResolutionKind
    # Repository path for internal, asset, declaration and skipped results.
    target: str | None = None
    # Package or builtin name for external and builtin results.
    package: str | None = None
    reason: str | None = None


@dataclass(frozen=True)
class _CompilerPaths:
    directory: str
    # Set only when a config says so. It also makes bare specifiers try local files first.
    base_url: str | None
    paths: dict[str, list[str]]
    # Where `paths` targets are relative to when there's no baseUrl: the declaring config's folder.
    paths_root: str


class ModuleResolver:
    def __init__(
        self,
        source_paths: set[str],
        all_paths: set[str],
        skipped_paths: set[str],
        configs: dict[str, bytes],
    ) -> None:
        self._sources = source_paths
        self._all = all_paths
        self._skipped = skipped_paths
        self._configs = {path: _parse_config(path, raw, configs) for path, raw in configs.items()}
        self._nearest_cache: dict[str, _CompilerPaths | None] = {}

    def resolve(self, importer: str, specifier: str) -> Resolution:
        if not specifier:
            return Resolution("unresolved", reason="Empty import path")
        bare = specifier.split("?", 1)[0]
        if not bare.startswith("#"):
            bare = bare.split("#", 1)[0]

        if specifier.startswith("node:"):
            return Resolution("builtin", package=specifier.removeprefix("node:").split("/")[0])
        if "!" in specifier:
            return Resolution("unresolved", reason="Loader syntax isn't supported")
        if specifier.startswith(("./", "../")) or specifier in (".", ".."):
            base = posixpath.normpath(posixpath.join(posixpath.dirname(importer), bare))
            if base == ".." or base.startswith("../"):
                return Resolution("unresolved", reason="Points outside the repository")
            return self._resolve_path(base if base != "." else "", specifier)
        if specifier.startswith("/"):
            return Resolution("unresolved", reason="Absolute paths aren't supported")

        config = self._nearest_config(importer)
        if config is not None:
            for base in _path_candidates(config, bare):
                found = self._resolve_path(base, specifier)
                if found.kind != "unresolved":
                    return found

        if specifier.startswith("#"):
            return Resolution("unresolved", reason="package.json imports aren't supported")

        package = _package_name(bare)
        if package in NODE_BUILTINS:
            return Resolution("builtin", package=package)
        if package is None:
            return Resolution("unresolved", reason="Not a valid package name")
        return Resolution("external", package=package)

    def _resolve_path(self, base: str, specifier: str) -> Resolution:
        for candidate in self._candidates(base):
            if candidate in self._sources:
                return Resolution("internal", target=candidate)
        for candidate in self._candidates(base):
            if candidate in self._skipped:
                return Resolution(
                    "skipped", target=candidate, reason="File exists but wasn't analyzed"
                )
        for suffix in ("", *DECLARATION_SUFFIXES):
            for candidate in (
                base + suffix,
                posixpath.join(base, "index") + suffix if base else "",
            ):
                if candidate.endswith(DECLARATION_SUFFIXES) and candidate in self._all:
                    return Resolution("declaration", target=candidate)
        if base in self._all and not base.endswith(SOURCE_EXTENSIONS):
            return Resolution("asset", target=base)
        if base + ".json" in self._all:
            return Resolution("asset", target=base + ".json")
        return Resolution("unresolved", reason=f"No file matches {specifier!r}")

    @staticmethod
    def _candidates(base: str) -> list[str]:
        candidates: list[str] = []
        if base:
            candidates.append(base)
            stem, extension = posixpath.splitext(base)
            for replacement in _JS_TO_TS.get(extension, ()):
                candidates.append(stem + replacement)
            candidates.extend(base + extension for extension in _EXTENSION_ORDER)
        index = posixpath.join(base, "index") if base else "index"
        candidates.extend(index + extension for extension in _EXTENSION_ORDER)
        return candidates

    def _nearest_config(self, importer: str) -> "_CompilerPaths | None":
        directory = posixpath.dirname(importer)
        if directory in self._nearest_cache:
            return self._nearest_cache[directory]
        current = directory
        found: _CompilerPaths | None = None
        while True:
            for name in ("tsconfig.json", "jsconfig.json"):
                path = posixpath.join(current, name) if current else name
                if path in self._configs and self._configs[path] is not None:
                    found = self._configs[path]
                    break
            if found is not None or not current:
                break
            current = posixpath.dirname(current)
        self._nearest_cache[directory] = found
        return found


def _path_candidates(config: _CompilerPaths, specifier: str) -> list[str]:
    candidates: list[str] = []
    paths_root = config.base_url if config.base_url is not None else config.paths_root
    for pattern, targets in config.paths.items():
        captured = _match(pattern, specifier)
        if captured is None:
            continue
        for target in targets:
            mapped = target.replace("*", captured, 1)
            candidates.append(_join_inside(paths_root, mapped))
    if config.base_url is not None:
        candidates.append(_join_inside(config.base_url, specifier))
    return [c for c in candidates if c is not None and not c.startswith("..")]


def _match(pattern: str, specifier: str) -> str | None:
    if "*" not in pattern:
        return "" if pattern == specifier else None
    prefix, suffix = pattern.split("*", 1)
    if specifier.startswith(prefix) and specifier.endswith(suffix):
        return specifier[len(prefix) : len(specifier) - len(suffix) if suffix else None]
    return None


def _join_inside(root: str, relative: str) -> str:
    joined = (
        posixpath.normpath(posixpath.join(root, relative)) if root else posixpath.normpath(relative)
    )
    return "" if joined == "." else joined


def _package_name(specifier: str) -> str | None:
    parts = specifier.split("/")
    if specifier.startswith("@"):
        return "/".join(parts[:2]) if len(parts) >= 2 and parts[1] else None
    return parts[0] or None


def _parse_config(
    path: str, raw: bytes, configs: dict[str, bytes], depth: int = 0
) -> "_CompilerPaths | None":
    data = _load_jsonc(raw)
    if data is None:
        return None
    directory = posixpath.dirname(path)
    raw_options = data.get("compilerOptions")
    options: dict[str, Any] = raw_options if isinstance(raw_options, dict) else {}

    inherited: _CompilerPaths | None = None
    extends = data.get("extends")
    if isinstance(extends, str) and extends.startswith(".") and depth < _MAX_EXTENDS_DEPTH:
        parent = posixpath.normpath(posixpath.join(directory, extends))
        if not parent.endswith(".json"):
            parent += ".json"
        if parent in configs:
            inherited = _parse_config(parent, configs[parent], configs, depth + 1)

    base_url = inherited.base_url if inherited else None
    if isinstance(options.get("baseUrl"), str):
        base_url = _join_inside(directory, options["baseUrl"])
    paths = dict(inherited.paths) if inherited else {}
    paths_root = inherited.paths_root if inherited else directory
    if isinstance(options.get("paths"), dict):
        paths = {
            str(key): [str(t) for t in value if isinstance(t, str)]
            for key, value in options["paths"].items()
            if isinstance(value, list)
        }
        paths_root = directory
    return _CompilerPaths(
        directory=directory, base_url=base_url, paths=paths, paths_root=paths_root
    )


def _load_jsonc(raw: bytes) -> dict[str, Any] | None:
    """tsconfig allows comments and trailing commas, which strict JSON doesn't."""
    text = raw.decode("utf-8", "replace")
    out: list[str] = []
    i = 0
    in_string = False
    while i < len(text):
        char = text[i]
        if in_string:
            out.append(char)
            if char == "\\" and i + 1 < len(text):
                out.append(text[i + 1])
                i += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
            out.append(char)
        elif text.startswith("//", i):
            end = text.find("\n", i)
            i = len(text) if end == -1 else end
            continue
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = len(text) if end == -1 else end + 2
            continue
        else:
            out.append(char)
        i += 1
    cleaned = "".join(out)
    # Trailing commas, outside strings now that comments are gone.
    result: list[str] = []
    in_string = False
    for index, char in enumerate(cleaned):
        if in_string:
            if char == '"' and cleaned[index - 1] != "\\":
                in_string = False
        elif char == '"':
            in_string = True
        elif char == ",":
            rest = cleaned[index + 1 :].lstrip()
            if rest.startswith(("}", "]")):
                continue
        result.append(char)
    try:
        data = json.loads("".join(result))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None
