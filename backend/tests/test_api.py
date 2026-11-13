import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.analysis.archive import read_snapshot
from app.analysis.errors import AnalysisError
from app.analysis.pipeline import Pipeline, Progress, ProgressCallback, analyze_snapshot
from app.core.config import AnalysisLimits, Settings
from app.main import create_app
from app.schemas.graph import CodeGraph, RepositoryInfo
from app.services.repo_ref import RepoRef
from tests.archives import tarball_from_directory

SHA = "0123456789abcdef0123456789abcdef01234567"
LIMITS = AnalysisLimits(_env_file=None)  # type: ignore[call-arg]


class FakePipeline(Pipeline):
    """Real parsing of a fixture repository, with GitHub replaced."""

    def __init__(self, fail: AnalysisError | Exception | None = None, delay: float = 0) -> None:
        super().__init__(github=None, limits=LIMITS)  # type: ignore[arg-type]
        self.fail = fail
        self.delay = delay
        self.identified = 0
        self.analyzed = 0

    async def identify(self, ref: RepoRef) -> RepositoryInfo:
        self.identified += 1
        if isinstance(self.fail, AnalysisError) and self.fail.code == "repository_not_found":
            raise self.fail
        return RepositoryInfo(
            owner=ref.owner,
            name=ref.name,
            full_name=ref.full_name,
            url=f"https://github.com/{ref.full_name}",
            default_branch="main",
            commit_sha=SHA,
            stars=1,
            forks=0,
            archived=False,
        )

    async def analyze(
        self, repository: RepositoryInfo, deadline: float, on_progress: ProgressCallback
    ) -> CodeGraph:
        import asyncio

        self.analyzed += 1
        on_progress(Progress(stage="downloading"))
        await asyncio.sleep(self.delay)
        if self.fail is not None:
            raise self.fail
        snapshot = read_snapshot(tarball_from_directory("web-app"), LIMITS)
        return analyze_snapshot(repository, snapshot, deadline, on_progress)


def make_client(pipeline: Pipeline | None = None, **settings: Any) -> TestClient:
    settings.setdefault("cache_dir", "")
    config = Settings(
        _env_file=None,  # type: ignore[call-arg]
        cors_origins="http://localhost:3000,https://gitverse.example",
        max_request_body_bytes=512,
        **settings,
    )
    return TestClient(create_app(config, LIMITS, pipeline or FakePipeline()))


@pytest.fixture
def client() -> Iterator[TestClient]:
    with make_client() as c:
        yield c


def wait_for(client: TestClient, job_id: str, timeout: float = 10) -> dict[str, Any]:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        body: dict[str, Any] = client.get(f"/api/v1/analyses/{job_id}").json()
        if body["status"] in ("complete", "failed"):
            return body
        time.sleep(0.02)
    raise AssertionError("analysis didn't finish")


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_meta_reports_what_analysis_supports(client: TestClient) -> None:
    body = client.get("/api/v1/meta").json()
    assert body["capabilities"]["repository_analysis"] is True
    assert body["capabilities"]["ai_explanations"] is False
    assert set(body["capabilities"]["languages"]) == {"javascript", "jsx", "typescript", "tsx"}
    assert body["limits"]["max_source_files"] > 0


def test_runs_an_analysis_from_request_to_graph(client: TestClient) -> None:
    created = client.post(
        "/api/v1/analyses", json={"repository": "https://github.com/acme/web-app"}
    )
    assert created.status_code == 202
    job = created.json()
    assert job["requested"] == "acme/web-app"
    assert job["status"] in ("queued", "running", "complete")

    done = wait_for(client, job["id"])
    assert done["status"] == "complete"
    assert done["error"] is None
    assert done["repository"]["commitSha"] == SHA
    assert done["progress"]["filesTotal"] == done["progress"]["filesParsed"] == 12

    graph = client.get(f"/api/v1/analyses/{job['id']}/graph")
    assert graph.status_code == 200
    parsed = CodeGraph.model_validate(graph.json())
    assert parsed.provenance.kind == "analysis"
    assert len(parsed.files) == 12


def test_reuses_cached_results_for_the_same_commit() -> None:
    pipeline = FakePipeline()
    with make_client(pipeline) as client:
        first = client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).json()
        assert wait_for(client, first["id"])["cached"] is False
        second = client.post("/api/v1/analyses", json={"repository": "ACME/web-app"}).json()
        assert wait_for(client, second["id"])["cached"] is True
    assert pipeline.identified == 2  # the commit is always re-checked...
    assert pipeline.analyzed == 1  # ...but analyzed only once


def test_caches_to_disk_across_restarts(tmp_path: Any) -> None:
    for expected_runs in (1, 0):
        pipeline = FakePipeline()
        with make_client(pipeline, cache_dir=str(tmp_path)) as client:
            job = client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).json()
            assert wait_for(client, job["id"])["status"] == "complete"
        assert pipeline.analyzed == expected_runs


def test_shares_one_job_between_concurrent_requests_for_a_repository() -> None:
    with make_client(FakePipeline(delay=0.3)) as client:
        first = client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).json()
        second = client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).json()
        assert first["id"] == second["id"]


def test_reports_failures_with_a_safe_code_and_message() -> None:
    error = AnalysisError("too_large", "The repository archive is larger than the 100 MB limit.")
    with make_client(FakePipeline(fail=error)) as client:
        job = client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).json()
        done = wait_for(client, job["id"])
    assert done["status"] == "failed"
    assert done["error"] == {"code": "too_large", "message": error.message}
    assert done["progress"]["stage"] == "failed"


def test_hides_unexpected_internal_errors() -> None:
    with make_client(FakePipeline(fail=RuntimeError("secret /internal/path"))) as client:
        job = client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).json()
        done = wait_for(client, job["id"])
        graph = client.get(f"/api/v1/analyses/{job['id']}/graph")
    assert done["error"]["code"] == "internal_error"
    assert "secret" not in str(done)
    assert graph.status_code == 409


def test_times_out_long_analyses() -> None:
    limits = AnalysisLimits(_env_file=None, analysis_timeout_seconds=1)  # type: ignore[call-arg]
    pipeline = FakePipeline(delay=8)
    config = Settings(_env_file=None, cache_dir="")  # type: ignore[call-arg]
    with TestClient(create_app(config, limits, pipeline)) as client:
        job = client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).json()
        done = wait_for(client, job["id"], timeout=15)
    assert done["error"]["code"] == "timeout"


@pytest.mark.parametrize(
    "repository",
    [
        "../etc",
        "https://evil.example/a/b",
        "a/b;rm",
        "http://github.com/a/b",
        "https://token@github.com/a/b",
        "--upload-pack=x/repo",
    ],
)
def test_rejects_invalid_references_before_doing_anything(
    client: TestClient, repository: str
) -> None:
    response = client.post("/api/v1/analyses", json={"repository": repository})
    assert response.status_code == 422


def test_rate_limits_new_analyses_per_client() -> None:
    with make_client(analysis_requests_per_minute=2) as client:
        statuses = [
            client.post("/api/v1/analyses", json={"repository": f"acme/repo{i}"}).status_code
            for i in range(3)
        ]
        limited = client.post("/api/v1/analyses", json={"repository": "acme/other"})
        # Polling isn't limited.
        assert client.get("/api/v1/meta").status_code == 200
    assert statuses == [202, 202, 429]
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0


def test_joining_a_running_analysis_isnt_rate_limited() -> None:
    with make_client(FakePipeline(delay=0.5), analysis_requests_per_minute=1) as client:
        codes = [
            client.post("/api/v1/analyses", json={"repository": "acme/web-app"}).status_code
            for _ in range(4)
        ]
        other = client.post("/api/v1/analyses", json={"repository": "acme/other"})
    assert codes == [202, 202, 202, 202]
    assert other.status_code == 429


def test_browsers_can_read_retry_after_cross_origin() -> None:
    with make_client(analysis_requests_per_minute=1) as client:
        headers = {"Origin": "https://gitverse.example"}
        client.post("/api/v1/analyses", json={"repository": "acme/a"}, headers=headers)
        limited = client.post("/api/v1/analyses", json={"repository": "acme/b"}, headers=headers)
    assert limited.status_code == 429
    assert "retry-after" in limited.headers["access-control-expose-headers"].lower()


def test_refuses_new_work_when_the_queue_is_full() -> None:
    with make_client(
        FakePipeline(delay=2), max_concurrent_analyses=1, max_queued_analyses=1
    ) as client:
        codes = [
            client.post("/api/v1/analyses", json={"repository": f"acme/repo{i}"}).status_code
            for i in range(3)
        ]
    assert codes == [202, 202, 503]


@pytest.mark.parametrize("job_id", ["unknown", "0" * 32, "../../etc/passwd"])
def test_unknown_analyses_are_not_found(client: TestClient, job_id: str) -> None:
    assert client.get(f"/api/v1/analyses/{job_id}").status_code == 404
    assert client.get(f"/api/v1/analyses/{job_id}/graph").status_code == 404


def test_oversized_body_is_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/analyses", json={"repository": "a" * 1024})
    assert response.status_code == 413


def test_chunked_body_without_length_is_rejected(client: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        yield b'{"repository": "acme/web-app"}'

    response = client.post("/api/v1/analyses", content=chunks())
    assert response.status_code == 411


def test_cors_allows_only_configured_origins(client: TestClient) -> None:
    allowed = client.get("/health", headers={"Origin": "https://gitverse.example"})
    assert allowed.headers["access-control-allow-origin"] == "https://gitverse.example"

    blocked = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers
