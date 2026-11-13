"""Checks the model's answer against the analysis before anyone sees it.

The model can't add facts that the analysis doesn't have:
- Files that aren't in the analyzed commit are removed, and the removal is reported.
- Relationships are kept only when the import really exists, and carry the analysis's line.
- Evidence ids that weren't supplied are dropped. A "verified" claim left with no evidence is
  relabelled "inferred".
- Line links come only from the evidence, never from the model's text.
- Paths mentioned in the prose that aren't in the analysis are flagged.
"""

import json
import re
from collections.abc import Callable

from pydantic import BaseModel, ConfigDict, ValidationError

from app.assistant.llm import LLMError
from app.assistant.retrieval import Evidence
from app.schemas.assistant import Claim, FileReference, LineSpan, Relationship
from app.schemas.graph import CodeGraph

MAX_CLAIMS = 12
MAX_FILES = 12
MAX_RELATIONSHIPS = 20
MAX_TEXT = 4000
_PATH_IN_TEXT = re.compile(r"(?<![\w@/.-])((?:[\w@.-]+/)+[\w@.-]+\.[cm]?[jt]sx?)\b")


class _RawClaim(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str
    basis: str
    evidence: list[str]


class _RawFile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    path: str
    reason: str
    evidence: list[str]


class _RawRelationship(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source: str
    target: str
    evidence: list[str]


class RawAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    answer: str
    claims: list[_RawClaim]
    files: list[_RawFile]
    relationships: list[_RawRelationship]
    uncertainty: str
    sufficient_evidence: bool


class CheckedAnswer(BaseModel):
    answer: str
    claims: list[Claim]
    files: list[FileReference]
    relationships: list[Relationship]
    uncertainty: str | None
    sufficient_evidence: bool
    notes: list[str]


def parse_answer(text: str) -> RawAnswer:
    try:
        return RawAnswer.model_validate(json.loads(text))
    except (ValueError, ValidationError) as exc:
        raise LLMError(
            "invalid_output", "The model's answer wasn't in the expected format."
        ) from exc


def _normalize(path: str) -> str:
    return path.strip().strip("`'\"").removeprefix("./")


EdgeLine = Callable[[str, str], int | None]


def check_answer(
    raw: RawAnswer,
    graph: CodeGraph,
    evidence: list[Evidence],
    edge_line: EdgeLine | None = None,
) -> CheckedAnswer:
    known_files = {f.path for f in graph.files}
    edges = {(e.source, e.target): e for e in graph.edges}
    by_id = {item.id: item for item in evidence}
    notes: list[str] = []

    def cited(ids: list[str]) -> list[str]:
        return list(dict.fromkeys(i for i in ids if i in by_id))

    citations = [
        *(c.evidence for c in raw.claims),
        *(f.evidence for f in raw.files),
        *(r.evidence for r in raw.relationships),
    ]
    unknown_ids = sorted({i for ids in citations for i in ids if i not in by_id})
    if unknown_ids:
        notes.append(f"Ignored citations of evidence that doesn't exist: {', '.join(unknown_ids)}.")

    claims: list[Claim] = []
    downgraded = 0
    for item in raw.claims[:MAX_CLAIMS]:
        ids = cited(item.evidence)
        basis = "verified" if item.basis == "verified" else "inferred"
        demoted = basis == "verified" and not ids
        if demoted:
            downgraded += 1
            basis = "inferred"
        claims.append(
            Claim(text=item.text[:1000], basis=basis, evidence=ids, downgraded=demoted)  # type: ignore[arg-type]
        )
    if downgraded:
        notes.append(
            f"{downgraded} claim(s) labelled verified cited no supporting evidence, so they're "
            "shown as inferred."
        )

    files: list[FileReference] = []
    invented: list[str] = []
    for entry in raw.files:
        path = _normalize(entry.path)
        if path not in known_files:
            invented.append(path)
            continue
        if any(f.path == path for f in files) or len(files) >= MAX_FILES:
            continue
        ids = cited(entry.evidence)
        files.append(
            FileReference(
                path=path,
                reason=entry.reason[:300],
                evidence=ids,
                lines=_lines_for(path, ids, by_id),
            )
        )
    if invented:
        notes.append(
            "Removed references to files that aren't in this analysis: "
            + ", ".join(sorted(set(invented))[:10])
            + "."
        )

    relationships: list[Relationship] = []
    rejected = 0
    for rel in raw.relationships:
        key = (_normalize(rel.source), _normalize(rel.target))
        edge = edges.get(key)
        if edge is None:
            rejected += 1
            continue
        if len(relationships) >= MAX_RELATIONSHIPS or any(
            (r.source, r.target) == key for r in relationships
        ):
            continue
        relationships.append(
            Relationship(
                source=key[0],
                target=key[1],
                line=_edge_line(key, by_id) or (edge_line(*key) if edge_line else None),
                type_only=bool(edge.type_only),
            )
        )
    if rejected:
        notes.append(
            f"Removed {rejected} relationship(s) that the dependency graph doesn't contain."
        )

    answer = raw.answer.strip()[:MAX_TEXT]
    mentioned = {_normalize(m) for m in _PATH_IN_TEXT.findall(answer)}
    unknown_mentions = sorted(
        m for m in mentioned if m not in known_files and not _is_known_suffix(m, known_files)
    )
    if unknown_mentions:
        notes.append(
            "The explanation mentions paths that aren't in this analysis, so treat them with "
            "caution: " + ", ".join(unknown_mentions[:10]) + "."
        )

    uncertainty = raw.uncertainty.strip()[:1000] or None
    return CheckedAnswer(
        answer=answer,
        claims=claims,
        files=files,
        relationships=relationships,
        uncertainty=uncertainty,
        sufficient_evidence=raw.sufficient_evidence,
        notes=notes,
    )


def _is_known_suffix(path: str, known: set[str]) -> bool:
    return any(k.endswith("/" + path) for k in known)


def _lines_for(path: str, ids: list[str], by_id: dict[str, Evidence]) -> list[LineSpan]:
    """Verified line ranges in this file: from the cited evidence first, then any other."""
    spans: list[LineSpan] = []
    ordered = [*ids, *(i for i in by_id if i not in ids)]
    for item in (by_id[i] for i in ordered):
        if item.path == path and item.line_start is not None and item.line_end is not None:
            spans.append(LineSpan(start=item.line_start, end=item.line_end, label=item.title))
        for edge in item.edges:
            if edge.source == path and edge.line is not None:
                spans.append(
                    LineSpan(start=edge.line, end=edge.line, label=f"imports {edge.target}")
                )
    unique: dict[tuple[int, int], LineSpan] = {}
    for span in spans:
        unique.setdefault((span.start, span.end), span)
    return sorted(unique.values(), key=lambda s: s.start)[:6]


def _edge_line(key: tuple[str, str], by_id: dict[str, Evidence]) -> int | None:
    for item in by_id.values():
        for edge in item.edges:
            if (edge.source, edge.target) == key and edge.line is not None:
                return edge.line
    return None
