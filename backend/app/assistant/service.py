"""Answers one question about one analyzed commit: retrieve evidence, ask the model, check it."""

import asyncio
import itertools
from collections.abc import Callable

from app.analysis.diff import diff_graphs
from app.analysis.evidence import EvidenceStore, RepositoryIndex
from app.assistant.llm import LLMClient, LLMError, LLMRequest
from app.assistant.prompt import ANSWER_SCHEMA, SYSTEM_PROMPT, build_user_message
from app.assistant.retrieval import (
    Budget,
    Evidence,
    Retrieval,
    detect_intents,
    import_line,
    retrieve,
)
from app.assistant.validate import check_answer, parse_answer
from app.schemas.assistant import (
    ArchitectAnswer,
    EdgeView,
    EvidenceView,
    FileReference,
    LineSpan,
    Relationship,
    SearchInfo,
)
from app.schemas.diff import SnapshotDiff
from app.schemas.graph import CodeGraph

# The prompt is checked against this before sending. Retrieval stays well under it.
MAX_PROMPT_CHARS = 60_000
MAX_HISTORY_STEPS = 5

GraphLookup = Callable[[str], CodeGraph | None]


class ArchitectService:
    def __init__(
        self,
        evidence: EvidenceStore,
        llm: LLMClient | None,
        max_concurrent: int = 2,
        budget: Budget | None = None,
    ) -> None:
        self._evidence = evidence
        self._llm = llm
        self._slots = asyncio.Semaphore(max_concurrent)
        self._budget = budget or Budget()

    @property
    def enabled(self) -> bool:
        return self._llm is not None

    async def ask(
        self,
        question: str,
        graph: CodeGraph,
        index_key: str,
        focus: str | None = None,
        history: list[CodeGraph] | None = None,
    ) -> ArchitectAnswer:
        index = self._evidence.index(index_key)
        commit = graph.analysis.repository.commit_sha if graph.analysis else ""
        if index is not None and index.commit_sha != commit:
            index = None
        wants_history = "history" in detect_intents(question)
        changes = _changes(history or [], graph) if wants_history else []
        retrieval = retrieve(
            question,
            graph,
            index,
            self._evidence.source,
            focus=focus,
            changes=changes,
            budget=self._budget,
        )

        if not retrieval.has_signal:
            return _insufficient(question, graph, retrieval)
        if self._llm is None:
            return _evidence_only(question, graph, retrieval, index)

        user = build_user_message(question, graph, retrieval)
        if len(user) > MAX_PROMPT_CHARS:
            # Retrieval is bounded, so this means a bug, not a big repository.
            raise LLMError("invalid_output", "The question needed more context than allowed.")
        if self._slots.locked():
            raise LLMError("busy", "AI Architect is answering other questions. Try again shortly.")
        async with self._slots:
            reply = await self._llm.complete(
                LLMRequest(system=SYSTEM_PROMPT, user=user, schema=ANSWER_SCHEMA)
            )
        checked = check_answer(
            parse_answer(reply.text),
            graph,
            retrieval.evidence,
            edge_line=lambda s, t: import_line(index, s, t),
        )
        notes = [*retrieval.notes, *checked.notes]
        if reply.fallback:
            notes.append(f"Answered by the fallback model {reply.model}.")
        return ArchitectAnswer(
            mode="ai",
            question=question,
            repository=graph.provenance.repository,
            commit_sha=commit,
            answer=checked.answer,
            claims=checked.claims,
            files=checked.files,
            relationships=checked.relationships,
            uncertainty=checked.uncertainty,
            sufficient_evidence=checked.sufficient_evidence,
            evidence=_views(retrieval.evidence),
            notes=notes,
            search=_search(retrieval),
            model=reply.model,
        )


def _changes(history: list[CodeGraph], current: CodeGraph) -> list[SnapshotDiff]:
    """Consecutive comparisons across the analyzed snapshots, oldest first, ending at current."""
    snapshots = {g.analysis.repository.commit_sha: g for g in [*history, current] if g.analysis}

    def committed(graph: CodeGraph) -> str:
        return (graph.analysis.repository.committed_at or "") if graph.analysis else ""

    ordered = sorted(snapshots.values(), key=committed)
    pairs = list(itertools.pairwise(ordered))[-MAX_HISTORY_STEPS:]
    # Renames come from identical content only: answering a question never calls GitHub.
    return [diff_graphs(base, head, None, False) for base, head in pairs]


def _views(evidence: list[Evidence]) -> list[EvidenceView]:
    return [
        EvidenceView(
            id=item.id,
            kind=item.kind,
            title=item.title,
            facts=item.facts,
            path=item.path,
            line_start=item.line_start,
            line_end=item.line_end,
            snippet=item.snippet,
            files=list(dict.fromkeys(item.files)),
            edges=[
                EdgeView(source=e.source, target=e.target, line=e.line, type_only=e.type_only)
                for e in item.edges
            ],
        )
        for item in evidence
    ]


def _search(retrieval: Retrieval) -> SearchInfo:
    return SearchInfo(
        terms=retrieval.terms, intents=list(retrieval.intents), target=retrieval.target
    )


def _insufficient(question: str, graph: CodeGraph, retrieval: Retrieval) -> ArchitectAnswer:
    searched = ", ".join(f"“{t}”" for t in retrieval.terms[:8]) or "nothing specific"
    message = (
        "GitVerse found nothing in this analysis that relates to this question, so there's no "
        f"evidence to answer from. It searched file paths, declarations and imported packages for "
        f"{searched}. The analysis covers the structure of the repository's JavaScript and "
        "TypeScript files: what they declare and import. It doesn't include runtime behavior, "
        "documentation or other languages. Try naming a file, folder, function or package."
    )
    return ArchitectAnswer(
        mode="insufficient_evidence",
        question=question,
        repository=graph.provenance.repository,
        commit_sha=graph.analysis.repository.commit_sha if graph.analysis else "",
        answer=None,
        claims=[],
        files=[],
        relationships=[],
        uncertainty=message,
        sufficient_evidence=False,
        evidence=[],
        notes=retrieval.notes,
        search=_search(retrieval),
    )


def _evidence_only(
    question: str, graph: CodeGraph, retrieval: Retrieval, index: RepositoryIndex | None
) -> ArchitectAnswer:
    """Without a model: the retrieved evidence, ranked, with no explanation written on top."""
    files: list[FileReference] = []
    reasons = {r.path: r.reasons for r in retrieval.ranked}
    incoming: dict[str, int] = {}
    outgoing: dict[str, int] = {}
    for edge in graph.edges:
        incoming[edge.target] = incoming.get(edge.target, 0) + 1
        outgoing[edge.source] = outgoing.get(edge.source, 0) + 1

    def reason(path: str) -> str:
        if reasons.get(path):
            return "; ".join(reasons[path])
        return (
            f"Imported by {incoming.get(path, 0)} file(s), imports {outgoing.get(path, 0)} "
            "in this repository."
        )

    ordered = [
        *([retrieval.target] if retrieval.target else []),
        *(r.path for r in retrieval.ranked),
        *(p for item in retrieval.evidence for p in item.files),
    ]
    for path in dict.fromkeys(ordered):
        if len(files) >= 10:
            break
        ids = [item.id for item in retrieval.evidence if path in item.files]
        spans = [
            LineSpan(start=item.line_start, end=item.line_end, label=item.title)
            for item in retrieval.evidence
            if item.path == path and item.line_start and item.line_end
        ]
        files.append(
            FileReference(
                path=path,
                reason=reason(path),
                evidence=ids,
                lines=spans,
            )
        )
    edges = {(e.source, e.target): e for item in retrieval.evidence for e in item.edges}
    relationships = [
        Relationship(
            source=s,
            target=t,
            line=e.line if e.line is not None else import_line(index, s, t),
            type_only=e.type_only,
        )
        for (s, t), e in sorted(edges.items())
    ][:20]
    return ArchitectAnswer(
        mode="evidence_only",
        question=question,
        repository=graph.provenance.repository,
        commit_sha=graph.analysis.repository.commit_sha if graph.analysis else "",
        answer=None,
        claims=[],
        files=files,
        relationships=relationships,
        uncertainty=None,
        sufficient_evidence=bool(retrieval.evidence),
        evidence=_views(retrieval.evidence),
        notes=[
            *retrieval.notes,
            "AI explanations are turned off on this server, so this is the evidence GitVerse "
            "found, without an explanation.",
        ],
        search=_search(retrieval),
    )
