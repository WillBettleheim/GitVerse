"""HTTP-level protections: headers, CORS, docs exposure and error detail."""

from tests.test_api import make_client


def test_every_response_carries_security_headers() -> None:
    with make_client() as client:
        for response in (
            client.get("/health"),
            client.get("/api/v1/analyses/" + "0" * 32),
            client.post(
                "/api/v1/analyses", content=b"x" * 600, headers={"Content-Type": "application/json"}
            ),
        ):
            assert response.headers["x-content-type-options"] == "nosniff"
            assert response.headers["x-frame-options"] == "DENY"
            assert response.headers["cache-control"] == "no-store"


def test_other_sites_cannot_call_the_api_from_a_browser() -> None:
    with make_client() as client:
        preflight = client.options(
            "/api/v1/analyses",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
        )
        simple = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in preflight.headers
    assert "access-control-allow-origin" not in simple.headers
    assert "access-control-allow-credentials" not in simple.headers


def test_docs_are_hidden_in_production() -> None:
    with make_client(environment="production") as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
    with make_client() as client:
        assert client.get("/docs").status_code == 200


def test_unknown_job_ids_reveal_nothing() -> None:
    with make_client() as client:
        for job_id in ("../../etc/passwd", "0" * 32, "%2e%2e%2f"):
            response = client.get(f"/api/v1/analyses/{job_id}")
            assert response.status_code == 404
            assert "Traceback" not in response.text
