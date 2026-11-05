from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        cors_origins="http://localhost:3000,https://gitverse.example",
        max_request_body_bytes=512,
    )
    return TestClient(create_app(settings))


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_meta_reports_analysis_as_unavailable(client: TestClient) -> None:
    body = client.get("/api/v1/meta").json()
    assert body["capabilities"] == {"repository_analysis": False, "ai_explanations": False}
    assert body["limits"]["max_files"] > 0


def test_analysis_returns_501_and_never_a_graph(client: TestClient) -> None:
    response = client.post("/api/v1/analyses", json={"repository": "vercel/next.js"})
    assert response.status_code == 501
    assert "not implemented" in response.json()["detail"]
    assert "files" not in response.json()


@pytest.mark.parametrize("repository", ["../etc", "https://evil.example/a/b", "a/b;rm"])
def test_analysis_rejects_invalid_reference(client: TestClient, repository: str) -> None:
    response = client.post("/api/v1/analyses", json={"repository": repository})
    assert response.status_code == 422


def test_oversized_body_is_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/analyses", json={"repository": "a" * 1024})
    assert response.status_code == 413


def test_chunked_body_without_length_is_rejected(client: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        yield b'{"repository": "vercel/next.js"}'

    response = client.post("/api/v1/analyses", content=chunks())
    assert response.status_code == 411


def test_cors_allows_only_configured_origins(client: TestClient) -> None:
    allowed = client.get("/health", headers={"Origin": "https://gitverse.example"})
    assert allowed.headers["access-control-allow-origin"] == "https://gitverse.example"

    blocked = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers
