"""A deliberately narrow GitHub client.

It talks to exactly two hosts, api.github.com and codeload.github.com, builds every URL from a
validated owner, name and commit SHA, and never follows redirects, so user input can't steer a
request anywhere else.
"""

import re
from dataclasses import dataclass
from tempfile import SpooledTemporaryFile
from typing import IO, Any

import httpx

from app.analysis.errors import AnalysisError
from app.services.repo_ref import InvalidRepoRef, RepoRef, parse_repo_ref

API_BASE = "https://api.github.com"
ARCHIVE_BASE = "https://codeload.github.com"
_SHA = re.compile(r"[0-9a-f]{40}")
_CHUNK = 64 * 1024
# Archives spill from memory to an anonymous temporary file above this size.
_SPOOL_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class RepositoryMetadata:
    owner: str
    name: str
    full_name: str
    url: str
    description: str | None
    default_branch: str
    stars: int
    forks: int
    primary_language: str | None
    license: str | None
    size_kb: int
    archived: bool


class GitHubClient:
    def __init__(self, http: httpx.AsyncClient, token: str | None = None) -> None:
        self._http = http
        self._headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "GitVerse-Analyzer",
        }
        if token:
            self._headers["Authorization"] = f"Bearer {token}"

    async def get_repository(self, ref: RepoRef) -> RepositoryMetadata:
        response = await self._get(f"{API_BASE}/repos/{ref.owner}/{ref.name}")
        data: dict[str, Any] = response.json()
        if data.get("private") or data.get("visibility", "public") != "public":
            raise AnalysisError("repository_private", "Only public repositories can be analyzed.")

        # GitHub's canonical spelling, revalidated, so the cache key and URLs never take raw data.
        try:
            canonical = parse_repo_ref(str(data.get("full_name", "")))
        except InvalidRepoRef as exc:
            raise AnalysisError("github_unavailable", "GitHub returned unexpected data.") from exc

        license_info = data.get("license") or {}
        return RepositoryMetadata(
            owner=canonical.owner,
            name=canonical.name,
            full_name=canonical.full_name,
            url=f"https://github.com/{canonical.full_name}",
            description=_text(data.get("description"), 300),
            default_branch=str(data.get("default_branch") or ""),
            stars=_count(data.get("stargazers_count")),
            forks=_count(data.get("forks_count")),
            primary_language=_text(data.get("language"), 40),
            license=_text(license_info.get("spdx_id"), 40),
            size_kb=_count(data.get("size")),
            archived=bool(data.get("archived")),
        )

    async def resolve_commit(self, metadata: RepositoryMetadata) -> str:
        """The SHA the default branch points at now, which pins everything after it."""
        if not metadata.default_branch:
            raise AnalysisError("repository_empty", "This repository has no commits to analyze.")
        response = await self._get(
            f"{API_BASE}/repos/{metadata.full_name}/commits/{metadata.default_branch}",
            accept="application/vnd.github.sha",
        )
        sha = response.text.strip()
        if not _SHA.fullmatch(sha):
            raise AnalysisError("github_unavailable", "GitHub returned an unexpected commit ID.")
        return sha

    async def download_archive(
        self, metadata: RepositoryMetadata, sha: str, max_bytes: int
    ) -> IO[bytes]:
        """Streams the tarball for one commit, stopping as soon as it passes the size limit."""
        if not _SHA.fullmatch(sha):
            raise AnalysisError("internal_error", "Invalid commit ID.")
        url = f"{ARCHIVE_BASE}/{metadata.full_name}/tar.gz/{sha}"
        buffer: IO[bytes] = SpooledTemporaryFile(max_size=_SPOOL_BYTES)
        try:
            async with self._http.stream(
                "GET", url, headers={"User-Agent": self._headers["User-Agent"]}
            ) as response:
                self._check(response)
                declared = response.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > max_bytes:
                    raise _too_large(max_bytes)
                received = 0
                async for chunk in response.aiter_bytes(_CHUNK):
                    received += len(chunk)
                    if received > max_bytes:
                        raise _too_large(max_bytes)
                    buffer.write(chunk)
        except BaseException:
            buffer.close()
            raise
        buffer.seek(0)
        return buffer

    async def _get(self, url: str, accept: str | None = None) -> httpx.Response:
        headers = dict(self._headers)
        if accept:
            headers["Accept"] = accept
        try:
            response = await self._http.get(url, headers=headers)
        except httpx.TimeoutException as exc:
            raise AnalysisError("github_unavailable", "GitHub took too long to respond.") from exc
        except httpx.HTTPError as exc:
            raise AnalysisError("github_unavailable", "Couldn't reach GitHub.") from exc
        self._check(response)
        return response

    @staticmethod
    def _check(response: httpx.Response) -> None:
        status = response.status_code
        if status == 200:
            return
        if 300 <= status < 400:
            # Renamed or transferred repositories redirect. Following that would mean trusting a
            # Location header, so the user gets the reason instead.
            raise AnalysisError(
                "repository_moved",
                "This repository has moved or been renamed. Use its current GitHub address.",
            )
        if status == 404:
            raise AnalysisError(
                "repository_not_found", "Repository not found. Check the name and that it's public."
            )
        if status == 409:
            raise AnalysisError("repository_empty", "This repository has no commits to analyze.")
        if status in (403, 429) and (
            response.headers.get("x-ratelimit-remaining") == "0" or status == 429
        ):
            raise AnalysisError(
                "github_rate_limited",
                "GitHub's rate limit for this server has been reached. Try again later.",
            )
        if status in (401, 403, 451):
            raise AnalysisError("repository_private", "GitHub refused access to this repository.")
        raise AnalysisError("github_unavailable", f"GitHub returned an error ({status}).")


def _too_large(max_bytes: int) -> AnalysisError:
    return AnalysisError(
        "too_large",
        f"The repository archive is larger than the {max_bytes // (1024 * 1024)} MB limit.",
    )


def _text(value: object, limit: int) -> str | None:
    return str(value)[:limit] if isinstance(value, str) and value else None


def _count(value: object) -> int:
    return value if isinstance(value, int) and value >= 0 else 0
