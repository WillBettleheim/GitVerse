"""Turns parsed files and resolved imports into a NetworkX graph and the CodeGraph output."""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime

import networkx as nx

from app.analysis import ANALYZER_VERSION
from app.analysis.parser import ImportRef, ParsedFile
from app.analysis.resolver import ModuleResolver, Resolution
from app.schemas.graph import (
    AnalysisSummary,
    CodeGraph,
    DependencyCycle,
    ExternalDependency,
    FileMetrics,
    FileNode,
    Hub,
    ImportEdge,
    Provenance,
    RepositoryInfo,
    UnresolvedImport,
)

MAX_LISTED_UNRESOLVED = 300
MAX_LISTED_CYCLES = 50
MAX_HUBS = 12


@dataclass(frozen=True)
class ResolvedImport:
    source: str
    ref: ImportRef
    resolution: Resolution


def resolve_imports(files: list[ParsedFile], resolver: ModuleResolver) -> list[ResolvedImport]:
    return [
        ResolvedImport(parsed.path, ref, resolver.resolve(parsed.path, ref.specifier))
        for parsed in files
        for ref in parsed.imports
    ]


def build_dependency_graph(
    files: list[ParsedFile], imports: list[ResolvedImport]
) -> "nx.DiGraph[str]":
    """Internal imports only. An edge is type-only if every import along it is."""
    graph: nx.DiGraph[str] = nx.DiGraph()
    graph.add_nodes_from(parsed.path for parsed in files)
    for item in imports:
        target = item.resolution.target
        if item.resolution.kind != "internal" or target is None or target == item.source:
            continue
        type_only = item.ref.kind == "type"
        if graph.has_edge(item.source, target):
            graph.edges[item.source, target]["type_only"] &= type_only
        else:
            graph.add_edge(item.source, target, type_only=type_only)
    return graph


def find_cycles(graph: "nx.DiGraph[str]") -> list[DependencyCycle]:
    cycles = []
    for component in nx.strongly_connected_components(graph):
        if len(component) < 2:
            continue
        members = sorted(component)
        subgraph = graph.subgraph(members)
        type_only = all(data["type_only"] for _, _, data in subgraph.edges(data=True))
        cycles.append(DependencyCycle(files=members, type_only=type_only))
    # Largest first, then by path, so the listing is deterministic.
    return sorted(cycles, key=lambda c: (-len(c.files), c.files[0]))


def find_hubs(graph: "nx.DiGraph[str]") -> list[Hub]:
    """The most connected modules, by imports in plus imports out."""
    ranked = sorted(
        (
            (graph.in_degree(node) + graph.out_degree(node), node)
            for node in graph.nodes
            if graph.in_degree(node) + graph.out_degree(node) > 0
        ),
        key=lambda pair: (-pair[0], pair[1]),
    )
    return [
        Hub(id=node, incoming=graph.in_degree(node), outgoing=graph.out_degree(node))
        for _, node in ranked[:MAX_HUBS]
    ]


def build_code_graph(
    repository: RepositoryInfo,
    files: list[ParsedFile],
    imports: list[ResolvedImport],
    skipped: Counter[str],
    analyzed_at: datetime | None = None,
    blobs: dict[str, str] | None = None,
) -> CodeGraph:
    graph = build_dependency_graph(files, imports)
    cycles = find_cycles(graph)

    external_by_file: dict[str, int] = Counter()
    unresolved_by_file: dict[str, int] = Counter()
    package_importers: dict[tuple[str, str], set[str]] = defaultdict(set)
    unresolved: list[UnresolvedImport] = []
    for item in imports:
        kind = item.resolution.kind
        if kind in ("external", "builtin") and item.resolution.package:
            external_by_file[item.source] += 1
            dependency_kind = "builtin" if kind == "builtin" else "package"
            package_importers[(item.resolution.package, dependency_kind)].add(item.source)
        elif kind == "unresolved":
            unresolved_by_file[item.source] += 1
            unresolved.append(
                UnresolvedImport(
                    source=item.source,
                    specifier=item.ref.specifier[:300],
                    line=item.ref.line,
                    reason=item.resolution.reason or "Unresolved",
                )
            )
    unresolved.sort(key=lambda u: (u.source, u.line, u.specifier))

    nodes = []
    for parsed in sorted(files, key=lambda f: f.path):
        nodes.append(
            FileNode(
                id=parsed.path,
                path=parsed.path,
                language=parsed.language,
                loc=parsed.code_lines,
                complexity=parsed.complexity,
                blob=(blobs or {}).get(parsed.path),
                metrics=FileMetrics(
                    total_lines=parsed.total_lines,
                    functions=parsed.functions,
                    classes=parsed.classes,
                    exports=len(parsed.exports),
                    local_dependencies=graph.out_degree(parsed.path),
                    incoming_dependencies=graph.in_degree(parsed.path),
                    external_imports=external_by_file.get(parsed.path, 0),
                    unresolved_imports=unresolved_by_file.get(parsed.path, 0),
                    parse_error=parsed.parse_error,
                ),
            )
        )

    edges = [
        ImportEdge(source=source, target=target, type_only=data["type_only"])
        for source, target, data in sorted(graph.edges(data=True), key=lambda e: (e[0], e[1]))
    ]

    externals = sorted(
        (
            ExternalDependency(name=name, kind=kind, importers=len(importers))  # type: ignore[arg-type]
            for (name, kind), importers in package_importers.items()
        ),
        key=lambda d: (-d.importers, d.name),
    )

    summary = AnalysisSummary(
        repository=repository,
        analyzer_version=ANALYZER_VERSION,
        analyzed_at=(analyzed_at or datetime.now(UTC)).isoformat(timespec="seconds"),
        languages=dict(sorted(Counter(f.language for f in files).items())),
        total_loc=sum(f.code_lines for f in files),
        external_dependencies=externals,
        unresolved_imports=unresolved[:MAX_LISTED_UNRESOLVED],
        unresolved_import_count=len(unresolved),
        cycles=cycles[:MAX_LISTED_CYCLES],
        cycle_count=len(cycles),
        hubs=find_hubs(graph),
        skipped_files=dict(sorted(skipped.items())),
        files_with_parse_errors=sum(1 for f in files if f.parse_error),
    )

    return CodeGraph(
        schemaVersion=1,
        provenance=Provenance(
            kind="analysis",
            repository=repository.full_name,
            note=f"Static analysis of commit {repository.commit_sha[:7]}.",
        ),
        files=nodes,
        edges=edges,
        analysis=summary,
    )
