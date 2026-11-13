"""Finished analyses keyed by repository, commit SHA and analyzer version.

A commit's contents never change, so a result for one stays valid until the analyzer itself
changes, which ANALYZER_VERSION captures.
"""

import hashlib
import json
import os
import tempfile
from collections import OrderedDict
from pathlib import Path

from pydantic import ValidationError

from app.analysis import ANALYZER_VERSION
from app.schemas.graph import CodeGraph


def cache_key(full_name: str, sha: str) -> str:
    return f"github:{full_name.lower()}@{sha}:v{ANALYZER_VERSION}"


class ResultCache:
    def __init__(self, directory: str | None, memory_entries: int = 16) -> None:
        self._directory = Path(directory) if directory else None
        self._memory: OrderedDict[str, CodeGraph] = OrderedDict()
        self._memory_entries = memory_entries

    def get(self, key: str) -> CodeGraph | None:
        if key in self._memory:
            self._memory.move_to_end(key)
            return self._memory[key]
        path = self._path(key)
        if path is None or not path.is_file():
            return None
        try:
            graph = CodeGraph.model_validate(json.loads(path.read_text("utf-8")))
        except (OSError, ValueError, ValidationError):
            # A damaged or outdated entry is just a miss.
            return None
        self._remember(key, graph)
        return graph

    def put(self, key: str, graph: CodeGraph) -> None:
        self._remember(key, graph)
        path = self._path(key)
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = graph.model_dump_json(by_alias=True, exclude_none=True)
        # Written then renamed, so a crash can't leave a half-written entry behind.
        handle, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as file:
                file.write(payload)
            os.replace(temporary, path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise

    def _remember(self, key: str, graph: CodeGraph) -> None:
        self._memory[key] = graph
        self._memory.move_to_end(key)
        while len(self._memory) > self._memory_entries:
            self._memory.popitem(last=False)

    def _path(self, key: str) -> Path | None:
        if self._directory is None:
            return None
        # Hashed, so no part of the key ever becomes a path segment.
        return self._directory / f"{hashlib.sha256(key.encode()).hexdigest()}.json"
