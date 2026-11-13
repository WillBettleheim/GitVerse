"""Finds the evidence a question needs: relevant files, symbols, import lines, graph facts and
short source excerpts. Deterministic, and bounded so a large repository never floods the prompt.

Every item comes from the analysis or from source verified against its git blob SHA, so anything
quoted from here is a fact about the analyzed commit. Interpreting it is left to the model, whose
conclusions are labelled as inferences unless they cite this evidence.
"""

import re
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Literal

from app.analysis.evidence import FileEvidence, RepositoryIndex
from app.schemas.diff import SnapshotDiff
from app.schemas.graph import CodeGraph, FileNode

Intent = Literal["central", "dependents", "cycles", "history", "overview"]
EvidenceKind = Literal[
    "file", "snippet", "imports", "importers", "cycle", "hubs", "overview", "change"
]
SourceReader = Callable[[str], bytes | None]


@dataclass(frozen=True)
class Budget:
    max_files: int = 8
    max_snippets: int = 6
    snippet_lines: int = 40
    # Total characters of quoted source across all snippets.
    snippet_chars: int = 16_000
    line_chars: int = 220
    max_listed: int = 25
    # Repositories up to this size get their full path list in the prompt.
    path_list_limit: int = 300


@dataclass(frozen=True)
class EdgeFact:
    source: str
    target: str
    # The import statement's line in the source file, when the index knows it.
    line: int | None = None
    type_only: bool = False


@dataclass
class Evidence:
    id: str
    kind: EvidenceKind
    title: str
    facts: list[str] = field(default_factory=list)
    path: str | None = None
    line_start: int | None = None
    line_end: int | None = None
    # Verbatim source lines. Untrusted: quoted to the model as data, never as instructions.
    snippet: str | None = None
    # Untrusted text written by repository authors, such as commit messages.
    quoted: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    edges: list[EdgeFact] = field(default_factory=list)


@dataclass(frozen=True)
class RankedFile:
    path: str
    score: float
    reasons: tuple[str, ...]


@dataclass
class Retrieval:
    terms: list[str]
    intents: list[Intent]
    ranked: list[RankedFile]
    evidence: list[Evidence]
    # Paths of every analyzed file, for small repositories. Empty when there are too many.
    path_list: list[str]
    target: str | None
    notes: list[str] = field(default_factory=list)

    @property
    def has_signal(self) -> bool:
        return bool(self.ranked) or bool(self.intents) or self.target is not None


# Related words searched together. Only a starting point: literal words are always searched too.
CONCEPTS: dict[str, frozenset[str]] = {
    "auth": frozenset(
        "auth authentication authenticate authenticated authorization authorize login logout "
        "signin signup session sessions token tokens jwt oauth password passwords credential "
        "credentials passport guard permission permissions".split()
    ),
    "routing": frozenset(
        "route routes routing router routers endpoint endpoints handler handlers controller "
        "controllers pages navigation navigate".split()
    ),
    "database": frozenset(
        "database databases db sql query queries orm prisma model models repository "
        "repositories migration migrations postgres pg mongo mongoose sequelize knex drizzle "
        "sqlite".split()
    ),
    "state": frozenset(
        "state store stores redux zustand context reducer reducers atom atoms".split()
    ),
    "config": frozenset("config configuration settings env environment options".split()),
    "testing": frozenset("test tests testing spec specs mock mocks fixture fixtures".split()),
    "logging": frozenset("log logs logging logger".split()),
    "api": frozenset("api client fetch http request requests rest graphql".split()),
    "ui": frozenset("component components ui view views render widget widgets".split()),
    "errors": frozenset("error errors exception exceptions".split()),
    "build": frozenset(
        "build bundle bundler webpack vite rollup esbuild compile plugin plugins".split()
    ),
    "cli": frozenset("cli command commands argv".split()),
    "cache": frozenset("cache caching memo memoize".split()),
}
# Packages that strongly suggest a concept when a file imports them.
PACKAGE_CONCEPTS: dict[str, str] = {
    "jsonwebtoken": "auth",
    "jose": "auth",
    "passport": "auth",
    "next-auth": "auth",
    "@auth/core": "auth",
    "bcrypt": "auth",
    "bcryptjs": "auth",
    "express": "routing",
    "koa-router": "routing",
    "@koa/router": "routing",
    "react-router": "routing",
    "react-router-dom": "routing",
    "@tanstack/react-router": "routing",
    "next": "routing",
    "hono": "routing",
    "fastify": "routing",
    "pg": "database",
    "mysql2": "database",
    "@prisma/client": "database",
    "mongoose": "database",
    "mongodb": "database",
    "sequelize": "database",
    "knex": "database",
    "drizzle-orm": "database",
    "better-sqlite3": "database",
    "redux": "state",
    "@reduxjs/toolkit": "state",
    "zustand": "state",
    "jotai": "state",
    "winston": "logging",
    "pino": "logging",
    "axios": "api",
    "jest": "testing",
    "vitest": "testing",
}
STOPWORDS = frozenset(
    """a about after all also an and any are as at be been before being between both but by can
    could did do does doing done each for from get gets had has have how i if in into is it its
    me my of on or our out should so some than that the their them then there these they this
    those through to too under up us use used uses using was we were what when where which while
    who whom why will with would you your file files module modules code repository repo project
    codebase implemented implement implementation work works working involved part parts handle
    handles handled happen happens find show tell explain explained new contributor contributors
    over time cause causes problem problems problematic could might subsystem subsystems this
    one ones thing things look looks like does do where src ts tsx js jsx mjs cjs dir folder
    folders depend depends dependency dependencies dependent dependents central core
    architecture architectural important key circular cycle cycles cyclic change changes changed
    history evolve evolved evolution grow grew most which""".split()
)
# A file needs at least this score to count as relevant: one literal match on its name or folder,
# or several weaker ones. Related words alone don't qualify a file.
MIN_SCORE = 3.0
GENERIC_STEMS = frozenset({"index", "main", "mod", "types", "type", "utils", "util", "lib", "src"})
INTENT_PATTERNS: dict[Intent, re.Pattern[str]] = {
    "central": re.compile(
        r"\b(central|core|important|key|hubs?|critical|most (connected|used|imported)|backbone|"
        r"heart of)\b"
    ),
    "dependents": re.compile(
        r"\b(depends? on|dependen(ts|cies|cy)|imports?|imported|importers?|uses|used by|relies? "
        r"on|rely on|consumers?|callers?|who calls)\b"
    ),
    "cycles": re.compile(r"\b(circular|cycles?|cyclic|import loops?)\b"),
    "history": re.compile(
        r"\b(over time|changed?|changes|evolv\w*|evolution|history|histor\w+|grew|grown|growth|"
        r"since|over the commits|timeline)\b"
    ),
    "overview": re.compile(
        r"\b(explain (this|the) (repo|repository|project|codebase)|overview|new contributor|"
        r"onboard\w*|introduc\w+|structured?|organi[sz]ed|walk me through|summar\w+|"
        r"what (does|is) (this|the) (repo|repository|project|codebase))\b"
    ),
}
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9]*")
_CAMEL = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+")
_PATHISH = re.compile(r"[\w@.\-]+(?:/[\w@.\-]+)*\.(?:[cm]?[jt]sx?|d\.ts)\b")


def split_identifier(text: str) -> list[str]:
    return [part.lower() for word in _WORD.findall(text) for part in _CAMEL.findall(word)]


def question_terms(question: str) -> list[str]:
    seen: dict[str, None] = {}
    for word in _WORD.findall(_PATHISH.sub(" ", question)):
        for token in [word.lower(), *split_identifier(word)]:
            if len(token) >= 3 and token not in STOPWORDS:
                seen[token] = None
    return list(seen)


def detect_intents(question: str) -> list[Intent]:
    lowered = question.lower()
    return [intent for intent, pattern in INTENT_PATTERNS.items() if pattern.search(lowered)]


def _expanded(terms: list[str]) -> dict[str, float]:
    """Each search word with its weight: 1 for the question's own words, less for related ones."""
    weights = dict.fromkeys(terms, 1.0)
    for term in terms:
        for words in CONCEPTS.values():
            if term in words:
                for word in words:
                    weights.setdefault(word, 0.5)
    return weights


def _concepts_of(terms: list[str]) -> set[str]:
    return {name for name, words in CONCEPTS.items() if any(t in words for t in terms)}


def _path_parts(path: str) -> tuple[list[str], list[str]]:
    """Folder words and file-name words."""
    *folders, name = path.split("/")
    stem = name.split(".", 1)[0]
    folder_words = [w for folder in folders for w in split_identifier(folder)]
    return folder_words, split_identifier(stem)


def _matches(word: str, term: str) -> bool:
    if word == term:
        return True
    # Plurals and short forms: "users" and "user", "authentication" and "auth".
    shorter, longer = sorted((word, term), key=len)
    return len(shorter) >= 4 and longer.startswith(shorter)


def mentioned_files(question: str, graph: CodeGraph) -> list[str]:
    """Files named in the question by full path or by an unambiguous file name."""
    by_name: dict[str, list[str]] = defaultdict(list)
    for file in graph.files:
        by_name[file.path.rsplit("/", 1)[-1].lower()].append(file.path)
    paths = {file.path.lower(): file.path for file in graph.files}
    found: dict[str, None] = {}
    for candidate in _PATHISH.findall(question):
        lowered = candidate.lower().lstrip("./")
        if lowered in paths:
            found[paths[lowered]] = None
            continue
        suffix_matches = [p for low, p in paths.items() if low.endswith("/" + lowered)]
        if len(suffix_matches) == 1:
            found[suffix_matches[0]] = None
        elif "/" not in lowered and len(by_name.get(lowered, [])) == 1:
            found[by_name[lowered][0]] = None
    return list(found)


def rank_files(
    graph: CodeGraph, index: RepositoryIndex | None, terms: list[str]
) -> list[RankedFile]:
    if not terms:
        return []
    weights = _expanded(terms)
    concepts = _concepts_of(terms)
    ranked = []
    for file in graph.files:
        score = 0.0
        reasons: list[str] = []
        folders, stem = _path_parts(file.path)
        stem_hits = [t for t in weights if any(_matches(w, t) for w in stem)]
        folder_hits = [t for t in weights if any(_matches(w, t) for w in folders)]
        if stem_hits:
            score += 4 * max(weights[t] for t in stem_hits)
            reasons.append(f"file name matches “{stem_hits[0]}”")
        if folder_hits:
            score += 3 * max(weights[t] for t in folder_hits)
            reasons.append(f"folder matches “{folder_hits[0]}”")

        entry = index.files.get(file.path) if index else None
        if entry is not None:
            symbol_hits = [
                s.name
                for s in entry.symbols
                if any(_matches(w, t) for w in split_identifier(s.name) for t in weights)
            ]
            if symbol_hits:
                score += min(3, len(symbol_hits)) * 1.5
                reasons.append("declares " + ", ".join(symbol_hits[:3]))
            packages = sorted(
                {
                    i.package
                    for i in entry.imports
                    if i.package and PACKAGE_CONCEPTS.get(i.package) in concepts
                }
            )
            literal_packages = sorted(
                {
                    i.package
                    for i in entry.imports
                    if i.package and any(t == i.package.lower() for t in terms)
                }
            )
            if packages or literal_packages:
                score += 3
                reasons.append("imports " + ", ".join([*packages, *literal_packages][:3]))
        if score >= MIN_SCORE:
            ranked.append(RankedFile(file.path, round(score, 2), tuple(reasons)))
    ranked.sort(key=lambda r: (-r.score, r.path))
    return ranked


class _Builder:
    def __init__(self) -> None:
        self.items: list[Evidence] = []

    def add(self, kind: EvidenceKind, title: str, **fields: object) -> Evidence:
        item = Evidence(id=f"E{len(self.items) + 1}", kind=kind, title=title, **fields)  # type: ignore[arg-type]
        self.items.append(item)
        return item


def retrieve(
    question: str,
    graph: CodeGraph,
    index: RepositoryIndex | None,
    read_source: SourceReader,
    focus: str | None = None,
    changes: Iterable[SnapshotDiff] = (),
    budget: Budget | None = None,
) -> Retrieval:
    budget = budget or Budget()
    files = {f.path: f for f in graph.files}
    terms = question_terms(question)
    intents = detect_intents(question)
    named = mentioned_files(question, graph)
    ranked = rank_files(graph, index, terms)
    notes: list[str] = []

    if focus is not None and focus not in files:
        focus = None
    target = named[0] if named else focus
    if target is None and "dependents" in intents and ranked:
        target = ranked[0].path

    imports_of: dict[str, list[EdgeFact]] = defaultdict(list)
    importers_of: dict[str, list[EdgeFact]] = defaultdict(list)
    for edge in graph.edges:
        fact = EdgeFact(
            edge.source,
            edge.target,
            import_line(index, edge.source, edge.target),
            bool(edge.type_only),
        )
        imports_of[edge.source].append(fact)
        importers_of[edge.target].append(fact)

    builder = _Builder()
    chosen: list[str] = []
    for path in [*named, *([focus] if focus else []), *(r.path for r in ranked)]:
        if path not in chosen and len(chosen) < budget.max_files:
            chosen.append(path)

    if "overview" in intents:
        _overview(builder, graph, importers_of, imports_of, budget)
    if "central" in intents or "overview" in intents:
        _hubs(builder, graph, budget)
    if "cycles" in intents:
        _cycles(builder, graph, imports_of, chosen, budget)
    if target is not None and ("dependents" in intents or target in named or target == focus):
        _dependencies(builder, target, importers_of, imports_of, budget)

    reasons = {r.path: r.reasons for r in ranked}
    snippets = 0
    chars = 0
    for path in chosen:
        node = files[path]
        entry = index.files.get(path) if index else None
        _file_fact(builder, node, entry, reasons.get(path, ()), importers_of, imports_of, budget)
        if snippets >= budget.max_snippets or chars >= budget.snippet_chars:
            continue
        excerpt = _excerpt(node, entry, terms, read_source, budget, budget.snippet_chars - chars)
        if excerpt is not None:
            builder.items.append(excerpt)
            excerpt.id = f"E{len(builder.items)}"
            snippets += 1
            chars += len(excerpt.snippet or "")

    if "history" in intents:
        diffs = list(changes)
        if diffs:
            _history(builder, diffs, chosen, budget)
        else:
            notes.append(
                "No earlier snapshots were analyzed, so there is no history to compare. Analyze "
                "commits on the timeline to ask about change over time."
            )
    if index is None:
        notes.append(
            "Source excerpts and line numbers aren't available for this snapshot. Analyze it "
            "again to include them."
        )

    path_list = sorted(files) if len(files) <= budget.path_list_limit else []
    return Retrieval(
        terms=terms,
        intents=intents,
        ranked=ranked[: budget.max_files * 2],
        evidence=builder.items,
        path_list=path_list,
        target=target,
        notes=notes,
    )


def import_line(index: RepositoryIndex | None, source: str, target: str) -> int | None:
    entry = index.files.get(source) if index else None
    if entry is None:
        return None
    lines = [i.line for i in entry.imports if i.target == target]
    return min(lines) if lines else None


def _describe_edge(edge: EdgeFact, from_side: bool) -> str:
    other = edge.target if from_side else edge.source
    where = f" (line {edge.line} of {edge.source})" if edge.line else ""
    kind = " [type-only]" if edge.type_only else ""
    return f"{other}{where}{kind}"


def _file_fact(
    builder: _Builder,
    node: FileNode,
    entry: FileEvidence | None,
    reasons: tuple[str, ...],
    importers_of: dict[str, list[EdgeFact]],
    imports_of: dict[str, list[EdgeFact]],
    budget: Budget,
) -> None:
    metrics = node.metrics
    facts = [
        f"Language: {node.language}. Lines of code: {node.loc}. "
        f"Cyclomatic complexity: {node.complexity}."
    ]
    if metrics is not None:
        facts.append(
            f"Functions: {metrics.functions}. Classes: {metrics.classes}. "
            f"Exports: {metrics.exports}. Total lines: {metrics.total_lines}."
        )
    outgoing = sorted(imports_of.get(node.path, []), key=lambda e: e.target)
    incoming = sorted(importers_of.get(node.path, []), key=lambda e: e.source)
    facts.append(
        f"Imports {len(outgoing)} file(s) in this repository: "
        + (", ".join(e.target for e in outgoing[: budget.max_listed]) or "none")
    )
    facts.append(
        f"Imported by {len(incoming)} file(s): "
        + (", ".join(e.source for e in incoming[: budget.max_listed]) or "none")
    )
    if entry is not None:
        if entry.symbols:
            facts.append(
                "Declarations: "
                + "; ".join(
                    f"{s.kind} {s.name} (lines {s.line}-{s.end_line}"
                    f"{', exported' if s.exported else ''})"
                    for s in entry.symbols[: budget.max_listed]
                )
            )
        packages = sorted({i.package for i in entry.imports if i.package})
        if packages:
            facts.append("External packages imported: " + ", ".join(packages[: budget.max_listed]))
    if reasons:
        facts.append("Why it was retrieved: " + "; ".join(reasons))
    builder.add("file", node.path, facts=facts, path=node.path, files=[node.path])


def _excerpt(
    node: FileNode,
    entry: FileEvidence | None,
    terms: list[str],
    read_source: SourceReader,
    budget: Budget,
    chars_left: int,
) -> Evidence | None:
    if entry is None or node.blob is None or entry.blob != node.blob:
        return None
    content = read_source(node.blob)
    if content is None:
        return None
    lines = content.decode("utf-8", "replace").splitlines()
    if not lines:
        return None
    weights = _expanded(terms)
    start, end = 1, min(len(lines), budget.snippet_lines)
    label = "start of file"
    matching = [
        s
        for s in entry.symbols
        if any(_matches(w, t) for w in split_identifier(s.name) for t in weights)
    ]
    # Code that does something says more than a one-line constant.
    matching.sort(key=lambda s: (s.kind == "variable", s.line))
    if matching:
        symbol = matching[0]
        start = symbol.line
        end = min(
            max(symbol.end_line, symbol.line + 11),
            symbol.line + budget.snippet_lines - 1,
            len(lines),
        )
        label = f"{symbol.kind} {symbol.name}"
        # Include the comment directly above it: usually its documentation.
        comment = ("//", "/*", "*")
        probe = start - 1
        while probe >= 1 and symbol.line - probe <= 8:
            above = lines[probe - 1].strip()
            if above.startswith(comment):
                start = probe
            elif above or probe == 1 or not lines[probe - 2].strip().startswith(comment):
                break
            probe -= 1
    rendered: list[str] = []
    used = 0
    for number in range(start, end + 1):
        text = lines[number - 1]
        if len(text) > budget.line_chars:
            text = text[: budget.line_chars] + " …[line truncated]"
        row = f"{number:>4}| {text}"
        if used + len(row) + 1 > chars_left:
            end = number - 1
            break
        rendered.append(row)
        used += len(row) + 1
    if not rendered:
        return None
    return Evidence(
        id="",
        kind="snippet",
        title=f"{node.path} lines {start}-{end} ({label})",
        path=node.path,
        line_start=start,
        line_end=end,
        snippet="\n".join(rendered),
        files=[node.path],
    )


def _dependencies(
    builder: _Builder,
    target: str,
    importers_of: dict[str, list[EdgeFact]],
    imports_of: dict[str, list[EdgeFact]],
    budget: Budget,
) -> None:
    incoming = sorted(importers_of.get(target, []), key=lambda e: e.source)
    outgoing = sorted(imports_of.get(target, []), key=lambda e: e.target)
    builder.add(
        "importers",
        f"Files that import {target}",
        facts=[f"{len(incoming)} file(s) import {target} directly."]
        + [_describe_edge(e, from_side=False) for e in incoming[: budget.max_listed]],
        path=target,
        files=[target, *(e.source for e in incoming[: budget.max_listed])],
        edges=incoming[: budget.max_listed],
    )
    # One step further out: what depends on the importers.
    second = sorted(
        {
            e.source
            for first in incoming
            for e in importers_of.get(first.source, [])
            if e.source != target and e.source not in {i.source for i in incoming}
        }
    )
    if second:
        builder.items[-1].facts.append(
            f"{len(second)} more file(s) depend on it indirectly, through those: "
            + ", ".join(second[: budget.max_listed])
        )
    builder.add(
        "imports",
        f"Files {target} imports",
        facts=[f"{target} imports {len(outgoing)} file(s) in this repository."]
        + [_describe_edge(e, from_side=True) for e in outgoing[: budget.max_listed]],
        path=target,
        files=[target, *(e.target for e in outgoing[: budget.max_listed])],
        edges=outgoing[: budget.max_listed],
    )


def _hubs(builder: _Builder, graph: CodeGraph, budget: Budget) -> None:
    analysis = graph.analysis
    if analysis is not None and analysis.hubs:
        hubs = [(h.id, h.incoming, h.outgoing) for h in analysis.hubs]
    else:
        incoming: Counter[str] = Counter(e.target for e in graph.edges)
        outgoing: Counter[str] = Counter(e.source for e in graph.edges)
        hubs = sorted(
            ((f.id, incoming[f.id], outgoing[f.id]) for f in graph.files),
            key=lambda h: (-(h[1] + h[2]), h[0]),
        )[:12]
        hubs = [h for h in hubs if h[1] + h[2] > 0]
    most_imported = sorted(hubs, key=lambda h: (-h[1], h[0]))
    builder.add(
        "hubs",
        "Most connected files",
        facts=[
            "Ranked by imports in plus imports out, counted from the dependency graph.",
            *(f"{path}: imported by {i}, imports {o}" for path, i, o in hubs[: budget.max_listed]),
            "Most imported: " + ", ".join(f"{p} ({i})" for p, i, _ in most_imported[:5] if i > 0),
        ],
        files=[h[0] for h in hubs[: budget.max_listed]],
    )


def _cycles(
    builder: _Builder,
    graph: CodeGraph,
    imports_of: dict[str, list[EdgeFact]],
    chosen: list[str],
    budget: Budget,
) -> None:
    analysis = graph.analysis
    cycles = analysis.cycles if analysis else []
    if not cycles:
        builder.add(
            "cycle",
            "Circular dependencies",
            facts=["The analysis found no circular dependencies between files in this repository."],
        )
        return
    total = analysis.cycle_count if analysis else len(cycles)
    # Cycles touching the files the question is about come first.
    ordered = sorted(cycles, key=lambda c: (not any(p in c.files for p in chosen), -len(c.files)))
    for cycle in ordered[:5]:
        members = set(cycle.files)
        edges = [e for p in cycle.files for e in imports_of.get(p, []) if e.target in members]
        builder.add(
            "cycle",
            f"Circular dependency among {len(cycle.files)} files",
            facts=[
                f"{total} circular dependency group(s) in total." if cycle is ordered[0] else "",
                "Files: " + ", ".join(cycle.files[: budget.max_listed]),
                "Every import in it is type-only, so it can't affect load order at runtime."
                if cycle.type_only
                else "At least one import in it is a runtime import.",
                *(
                    _describe_edge(e, from_side=True).replace(
                        e.target, f"{e.source} -> {e.target}", 1
                    )
                    for e in edges[: budget.max_listed]
                ),
            ],
            files=cycle.files[: budget.max_listed],
            edges=edges[: budget.max_listed],
        )
        builder.items[-1].facts = [f for f in builder.items[-1].facts if f]


def _overview(
    builder: _Builder,
    graph: CodeGraph,
    importers_of: dict[str, list[EdgeFact]],
    imports_of: dict[str, list[EdgeFact]],
    budget: Budget,
) -> None:
    folders: Counter[str] = Counter()
    folder_loc: Counter[str] = Counter()
    for file in graph.files:
        parts = file.path.split("/")
        folder = "/".join(parts[:2]) if len(parts) > 2 else (parts[0] if len(parts) > 1 else ".")
        folders[folder] += 1
        folder_loc[folder] += file.loc
    entry_points = sorted(
        (f.path for f in graph.files if not importers_of.get(f.path) and imports_of.get(f.path)),
        key=lambda p: (-len(imports_of[p]), p),
    )
    analysis = graph.analysis
    facts = [
        f"{len(graph.files)} analyzed source files and {len(graph.edges)} import relationships "
        "between them.",
        "Folders by file count: "
        + ", ".join(
            f"{name} ({count} files, {folder_loc[name]} lines of code)"
            for name, count in folders.most_common(12)
        ),
        "Files nothing else imports, but which import others (likely entry points, tests or "
        "scripts): " + (", ".join(entry_points[:10]) or "none"),
    ]
    if analysis is not None:
        facts.insert(0, f"Repository: {analysis.repository.full_name}.")
        facts.append(
            "Languages: " + ", ".join(f"{k} ({v} files)" for k, v in analysis.languages.items())
        )
        packages = [d.name for d in analysis.external_dependencies if d.kind == "package"]
        if packages:
            facts.append(
                "Most imported external packages: " + ", ".join(packages[: budget.max_listed])
            )
        facts.append(f"Circular dependency groups: {analysis.cycle_count}.")
        if analysis.skipped_files:
            facts.append(
                "Present but not analyzed: "
                + ", ".join(f"{v} {k}" for k, v in analysis.skipped_files.items())
            )
    builder.add(
        "overview",
        "Repository structure",
        facts=facts,
        files=entry_points[:10],
        quoted=[analysis.repository.description]
        if analysis is not None and analysis.repository.description
        else [],
    )


def _history(
    builder: _Builder, diffs: list[SnapshotDiff], chosen: list[str], budget: Budget
) -> None:
    folders = {p.rsplit("/", 1)[0] for p in chosen if "/" in p}

    def relevant(path: str) -> bool:
        return not chosen or path in chosen or any(path.startswith(f + "/") for f in folders)

    for diff in diffs:
        added = [p for p in diff.files.added if relevant(p)]
        removed = [p for p in diff.files.removed if relevant(p)]
        modified = [m for m in diff.files.modified if relevant(m.path)]
        renamed = [r for r in diff.files.renamed if relevant(r.new_path) or relevant(r.old_path)]
        scope = "in the files this question is about" if chosen else "across the repository"
        facts = [
            f"From {diff.base.sha[:7]} ({diff.base.committed_at or 'date unknown'}) to "
            f"{diff.head.sha[:7]} ({diff.head.committed_at or 'date unknown'}), {scope}:",
            f"Added {len(added)}: " + (", ".join(added[: budget.max_listed]) or "none"),
            f"Removed {len(removed)}: " + (", ".join(removed[: budget.max_listed]) or "none"),
            f"Modified {len(modified)}: "
            + (
                ", ".join(
                    f"{m.path} (lines of code {m.before.loc} -> {m.after.loc}, importers "
                    f"{m.before.incoming} -> {m.after.incoming})"
                    for m in modified[: budget.max_listed]
                )
                or "none"
            ),
            f"Renamed {len(renamed)}: "
            + (", ".join(f"{r.old_path} -> {r.new_path}" for r in renamed[:10]) or "none"),
            "Repository-wide: "
            + "; ".join(f"{m.label} {m.before:g} -> {m.after:g}" for m in diff.metrics),
            f"Rename detection: {diff.rename_detection.note}",
        ]
        builder.add(
            "change",
            f"Changes from {diff.base.sha[:7]} to {diff.head.sha[:7]}",
            facts=facts,
            files=[*added[:10], *(m.path for m in modified[:10])],
            quoted=[m for m in (diff.base.message, diff.head.message) if m],
        )
