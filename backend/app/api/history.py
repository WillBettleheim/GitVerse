"""Commit history and snapshot comparison for time travel."""

import time
from collections import OrderedDict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.analysis.diff import diff_graphs
from app.analysis.errors import AnalysisError
from app.analysis.github import MAX_COMMITS_PER_PAGE, GitHubClient
from app.analysis.jobs import JobManager
from app.core.ratelimit import SlidingWindowLimiter
from app.schemas.diff import SnapshotDiff
from app.services.repo_ref import InvalidRepoRef, RepoRef, parse_repo_ref

router = APIRouter(tags=["history"])

# Keeps history bounded: ten pages of thirty is the last 300 commits.
MAX_HISTORY_PAGES = 10
HISTORY_TTL_SECONDS = 300
SHA_PATTERN = r"^[0-9a-f]{40}$"

_ERROR_STATUS = {
    "repository_not_found": status.HTTP_404_NOT_FOUND,
    "repository_private": status.HTTP_403_FORBIDDEN,
    "github_rate_limited": status.HTTP_503_SERVICE_UNAVAILABLE,
    "github_unavailable": status.HTTP_502_BAD_GATEWAY,
}


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CommitView(_Camel):
    sha: str
    summary: str
    message: str
    author: str | None
    committed_at: str | None
    parents: list[str]


class HistoryView(_Camel):
    repository: str
    default_branch: str
    page: int
    per_page: int
    has_more: bool
    commits: list[CommitView]


class TtlCache[V]:
    def __init__(self, ttl: float, entries: int) -> None:
        self._ttl = ttl
        self._entries = entries
        self._items: OrderedDict[str, tuple[float, V]] = OrderedDict()

    def get(self, key: str) -> V | None:
        item = self._items.get(key)
        if item is None or time.monotonic() - item[0] > self._ttl:
            self._items.pop(key, None)
            return None
        return item[1]

    def put(self, key: str, value: V) -> None:
        self._items[key] = (time.monotonic(), value)
        self._items.move_to_end(key)
        while len(self._items) > self._entries:
            self._items.popitem(last=False)


def _ref(repository: str) -> RepoRef:
    try:
        return parse_repo_ref(repository)
    except InvalidRepoRef as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _limit(request: Request) -> JSONResponse | None:
    limiter: SlidingWindowLimiter = request.app.state.history_limiter
    retry_after = limiter.check(request.client.host if request.client else "unknown")
    if retry_after is None:
        return None
    return JSONResponse(
        {"detail": "Too many history requests. Wait a minute and try again."},
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={"Retry-After": str(int(retry_after))},
    )


def _github(request: Request) -> GitHubClient | None:
    github: GitHubClient | None = request.app.state.github
    return github


def _jobs(request: Request) -> JobManager:
    jobs: JobManager = request.app.state.jobs
    return jobs


@router.get("/api/v1/history")
async def history(
    request: Request,
    repository: Annotated[str, Query(max_length=300)],
    page: Annotated[int, Query(ge=1, le=MAX_HISTORY_PAGES)] = 1,
) -> Any:
    ref = _ref(repository)
    cache: TtlCache[dict[str, Any]] = request.app.state.history_cache
    key = f"{ref.full_name.lower()}#{page}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    if (limited := _limit(request)) is not None:
        return limited
    github = _github(request)
    if github is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "History isn't available here.")
    try:
        metadata = await github.get_repository(ref)
        commits, has_more = await github.list_commits(metadata, page)
    except AnalysisError as exc:
        raise HTTPException(
            _ERROR_STATUS.get(exc.code, status.HTTP_400_BAD_REQUEST), exc.message
        ) from exc

    view = HistoryView(
        repository=metadata.full_name,
        default_branch=metadata.default_branch,
        page=page,
        per_page=MAX_COMMITS_PER_PAGE,
        has_more=has_more and page < MAX_HISTORY_PAGES,
        commits=[
            CommitView(
                sha=c.sha,
                summary=c.summary,
                message=c.message,
                author=c.author,
                committed_at=c.committed_at,
                parents=list(c.parents),
            )
            for c in commits
        ],
    ).model_dump(mode="json", by_alias=True)
    cache.put(key, view)
    return view


@router.get("/api/v1/compare")
async def compare(
    request: Request,
    jobs: Annotated[JobManager, Depends(_jobs)],
    repository: Annotated[str, Query(max_length=300)],
    base: Annotated[str, Query(pattern=SHA_PATTERN)],
    head: Annotated[str, Query(pattern=SHA_PATTERN)],
) -> Any:
    """Differences between two commits that have both been analyzed."""
    ref = _ref(repository)
    diffs: TtlCache[dict[str, Any]] = request.app.state.diff_cache
    key = f"{ref.full_name.lower()}#{base}..{head}"
    cached = diffs.get(key)
    if cached is not None:
        return cached

    base_graph, head_graph = jobs.cached(ref, base), jobs.cached(ref, head)
    if base_graph is None or head_graph is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Analyze both commits before comparing them.")

    if (limited := _limit(request)) is not None:
        return limited
    renames, complete = await _github_renames(request, base_graph, head_graph)
    diff: SnapshotDiff = diff_graphs(base_graph, head_graph, renames, complete)
    view = diff.model_dump(mode="json", by_alias=True)
    diffs.put(key, view)
    return view


async def _github_renames(
    request: Request, base_graph: Any, head_graph: Any
) -> tuple[dict[str, str] | None, bool]:
    """GitHub's renames from base to head, or None when GitHub can't be asked."""
    github = _github(request)
    if github is None:
        return None, False
    base_info = base_graph.analysis.repository
    head_info = head_graph.analysis.repository
    # GitHub compares an older commit to a newer one. Going back in time, swap and invert.
    backwards = (
        base_info.committed_at is not None
        and head_info.committed_at is not None
        and base_info.committed_at > head_info.committed_at
    )
    older, newer = (head_info, base_info) if backwards else (base_info, head_info)
    try:
        result = await github.compare(head_info.full_name, older.commit_sha, newer.commit_sha)
    except AnalysisError:
        return None, False
    renames = {new: old for old, new in result.renames.items()} if backwards else result.renames
    return renames, not result.truncated
