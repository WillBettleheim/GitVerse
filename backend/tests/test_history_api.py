"""History, commit snapshots, comparison and cancellation over HTTP."""

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.analysis.github import GitHubClient
from app.analysis.pipeline import Pipeline, Progress, ProgressCallback
from app.core.config import Settings
from app.main import create_app
from app.schemas.graph import CodeGraph, RepositoryInfo
from app.services.repo_ref import RepoRef
from tests.git_fixture import GIT, LIMITS, GitFixture, build_history

pytestmark = pytest.mark.skipif(GIT is None, reason="git isn't installed")


class GitPipeline(Pipeline):
    """Serves real snapshots of the fixture repository in place of GitHub."""

    def __init__(self, repo: GitFixture, delay: float = 0) -> None:
        super().__init__(github=None, limits=LIMITS)  # type: ignore[arg-type]
        self.repo = repo
        self.delay = delay
        self.identified: list[str | None] = []
        self.analyzed: list[str] = []

    async def identify(self, ref: RepoRef, commit: str | None = None) -> RepositoryInfo:
        self.identified.append(commit)
        target = next(
            c for c in self.repo.commits if c.sha == (commit or self.repo.commits[-1].sha)
        )
        return RepositoryInfo(
            owner="acme",
            name="repo",
            full_name="acme/repo",
            url="https://github.com/acme/repo",
            default_branch="main",
            commit_sha=target.sha,
            committed_at=target.date,
            commit_message=target.message,
            stars=0,
            forks=0,
            archived=False,
        )

    async def analyze(
        self, repository: RepositoryInfo, deadline: float, on_progress: ProgressCallback
    ) -> CodeGraph:
        self.analyzed.append(repository.commit_sha)
        on_progress(Progress(stage="downloading"))
        await asyncio.sleep(self.delay)
        commit = next(c for c in self.repo.commits if c.sha == repository.commit_sha)
        return self.repo.analyze(commit)


@pytest.fixture(scope="module")
def repo(tmp_path_factory: pytest.TempPathFactory) -> GitFixture:
    return build_history(Path(tmp_path_factory.mktemp("api-history")))


def client_for(pipeline: Pipeline, **settings: Any) -> TestClient:
    settings.setdefault("cache_dir", "")
    config = Settings(_env_file=None, **settings)  # type: ignore[call-arg]
    return TestClient(create_app(config, LIMITS, pipeline))


def analyze(client: TestClient, commit: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {"repository": "acme/repo"}
    if commit:
        body["commit"] = commit
    job: dict[str, Any] = client.post("/api/v1/analyses", json=body).json()
    end = time.monotonic() + 10
    while job["status"] not in ("complete", "failed") and time.monotonic() < end:
        time.sleep(0.02)
        job = client.get(f"/api/v1/analyses/{job['id']}").json()
    return job


def test_analyzes_a_specific_historical_commit(repo: GitFixture) -> None:
    pipeline = GitPipeline(repo)
    with client_for(pipeline) as client:
        job = analyze(client, repo.commits[1].sha)
        graph = client.get(f"/api/v1/analyses/{job['id']}/graph").json()
    assert job["commit"] == repo.commits[1].sha
    assert job["repository"]["commitSha"] == repo.commits[1].sha
    assert job["repository"]["commitMessage"] == "Add c and use util in b"
    assert sorted(f["path"] for f in graph["files"]) == [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/util.ts",
    ]
    assert all(len(f["blob"]) == 40 for f in graph["files"])


def test_returns_cached_commits_without_asking_github_or_counting_against_limits(
    repo: GitFixture,
) -> None:
    pipeline = GitPipeline(repo)
    with client_for(pipeline, analysis_requests_per_minute=1) as client:
        first = analyze(client, repo.commits[0].sha)
        again = client.post(
            "/api/v1/analyses", json={"repository": "acme/repo", "commit": repo.commits[0].sha}
        )
        assert again.status_code == 202
        assert again.json()["status"] == "complete"
        assert again.json()["cached"] is True
    assert first["status"] == "complete"
    assert pipeline.identified == [repo.commits[0].sha]


@pytest.mark.parametrize("commit", ["main", "abc123", "../x", "Z" * 40])
def test_requires_a_full_commit_sha(repo: GitFixture, commit: str) -> None:
    with client_for(GitPipeline(repo)) as client:
        response = client.post(
            "/api/v1/analyses", json={"repository": "acme/repo", "commit": commit}
        )
    assert response.status_code == 422


def test_treats_different_commits_as_different_jobs(repo: GitFixture) -> None:
    with client_for(GitPipeline(repo, delay=0.3)) as client:
        first = client.post(
            "/api/v1/analyses", json={"repository": "acme/repo", "commit": repo.commits[0].sha}
        ).json()
        second = client.post(
            "/api/v1/analyses", json={"repository": "acme/repo", "commit": repo.commits[1].sha}
        ).json()
        same = client.post(
            "/api/v1/analyses", json={"repository": "acme/repo", "commit": repo.commits[0].sha}
        ).json()
    assert first["id"] != second["id"]
    assert first["id"] == same["id"]


def test_compares_two_analyzed_commits(repo: GitFixture) -> None:
    with client_for(GitPipeline(repo)) as client:
        base, head = repo.commits[1].sha, repo.commits[2].sha
        missing = client.get(
            "/api/v1/compare", params={"repository": "acme/repo", "base": base, "head": head}
        )
        assert missing.status_code == 409

        analyze(client, base)
        analyze(client, head)
        diff = client.get(
            "/api/v1/compare", params={"repository": "acme/repo", "base": base, "head": head}
        ).json()
    assert diff["base"]["sha"] == base
    assert diff["head"]["message"] == "Move util to helpers and drop c"
    assert diff["files"]["removed"] == ["src/c.ts"]
    assert diff["files"]["renamed"] == [
        {"from": "src/util.ts", "to": "src/helpers.ts", "contentChanged": False}
    ]
    assert diff["edges"]["removed"] == [{"source": "src/c.ts", "target": "src/a.ts"}]
    # Without GitHub, only identical-content moves are found, and the response says so.
    assert diff["renameDetection"]["method"] == "content"
    assert diff["renameDetection"]["complete"] is False


@pytest.mark.parametrize(
    "params",
    [
        {"repository": "acme/repo", "base": "main", "head": "e" * 40},
        {"repository": "../etc", "base": "e" * 40, "head": "e" * 40},
    ],
)
def test_compare_validates_its_inputs(repo: GitFixture, params: dict[str, str]) -> None:
    with client_for(GitPipeline(repo)) as client:
        assert client.get("/api/v1/compare", params=params).status_code == 422


def test_cancels_a_queued_analysis_but_not_a_running_one(repo: GitFixture) -> None:
    pipeline = GitPipeline(repo, delay=1.5)
    with client_for(pipeline, max_concurrent_analyses=1) as client:
        running = client.post(
            "/api/v1/analyses", json={"repository": "acme/repo", "commit": repo.commits[0].sha}
        ).json()
        queued = client.post(
            "/api/v1/analyses", json={"repository": "acme/repo", "commit": repo.commits[1].sha}
        ).json()
        time.sleep(0.1)

        cancelled = client.delete(f"/api/v1/analyses/{queued['id']}")
        refused = client.delete(f"/api/v1/analyses/{running['id']}")
        after = client.get(f"/api/v1/analyses/{queued['id']}").json()
    assert cancelled.status_code == 200
    assert after["status"] == "failed"
    assert after["error"]["code"] == "cancelled"
    assert refused.status_code == 409
    assert repo.commits[1].sha not in pipeline.analyzed


def test_history_needs_github(repo: GitFixture) -> None:
    with client_for(GitPipeline(repo)) as client:
        assert client.get("/api/v1/history", params={"repository": "acme/repo"}).status_code == 503


def github_app(handler: Any, **settings: Any) -> TestClient:
    transport = httpx.MockTransport(handler)
    http = httpx.AsyncClient(transport=transport, follow_redirects=False)
    return client_for(Pipeline(GitHubClient(http), LIMITS), **settings)


REPO_JSON = {
    "full_name": "acme/repo",
    "private": False,
    "visibility": "public",
    "default_branch": "main",
}


def commit_json(index: int) -> dict[str, Any]:
    return {
        "sha": f"{index:040x}",
        "commit": {
            "message": f"Commit {index}\n\nDetails",
            "author": {"name": "Ada"},
            "committer": {"date": f"2024-01-{index + 1:02d}T00:00:00Z"},
        },
        "parents": [],
    }


def test_history_lists_commits_and_caches_pages() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/repos/acme/repo":
            return httpx.Response(200, json=REPO_JSON)
        return httpx.Response(
            200,
            json=[commit_json(i) for i in range(3)],
            headers={"link": '<https://api.github.com/x?page=2>; rel="next"'},
        )

    with github_app(handler) as client:
        first = client.get("/api/v1/history", params={"repository": "acme/repo"}).json()
        again = client.get("/api/v1/history", params={"repository": "ACME/repo"}).json()
    assert first == again
    assert calls == ["/repos/acme/repo", "/repos/acme/repo/commits"]
    assert first["hasMore"] is True
    assert first["perPage"] == 30
    assert first["commits"][0] == {
        "sha": f"{0:040x}",
        "summary": "Commit 0",
        "message": "Commit 0\n\nDetails",
        "author": "Ada",
        "committedAt": "2024-01-01T00:00:00Z",
        "parents": [],
    }


@pytest.mark.parametrize("page", ["0", "11", "x"])
def test_history_is_bounded(page: str) -> None:
    with github_app(lambda _: httpx.Response(500)) as client:
        response = client.get("/api/v1/history", params={"repository": "acme/repo", "page": page})
    assert response.status_code == 422


def test_history_reports_github_errors_safely() -> None:
    with github_app(lambda _: httpx.Response(404)) as client:
        response = client.get("/api/v1/history", params={"repository": "acme/missing"})
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_history_is_rate_limited() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/repos/acme/repo":
            return httpx.Response(200, json=REPO_JSON)
        return httpx.Response(200, json=[])

    with github_app(handler, history_requests_per_minute=1) as client:
        ok = client.get("/api/v1/history", params={"repository": "acme/repo", "page": 1})
        limited = client.get("/api/v1/history", params={"repository": "acme/repo", "page": 2})
    assert ok.status_code == 200
    assert limited.status_code == 429
