"""Reads source files out of a repository tarball without extracting it.

Nothing is written to disk: entries are read straight from the archive into memory. Only regular
files count. Symlinks, hard links and devices are skipped, and any path that is absolute or climbs
out of the repository rejects the whole archive.
"""

import tarfile
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import IO

from app.analysis.errors import AnalysisError
from app.core.config import AnalysisLimits

SOURCE_EXTENSIONS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
DECLARATION_SUFFIXES = (".d.ts", ".d.mts", ".d.cts")
CONFIG_NAMES = {"tsconfig.json", "jsconfig.json"}
# Third-party, generated or build output. Analyzing these would describe the tools, not the code.
IGNORED_DIRECTORIES = {
    "node_modules",
    "bower_components",
    "jspm_packages",
    "vendor",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".output",
    ".git",
    ".yarn",
    ".turbo",
    ".cache",
}
_MAX_CONFIG_BYTES = 256 * 1024
# A real source line is rarely this long. Minified bundles always have one.
_MINIFIED_LINE = 2_000


@dataclass
class SourceSnapshot:
    files: dict[str, bytes] = field(default_factory=dict)
    configs: dict[str, bytes] = field(default_factory=dict)
    # Every regular file in the repository, for resolving imports of non-source files.
    all_paths: set[str] = field(default_factory=set)
    # Source files that exist but weren't analyzed, so imports of them aren't called unresolved.
    skipped_paths: set[str] = field(default_factory=set)
    skipped: Counter[str] = field(default_factory=Counter)


def read_snapshot(
    archive: IO[bytes], limits: AnalysisLimits, deadline: float | None = None
) -> SourceSnapshot:
    snapshot = SourceSnapshot()
    max_file = limits.max_file_size_kb * 1024
    max_total = limits.max_total_source_mb * 1024 * 1024
    max_unpacked = limits.max_unpacked_mb * 1024 * 1024
    total_source = 0
    unpacked = 0
    entries = 0

    try:
        tar = tarfile.open(fileobj=archive, mode="r:gz")
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise AnalysisError("unsafe_archive", "The repository archive couldn't be read.") from exc

    with tar:
        try:
            while (member := tar.next()) is not None:
                entries += 1
                if entries > limits.max_files:
                    raise AnalysisError(
                        "too_many_files",
                        f"The repository has more than {limits.max_files:,} files.",
                    )
                if deadline is not None and time.monotonic() > deadline:
                    raise AnalysisError("timeout", "Reading the repository took too long.")

                unpacked += max(member.size, 0)
                if unpacked > max_unpacked:
                    raise AnalysisError(
                        "too_large",
                        f"The repository unpacks to more than {limits.max_unpacked_mb} MB.",
                    )

                path = _repository_path(member.name)
                if path is None or not member.isreg():
                    # Directories, links and devices carry no source. Links are never followed.
                    continue
                snapshot.all_paths.add(path)

                if _ignored(path):
                    if path.endswith(SOURCE_EXTENSIONS):
                        snapshot.skipped["vendored_or_generated"] += 1
                        snapshot.skipped_paths.add(path)
                    continue

                name = PurePosixPath(path).name
                if name in CONFIG_NAMES and member.size <= _MAX_CONFIG_BYTES:
                    snapshot.configs[path] = _read(tar, member, _MAX_CONFIG_BYTES)
                    continue
                if not path.endswith(SOURCE_EXTENSIONS):
                    continue
                if path.endswith(DECLARATION_SUFFIXES):
                    snapshot.skipped["declaration_file"] += 1
                    snapshot.skipped_paths.add(path)
                    continue
                if name.endswith((".min.js", ".min.mjs", ".min.cjs")):
                    snapshot.skipped["minified"] += 1
                    snapshot.skipped_paths.add(path)
                    continue
                if member.size > max_file:
                    snapshot.skipped["too_large"] += 1
                    snapshot.skipped_paths.add(path)
                    continue

                if len(snapshot.files) >= limits.max_source_files:
                    raise AnalysisError(
                        "too_many_files",
                        f"The repository has more than {limits.max_source_files:,} "
                        "JavaScript or TypeScript files, which is over the analysis limit.",
                    )
                total_source += member.size
                if total_source > max_total:
                    raise AnalysisError(
                        "too_large",
                        f"The repository has more than {limits.max_total_source_mb} MB of source.",
                    )

                content = _read(tar, member, max_file)
                if _looks_minified(content):
                    snapshot.skipped["minified"] += 1
                    snapshot.skipped_paths.add(path)
                    continue
                snapshot.files[path] = content
        except AnalysisError:
            raise
        except (tarfile.TarError, OSError, EOFError) as exc:
            raise AnalysisError(
                "unsafe_archive", "The repository archive is damaged or unreadable."
            ) from exc

    return snapshot


def _repository_path(name: str) -> str | None:
    """Drops GitHub's top-level folder and rejects anything that could escape the repository."""
    if "\\" in name or "\x00" in name:
        raise AnalysisError("unsafe_archive", "The archive contains an invalid file path.")
    if name.startswith("/"):
        raise AnalysisError("unsafe_archive", "The archive contains an absolute file path.")
    parts = [part for part in name.split("/") if part not in ("", ".")]
    if ".." in parts:
        raise AnalysisError("unsafe_archive", "The archive contains a path outside the repository.")
    # GitHub archives nest everything under one "owner-repo-sha" folder.
    if len(parts) < 2:
        return None
    return "/".join(parts[1:])


def _ignored(path: str) -> bool:
    return any(part in IGNORED_DIRECTORIES for part in path.split("/")[:-1])


def _read(tar: tarfile.TarFile, member: tarfile.TarInfo, limit: int) -> bytes:
    handle = tar.extractfile(member)
    if handle is None:
        return b""
    with handle:
        return handle.read(limit)


def _looks_minified(content: bytes) -> bool:
    return any(len(line) > _MINIFIED_LINE for line in content.split(b"\n", 50)[:50])
