"""Compares two analyzed snapshots of the same repository.

Identity comes from paths and git blob SHAs, never from metrics: a file is unchanged exactly when
its blob SHA is unchanged. Renames come from GitHub's diff when it's available, and otherwise
only from byte-identical content (see detect_renames).
"""

from collections import defaultdict
from typing import Literal

import networkx as nx

from app.schemas.diff import (
    CommitRef,
    EdgeChanges,
    EdgeRef,
    FileChanges,
    FileMeasures,
    MetricChange,
    ModifiedFile,
    RenameDetection,
    RenamedFile,
    SnapshotDiff,
)
from app.schemas.graph import CodeGraph, FileNode

LIST_LIMIT = 2000


def commit_ref(graph: CodeGraph) -> CommitRef:
    repository = graph.analysis.repository if graph.analysis else None
    if repository is None:
        raise ValueError("snapshot has no repository details")
    return CommitRef(
        sha=repository.commit_sha,
        committed_at=repository.committed_at,
        message=repository.commit_message,
        author=repository.commit_author,
    )


def detect_renames(
    base: CodeGraph, head: CodeGraph, from_github: dict[str, str] | None
) -> tuple[dict[str, str], bool]:
    """Old path to new path. Returns the renames and whether any came from content alone.

    GitHub's renames are trusted when both ends exist in the snapshots. For files GitHub didn't
    pair up, a removed file and an added file with the same blob SHA are a move; when several
    files share content, only a one-to-one match counts. Renames that also changed content can
    only come from GitHub.
    """
    base_paths = {f.path for f in base.files}
    head_paths = {f.path for f in head.files}
    removed = base_paths - head_paths
    added = head_paths - base_paths

    renames = {
        old: new for old, new in (from_github or {}).items() if old in removed and new in added
    }
    used_targets = set(renames.values())

    by_blob_removed: dict[str, list[str]] = defaultdict(list)
    by_blob_added: dict[str, list[str]] = defaultdict(list)
    for file in base.files:
        if file.path in removed and file.path not in renames and file.blob:
            by_blob_removed[file.blob].append(file.path)
    for file in head.files:
        if file.path in added and file.path not in used_targets and file.blob:
            by_blob_added[file.blob].append(file.path)

    from_content = False
    for blob, olds in by_blob_removed.items():
        news = by_blob_added.get(blob, [])
        if len(olds) == 1 and len(news) == 1:
            renames[olds[0]] = news[0]
            from_content = True
    return renames, from_content


def _measures(file: FileNode, graph: "nx.DiGraph[str]") -> FileMeasures:
    return FileMeasures(
        loc=file.loc,
        complexity=file.complexity,
        incoming=graph.in_degree(file.path) if file.path in graph else 0,
        outgoing=graph.out_degree(file.path) if file.path in graph else 0,
    )


def _graph(snapshot: CodeGraph) -> "nx.DiGraph[str]":
    graph: nx.DiGraph[str] = nx.DiGraph()
    graph.add_nodes_from(f.path for f in snapshot.files)
    graph.add_edges_from((e.source, e.target) for e in snapshot.edges)
    return graph


def _metrics(snapshot: CodeGraph, graph: "nx.DiGraph[str]") -> dict[str, tuple[str, float]]:
    cycles = [c for c in nx.strongly_connected_components(graph) if len(c) > 1]
    files = len(snapshot.files)
    analysis = snapshot.analysis
    return {
        "files": ("Files", files),
        "edges": ("Dependency edges", len(snapshot.edges)),
        "loc": ("Lines of code", sum(f.loc for f in snapshot.files)),
        "cycles": ("Dependency cycles", len(cycles)),
        "filesInCycles": ("Files in cycles", sum(len(c) for c in cycles)),
        "averageComplexity": (
            "Average complexity",
            round(sum(f.complexity for f in snapshot.files) / files, 2) if files else 0,
        ),
        "maxIncoming": (
            "Most importers of one file",
            max((graph.in_degree(n) for n in graph.nodes), default=0),
        ),
        "externalPackages": (
            "External packages",
            sum(1 for d in analysis.external_dependencies if d.kind == "package")
            if analysis
            else 0,
        ),
        "unresolvedImports": (
            "Unresolved imports",
            analysis.unresolved_import_count if analysis else 0,
        ),
    }


def diff_graphs(
    base: CodeGraph,
    head: CodeGraph,
    github_renames: dict[str, str] | None,
    github_complete: bool,
) -> SnapshotDiff:
    renames, from_content = detect_renames(base, head, github_renames)
    base_files = {f.path: f for f in base.files}
    head_files = {f.path: f for f in head.files}
    base_graph, head_graph = _graph(base), _graph(head)

    renamed_targets = set(renames.values())
    added = sorted(p for p in head_files if p not in base_files and p not in renamed_targets)
    removed = sorted(p for p in base_files if p not in head_files and p not in renames)

    modified: list[ModifiedFile] = []
    unchanged = 0
    for path in sorted(base_files.keys() & head_files.keys()):
        before, after = base_files[path], head_files[path]
        if before.blob is not None and before.blob == after.blob:
            unchanged += 1
        else:
            modified.append(
                ModifiedFile(
                    path=path,
                    before=_measures(before, base_graph),
                    after=_measures(after, head_graph),
                )
            )

    renamed = [
        RenamedFile(
            **{"from": old, "to": new},
            content_changed=base_files[old].blob != head_files[new].blob
            or base_files[old].blob is None,
        )
        for old, new in sorted(renames.items())
    ]

    # Edges are compared after carrying renamed files across, so a move isn't an edge change.
    def carried(path: str) -> str:
        return renames.get(path, path)

    base_edges = {(e.source, e.target) for e in base.edges}
    carried_base = {(carried(s), carried(t)) for s, t in base_edges}
    head_edges = {(e.source, e.target) for e in head.edges}
    edges_added = sorted(head_edges - carried_base)
    edges_removed = sorted(
        (s, t) for s, t in base_edges if (carried(s), carried(t)) not in head_edges
    )

    before_metrics, after_metrics = _metrics(base, base_graph), _metrics(head, head_graph)
    metrics = [
        MetricChange(
            name=name,
            label=label,
            before=before,
            after=after_metrics[name][1],
            delta=round(after_metrics[name][1] - before, 2),
        )
        for name, (label, before) in before_metrics.items()
    ]

    method: Literal["github", "content", "github+content"]
    if github_renames is None:
        method, note = (
            "content",
            "GitHub's comparison wasn't available, so only moves with identical content were "
            "detected. A file renamed and edited in the same change appears as removed and added.",
        )
    else:
        method = "github+content" if from_content else "github"
        note = "Renames come from GitHub's comparison, which matches files by similarity." + (
            " GitHub's file list was cut off, so some renames may be missing."
            if not github_complete
            else ""
        )

    return SnapshotDiff(
        repository=head.provenance.repository,
        base=commit_ref(base),
        head=commit_ref(head),
        files=FileChanges(
            added=added[:LIST_LIMIT],
            removed=removed[:LIST_LIMIT],
            modified=modified[:LIST_LIMIT],
            renamed=renamed[:LIST_LIMIT],
            unchanged=unchanged,
            added_count=len(added),
            removed_count=len(removed),
            modified_count=len(modified),
            renamed_count=len(renamed),
        ),
        edges=EdgeChanges(
            added=[EdgeRef(source=s, target=t) for s, t in edges_added[:LIST_LIMIT]],
            removed=[EdgeRef(source=s, target=t) for s, t in edges_removed[:LIST_LIMIT]],
            unchanged=len(head_edges) - len(edges_added),
            added_count=len(edges_added),
            removed_count=len(edges_removed),
        ),
        metrics=metrics,
        rename_detection=RenameDetection(
            method=method,
            complete=github_renames is not None and github_complete,
            note=note,
        ),
    )
