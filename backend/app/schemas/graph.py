"""The CodeGraph contract shared with the frontend.

Mirrored by frontend/src/lib/graph/schema.ts. tests/test_graph_contract.py validates the
frontend's demo data against this model, so the two definitions cannot drift silently.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = 1


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Provenance(_Strict):
    # "demo" drives the UI's permanent sample-data labelling. Only the analysis pipeline may
    # ever emit "analysis".
    kind: Literal["demo", "analysis"]
    repository: str = Field(min_length=1, max_length=200)
    note: str = Field(max_length=500)


class FileNode(_Strict):
    id: str = Field(min_length=1, max_length=1024)
    path: str = Field(min_length=1, max_length=1024)
    language: str = Field(min_length=1, max_length=40)
    loc: int = Field(ge=0)
    complexity: int = Field(ge=0)

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


class CodeGraph(_Strict):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    provenance: Provenance
    files: list[FileNode]
    edges: list[ImportEdge]

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
        return self
