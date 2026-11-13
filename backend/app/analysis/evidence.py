"""What AI Architect may quote: each analyzed file's declarations and import lines, and its source.

Saved alongside each analysis so questions never need GitHub, and never need to re-read an archive.

- The index lists, per file, its top-level symbols and its imports, each with the exact line it
  sits on, and where each import resolved to. It is keyed like the result cache.
- Source is stored by git blob SHA, so commits that share a file share one copy. Content is checked
  against its SHA every time it is read, so a quoted line is exactly what that commit contains.

Repository content is stored as inert bytes. Nothing here interprets or executes it.
"""

import hashlib
import json
import os
import re
import tempfile
from collections import OrderedDict
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.analysis.graph import ResolvedImport
from app.analysis.parser import ParsedFile, SymbolKind

_SHA = re.compile(r"^[0-9a-f]{40}$")
# Memory used when there's no cache directory, mainly in tests and throwaway servers.
DEFAULT_MEMORY_BYTES = 64 * 1024 * 1024


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SymbolEntry(_Model):
    name: str
    kind: SymbolKind
    line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    exported: bool


class ImportEntry(_Model):
    specifier: str
    line: int = Field(ge=1)
    kind: str
    # internal, external, builtin or unresolved
    resolution: str
    # The file it resolved to, for internal imports.
    target: str | None = None
    package: str | None = None


class FileEvidence(_Model):
    blob: str | None = None
    symbols: list[SymbolEntry] = Field(default_factory=list)
    imports: list[ImportEntry] = Field(default_factory=list)


class RepositoryIndex(_Model):
    commit_sha: str
    files: dict[str, FileEvidence]


def build_index(
    commit_sha: str,
    parsed: list[ParsedFile],
    imports: list[ResolvedImport],
    blobs: dict[str, str],
) -> RepositoryIndex:
    by_file: dict[str, list[ImportEntry]] = {p.path: [] for p in parsed}
    for item in imports:
        by_file.setdefault(item.source, []).append(
            ImportEntry(
                specifier=item.ref.specifier[:300],
                line=item.ref.line,
                kind=item.ref.kind,
                resolution=item.resolution.kind,
                target=item.resolution.target if item.resolution.kind == "internal" else None,
                package=item.resolution.package,
            )
        )
    files = {
        p.path: FileEvidence(
            blob=blobs.get(p.path),
            symbols=[
                SymbolEntry(
                    name=s.name, kind=s.kind, line=s.line, end_line=s.end_line, exported=s.exported
                )
                for s in p.symbols
            ],
            imports=sorted(by_file.get(p.path, []), key=lambda i: (i.line, i.specifier)),
        )
        for p in sorted(parsed, key=lambda p: p.path)
    }
    return RepositoryIndex(commit_sha=commit_sha, files=files)


def blob_sha(content: bytes) -> str:
    header = f"blob {len(content)}\0".encode()
    return hashlib.sha1(header + content, usedforsecurity=False).hexdigest()


class EvidenceStore:
    def __init__(
        self, directory: str | None, memory_bytes: int = DEFAULT_MEMORY_BYTES, indexes: int = 16
    ) -> None:
        self._directory = Path(directory) if directory else None
        self._indexes: OrderedDict[str, RepositoryIndex] = OrderedDict()
        self._index_entries = indexes
        # Only used without a directory.
        self._blobs: OrderedDict[str, bytes] = OrderedDict()
        self._blob_bytes = 0
        self._memory_bytes = memory_bytes

    def put(self, key: str, index: RepositoryIndex, sources: dict[str, bytes]) -> None:
        for content in sources.values():
            self._put_blob(content)
        self._remember(key, index)
        path = self._index_path(key)
        if path is not None:
            _write_atomic(path, index.model_dump_json().encode())

    def index(self, key: str) -> RepositoryIndex | None:
        if key in self._indexes:
            self._indexes.move_to_end(key)
            return self._indexes[key]
        path = self._index_path(key)
        if path is None or not path.is_file():
            return None
        try:
            index = RepositoryIndex.model_validate(json.loads(path.read_text("utf-8")))
        except (OSError, ValueError, ValidationError):
            return None
        self._remember(key, index)
        return index

    def source(self, blob: str) -> bytes | None:
        """The content with this blob SHA, or None. Never returns bytes that don't match it."""
        if not _SHA.match(blob):
            return None
        content: bytes | None
        if self._directory is None:
            content = self._blobs.get(blob)
        else:
            try:
                content = self._blob_path(blob).read_bytes()
            except OSError:
                return None
        if content is None or blob_sha(content) != blob:
            return None
        return content

    def _put_blob(self, content: bytes) -> None:
        sha = blob_sha(content)
        if self._directory is None:
            if sha in self._blobs:
                self._blobs.move_to_end(sha)
                return
            self._blobs[sha] = content
            self._blob_bytes += len(content)
            while self._blob_bytes > self._memory_bytes and self._blobs:
                _, dropped = self._blobs.popitem(last=False)
                self._blob_bytes -= len(dropped)
            return
        path = self._blob_path(sha)
        if not path.exists():
            _write_atomic(path, content)

    def _remember(self, key: str, index: RepositoryIndex) -> None:
        self._indexes[key] = index
        self._indexes.move_to_end(key)
        while len(self._indexes) > self._index_entries:
            self._indexes.popitem(last=False)

    def _index_path(self, key: str) -> Path | None:
        if self._directory is None:
            return None
        return self._directory / "index" / f"{hashlib.sha256(key.encode()).hexdigest()}.json"

    def _blob_path(self, sha: str) -> Path:
        if self._directory is None:
            raise RuntimeError("no evidence directory")
        # The name is a validated hex SHA, so it can't become any other path.
        return self._directory / "blobs" / sha[:2] / sha


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(payload)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
