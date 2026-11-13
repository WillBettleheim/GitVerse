"""AI Architect's request and answer. Mirrored by frontend/src/lib/architect/schema.ts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

MAX_QUESTION_CHARS = 500
MAX_SNAPSHOTS = 8


class _Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class QuestionRequest(_Model):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, frozen=True, extra="forbid"
    )

    repository: str = Field(min_length=1, max_length=300)
    commit: str = Field(pattern=r"^[0-9a-f]{40}$")
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    # The file selected in the explorer, if any. Ignored unless it's in the analysis.
    focus: str | None = Field(default=None, max_length=1024)
    # Other analyzed commits of the same repository, for questions about change over time.
    snapshots: list[str] = Field(default_factory=list, max_length=MAX_SNAPSHOTS)


class LineSpan(_Model):
    start: int = Field(ge=1)
    end: int = Field(ge=1)
    label: str


class EdgeView(_Model):
    source: str
    target: str
    line: int | None = None
    type_only: bool = False


class EvidenceView(_Model):
    id: str
    kind: str
    title: str
    facts: list[str]
    path: str | None = None
    line_start: int | None = None
    line_end: int | None = None
    snippet: str | None = None
    files: list[str]
    edges: list[EdgeView]


class Claim(_Model):
    text: str
    basis: Literal["verified", "inferred"]
    evidence: list[str]
    # The model called it verified but cited nothing that backs it, so it was relabelled.
    downgraded: bool = False


class FileReference(_Model):
    path: str
    reason: str
    evidence: list[str]
    # Line ranges taken from the cited evidence, never from the model.
    lines: list[LineSpan]


class Relationship(_Model):
    source: str
    target: str
    # The import's line in the source file, from the analysis.
    line: int | None = None
    type_only: bool = False


class SearchInfo(_Model):
    terms: list[str]
    intents: list[str]
    target: str | None


AnswerMode = Literal["ai", "evidence_only", "insufficient_evidence"]


class ArchitectAnswer(_Model):
    mode: AnswerMode
    question: str
    repository: str
    commit_sha: str
    # The model's explanation. None when no model was asked.
    answer: str | None
    claims: list[Claim]
    files: list[FileReference]
    relationships: list[Relationship]
    uncertainty: str | None
    sufficient_evidence: bool
    evidence: list[EvidenceView]
    # What validation removed or changed, and other caveats, in plain language.
    notes: list[str]
    search: SearchInfo
    model: str | None = None
