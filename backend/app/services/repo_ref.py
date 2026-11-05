"""Parse user-supplied repository references into a safe, canonical form.

This is the only path by which user input may reach `git clone`, so it allowlists rather
than sanitises: anything that isn't plainly a public GitHub owner/repo is rejected.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

# GitHub's own rules: alphanumeric or single hyphens, no leading or trailing hyphen, max 39.
_OWNER = re.compile(r"[A-Za-z0-9](?:-?[A-Za-z0-9])*")
_REPO = re.compile(r"[A-Za-z0-9._-]+")
_OWNER_MAX = 39
_REPO_MAX = 100
_INPUT_MAX = 300
_ALLOWED_HOSTS = {"github.com", "www.github.com"}


class InvalidRepoRef(ValueError):
    """The input is not an acceptable GitHub repository reference."""


@dataclass(frozen=True)
class RepoRef:
    owner: str
    name: str

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.name}"

    @property
    def clone_url(self) -> str:
        return f"https://github.com/{self.full_name}.git"


def parse_repo_ref(raw: str) -> RepoRef:
    """Accept `owner/repo` or `https://github.com/owner/repo[.git][/]`."""
    value = raw.strip()
    if not value or len(value) > _INPUT_MAX:
        raise InvalidRepoRef("Repository reference is empty or too long.")
    if any(ch.isspace() or ch == "\\" or ord(ch) < 0x20 for ch in value):
        raise InvalidRepoRef("Repository reference contains illegal characters.")

    path = _extract_url_path(value) if "://" in value else value
    if path.endswith("/") and "://" in value:
        path = path[:-1]

    segments = path.split("/")
    if len(segments) != 2:
        raise InvalidRepoRef("Expected exactly owner/repo.")

    owner, name = segments[0], segments[1].removesuffix(".git")
    _validate(owner, name)
    return RepoRef(owner=owner, name=name)


def _extract_url_path(value: str) -> str:
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise InvalidRepoRef("Malformed URL.") from exc

    if parts.scheme != "https":
        raise InvalidRepoRef("Only https:// URLs are accepted.")
    if parts.username is not None or parts.password is not None or port is not None:
        raise InvalidRepoRef("URLs may not contain credentials or a port.")
    if parts.hostname not in _ALLOWED_HOSTS:
        raise InvalidRepoRef("Only github.com repositories are supported.")
    if parts.query or parts.fragment:
        raise InvalidRepoRef("URLs may not contain a query or fragment.")
    return parts.path.removeprefix("/")


def _validate(owner: str, name: str) -> None:
    if len(owner) > _OWNER_MAX or not _OWNER.fullmatch(owner):
        raise InvalidRepoRef("Invalid GitHub owner.")
    if len(name) > _REPO_MAX or not _REPO.fullmatch(name):
        raise InvalidRepoRef("Invalid repository name.")
    # A leading dash would be read as an option by git; dot-names are path traversal.
    if name.startswith(("-", ".")):
        raise InvalidRepoRef("Invalid repository name.")
