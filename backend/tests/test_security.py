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


def test_rate_limits_ignore_spoofed_headers_by_default() -> None:
    with make_client(analysis_requests_per_minute=1) as client:
        ok = client.post(
            "/api/v1/analyses", json={"repository": "acme/a"}, headers={"Fly-Client-IP": "1.1.1.1"}
        )
        spoofed = client.post(
            "/api/v1/analyses", json={"repository": "acme/b"}, headers={"Fly-Client-IP": "2.2.2.2"}
        )
    assert ok.status_code == 202
    assert spoofed.status_code == 429


def test_rate_limits_use_the_configured_proxy_header() -> None:
    with make_client(analysis_requests_per_minute=1, client_ip_header="Fly-Client-IP") as client:
        first = client.post(
            "/api/v1/analyses", json={"repository": "acme/a"}, headers={"Fly-Client-IP": "1.1.1.1"}
        )
        other_client = client.post(
            "/api/v1/analyses", json={"repository": "acme/b"}, headers={"Fly-Client-IP": "2.2.2.2"}
        )
        same_client = client.post(
            "/api/v1/analyses", json={"repository": "acme/c"}, headers={"Fly-Client-IP": "1.1.1.1"}
        )
    assert [first.status_code, other_client.status_code, same_client.status_code] == [202, 202, 429]


def test_an_empty_proxy_header_setting_is_ignored() -> None:
    with make_client(client_ip_header="") as client:
        assert client.get("/health").status_code == 200
