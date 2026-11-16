"""Parses source files in worker processes.

Parsing is pure Python walking Tree-sitter's syntax tree, so in a thread it holds the interpreter
lock: one core does all the work, and the server's event loop waits behind it. Worker processes
use more cores and leave the API process free to answer other requests.

Workers only ever receive file contents as bytes and return plain data. They parse text with
Tree-sitter, exactly as the API process would; nothing from a repository is executed.
"""

import logging
import math
import os
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

from app.analysis.errors import AnalysisError
from app.analysis.parser import ParsedFile, parse_source

logger = logging.getLogger(__name__)

# Below this, starting work in other processes costs more than it saves.
MIN_FILES_FOR_WORKERS = 150
# Enough chunks per worker to balance uneven files, few enough to keep overhead low.
CHUNKS_PER_WORKER = 4
MIN_CHUNK = 25


def default_workers() -> int:
    return max(1, min(4, (os.cpu_count() or 2) - 1))


def _parse_chunk(items: list[tuple[str, bytes]]) -> list[ParsedFile]:
    return [parse_source(path, content) for path, content in items]


def parse_sequentially(
    files: dict[str, bytes],
    deadline: float | None,
    on_parsed: Callable[[int], None] | None = None,
) -> list[ParsedFile]:
    parsed: list[ParsedFile] = []
    for path in sorted(files):
        if deadline is not None and time.monotonic() > deadline:
            raise AnalysisError("timeout", "Parsing the repository took too long.")
        parsed.append(parse_source(path, files[path]))
        if on_parsed and len(parsed) % 25 == 0:
            on_parsed(len(parsed))
    return parsed


class ParserPool:
    """A lazily started, shared pool of parser processes. Safe to use from several threads."""

    def __init__(self, workers: int | None = None) -> None:
        self._workers = workers if workers is not None else default_workers()
        self._executor: ProcessPoolExecutor | None = None
        self._lock = threading.Lock()

    @property
    def workers(self) -> int:
        return self._workers

    def _pool(self) -> ProcessPoolExecutor:
        with self._lock:
            if self._executor is None:
                self._executor = ProcessPoolExecutor(max_workers=self._workers)
            return self._executor

    def parse(
        self,
        files: dict[str, bytes],
        deadline: float | None,
        on_parsed: Callable[[int], None] | None = None,
    ) -> list[ParsedFile]:
        """Parsed files in path order, the same result as parsing them one by one."""
        if self._workers <= 1 or len(files) < MIN_FILES_FOR_WORKERS:
            return parse_sequentially(files, deadline, on_parsed)
        paths = sorted(files)
        size = max(MIN_CHUNK, math.ceil(len(paths) / (self._workers * CHUNKS_PER_WORKER)))
        chunks = [paths[i : i + size] for i in range(0, len(paths), size)]
        try:
            pool = self._pool()
            futures = [
                pool.submit(_parse_chunk, [(p, files[p]) for p in chunk]) for chunk in chunks
            ]
        except (BrokenProcessPool, RuntimeError):
            self._reset()
            logger.warning("Parser workers unavailable; parsing in-process instead")
            return parse_sequentially(files, deadline, on_parsed)

        parsed: list[ParsedFile] = []
        try:
            for future in futures:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    raise AnalysisError("timeout", "Parsing the repository took too long.")
                try:
                    parsed.extend(future.result(timeout=remaining))
                except TimeoutError as exc:
                    raise AnalysisError("timeout", "Parsing the repository took too long.") from exc
                if on_parsed:
                    on_parsed(len(parsed))
        except BrokenProcessPool:
            # A worker died, perhaps on a pathological file. Retry here so the analysis still
            # completes, and start fresh workers next time.
            _cancel(futures)
            self._reset()
            logger.warning("A parser worker failed; parsing in-process instead")
            return parse_sequentially(files, deadline, on_parsed)
        except BaseException:
            _cancel(futures)
            raise
        return parsed

    def _reset(self) -> None:
        with self._lock:
            executor, self._executor = self._executor, None
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)

    def shutdown(self) -> None:
        with self._lock:
            executor, self._executor = self._executor, None
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)


def _cancel(futures: list[Future[list[ParsedFile]]]) -> None:
    for future in futures:
        future.cancel()
