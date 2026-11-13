"""The CodeGraph contract shared with the frontend.

Mirrored by frontend/src/lib/graph/schema.ts. The contract tests validate the frontend's demo data
and a real analysis sample against both definitions, so they can't drift silently.

Everything beyond the original version-1 fields is optional, so hand-written demo data stays valid.
Real analysis fills it in.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

SCHEMA_VERSION = 1


class _Strict(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, alias_generator=to_camel, populate_by_name=True
    )


class Provenance(_Strict):
    # "demo" drives the UI's permanent sample-data labelling. Only the analysis pipeline may
    # ever emit "analysis".
    kind: Literal["demo", "analysis"]
    repository: str = Field(min_length=1, max_length=200)
    note: str = Field(max_length=500)


class FileMetrics(_Strict):
    """Measured from the syntax tree. Absent from demo data, which has no real source."""

    total_lines: int = Field(ge=0)
    functions: int = Field(ge=0)
    classes: int = Field(ge=0)
    exports: int = Field(ge=0)
    # Files in this repository that this file imports.
    local_dependencies: int = Field(ge=0)
    # Files in this repository that import this file.
    incoming_dependencies: int = Field(ge=0)
    external_imports: int = Field(ge=0)
    unresolved_imports: int = Field(ge=0)
    # The parser recovered from a syntax error, so some constructs may be missing.
    parse_error: bool


class FileNode(_Strict):
    id: str = Field(min_length=1, max_length=1024)
    path: str = Field(min_length=1, max_length=1024)
    language: str = Field(min_length=1, max_length=40)
    # Lines with code, excluding blank and comment-only lines.
    loc: int = Field(ge=0)
    # File-level cyclomatic complexity.
    complexity: int = Field(ge=0)
    metrics: FileMetrics | None = None

    @field_validator("path")
    @classmethod
    def path_is_relative_and_clean(cls, value: str) -> str:
        parts = value.split("/")
        if value.startswith("/") or "\\" in value or any(p in {"", ".", ".."} for p in parts):
            raise ValueError("path must be a clean relative POSIX path")
        return value


class ImportEdge(_Strict):
    source: str
    target: str
    kind: Literal["import"] = "import"
    # Every import along this edge is `import type`, so it vanishes at runtime.
    type_only: bool | None = None


class RepositoryInfo(_Strict):
    owner: str
    name: str
    full_name: str
    url: str
    description: str | None = None
    default_branch: str
    commit_sha: str = Field(pattern=r"^[0-9a-f]{40}$")
    stars: int = Field(ge=0)
    forks: int = Field(ge=0)
    primary_language: str | None = None
    license: str | None = None
    archived: bool


class ExternalDependency(_Strict):
    name: str
    kind: Literal["package", "builtin"]
    # Files that import it.
    importers: int = Field(ge=0)


class UnresolvedImport(_Strict):
    source: str
    specifier: str
    line: int = Field(ge=1)
    reason: str


class DependencyCycle(_Strict):
    """A strongly connected set of files: each one reaches every other through imports."""

    files: list[str] = Field(min_length=1)
    # True when every edge in it is type-only, which can't cause runtime load-order problems.
    type_only: bool


class Hub(_Strict):
    id: str
    incoming: int = Field(ge=0)
    outgoing: int = Field(ge=0)


class AnalysisSummary(_Strict):
    repository: RepositoryInfo
    analyzer_version: str
    analyzed_at: str
    languages: dict[str, int]
    total_loc: int = Field(ge=0)
    external_dependencies: list[ExternalDependency]
    unresolved_imports: list[UnresolvedImport]
    # Lists are capped for size. These give the full counts.
    unresolved_import_count: int = Field(ge=0)
    cycles: list[DependencyCycle]
    cycle_count: int = Field(ge=0)
    hubs: list[Hub]
    # Files present but not analyzed, by reason.
    skipped_files: dict[str, int]
    files_with_parse_errors: int = Field(ge=0)


class CodeGraph(_Strict):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    provenance: Provenance
    files: list[FileNode]
    edges: list[ImportEdge]
    analysis: AnalysisSummary | None = None

    @model_validator(mode="after")
    def references_are_consistent(self) -> "CodeGraph":
        ids = [file.id for file in self.files]
        if len(ids) != len(set(ids)):
            raise ValueError("file ids must be unique")
        known = set(ids)
        for edge in self.edges:
            if edge.source not in known or edge.target not in known:
                raise ValueError(f"edge references unknown file: {edge.source} -> {edge.target}")
            if edge.source == edge.target:
                raise ValueError(f"self-import is not a valid edge: {edge.source}")
        if self.analysis is not None and self.provenance.kind != "analysis":
            raise ValueError("only analysis output may carry an analysis summary")
        return self
