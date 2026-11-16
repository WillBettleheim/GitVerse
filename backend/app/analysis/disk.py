"""Keeps a cache directory within a size budget.

Anyone can ask for analyses, so caches written to disk must not grow without limit. When a
directory passes its budget, the least recently used files are removed until it is back under
90% of it. Reads refresh a file's modification time, so what's in use stays.
"""

import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Scanning a large directory isn't free, so a prune runs at most this often.
MIN_SECONDS_BETWEEN_PRUNES = 30.0


def touch(path: Path) -> None:
    """Marks a file as recently used. Failing to is harmless."""
    try:
        os.utime(path)
    except OSError:
        pass


class DiskBudget:
    def __init__(self, directory: Path, max_bytes: int) -> None:
        self._directory = directory
        self._max_bytes = max_bytes
        self._last_prune = float("-inf")

    def maybe_prune(self, force: bool = False) -> int:
        """Prunes if due. Returns the number of files removed."""
        now = time.monotonic()
        if not force and now - self._last_prune < MIN_SECONDS_BETWEEN_PRUNES:
            return 0
        self._last_prune = now
        return prune(self._directory, self._max_bytes)


def prune(directory: Path, max_bytes: int) -> int:
    files: list[tuple[float, int, Path]] = []
    total = 0
    for root, _, names in os.walk(directory):
        for name in names:
            path = Path(root) / name
            try:
                info = path.stat()
            except OSError:
                continue
            files.append((info.st_mtime, info.st_size, path))
            total += info.st_size
    if total <= max_bytes:
        return 0
    target = int(max_bytes * 0.9)
    removed = 0
    for _, size, path in sorted(files):
        if total <= target:
            break
        try:
            path.unlink()
        except OSError:
            continue
        total -= size
        removed += 1
    logger.info("Pruned %d cached files from %s to stay within its size limit", removed, directory)
    return removed
