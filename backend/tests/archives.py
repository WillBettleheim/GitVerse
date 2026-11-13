"""Builds GitHub-style tarballs in memory, from fixture folders or hand-crafted entries."""

import io
import tarfile
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures" / "repos"
PREFIX = "acme-web-app-0123456"


def tarball_from_directory(name: str) -> io.BytesIO:
    root = FIXTURES / name
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        top = tarfile.TarInfo(PREFIX)
        top.type = tarfile.DIRTYPE
        tar.addfile(top)
        for path in sorted(root.rglob("*")):
            if path.is_file():
                tar.add(path, arcname=f"{PREFIX}/{path.relative_to(root).as_posix()}")
    buffer.seek(0)
    return buffer


def tarball_from_entries(entries: list[tarfile.TarInfo | tuple[str, bytes]]) -> io.BytesIO:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for entry in entries:
            if isinstance(entry, tarfile.TarInfo):
                tar.addfile(entry)
            else:
                name, content = entry
                info = tarfile.TarInfo(name)
                info.size = len(content)
                tar.addfile(info, io.BytesIO(content))
    buffer.seek(0)
    return buffer
