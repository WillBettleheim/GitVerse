"""What changed between two analyzed commits. Mirrored by frontend/src/lib/timetravel/diff.ts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class CommitRef(_Model):
    sha: str = Field(pattern=r"^[0-9a-f]{40}$")
    committed_at: str | None = None
    message: str | None = None
    author: str | None = None


class FileMeasures(_Model):
    loc: int
    complexity: int
    incoming: int
    outgoing: int


class ModifiedFile(_Model):
    path: str
    before: FileMeasures
    after: FileMeasures


class RenamedFile(_Model):
    old_path: str = Field(alias="from")
    new_path: str = Field(alias="to")
    # False for a pure move, where the content is byte-for-byte identical.
    content_changed: bool


class FileChanges(_Model):
    added: list[str]
    removed: list[str]
    modified: list[ModifiedFile]
    renamed: list[RenamedFile]
    unchanged: int
    # Full counts. The lists above are capped for size.
    added_count: int
    removed_count: int
    modified_count: int
    renamed_count: int


class EdgeRef(_Model):
    source: str
    target: str


class EdgeChanges(_Model):
    # In the head commit's paths.
    added: list[EdgeRef]
    # In the base commit's paths, since one or both ends may no longer exist.
    removed: list[EdgeRef]
    unchanged: int
    added_count: int
    removed_count: int


class MetricChange(_Model):
    name: str
    label: str
    before: float
    after: float
    delta: float


class RenameDetection(_Model):
    method: Literal["github", "content", "github+content"]
    # False when GitHub's file list was cut off, or GitHub couldn't be asked.
    complete: bool
    note: str


class SnapshotDiff(_Model):
    repository: str
    base: CommitRef
    head: CommitRef
    files: FileChanges
    edges: EdgeChanges
    metrics: list[MetricChange]
    rename_detection: RenameDetection
