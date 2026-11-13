import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest

from app.analysis.errors import AnalysisError
from app.analysis.github import GitHubClient, RepositoryMetadata
from app.services.repo_ref import parse_repo_ref

SHA = "0123456789abcdef0123456789abcdef01234567"
REPO = {
    "full_name": "Acme/Web-App",
    "private": False,
    "visibility": "public",
    "description": "A web app",
    "default_branch": "main",
    "stargazers_count": 12,
    "forks_count": 3,
    "language": "TypeScript",
    "license": {"spdx_id": "MIT"},
    "size": 120,
    "archived": False,
}

Handler = Callable[[httpx.Request], httpx.Response]


def run(handler: Handler, call: Callable[[GitHubClient], Any], token: str | None = None) -> Any:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    async def go() -> Any:
        transport = httpx.MockTransport(recording)
        async with httpx.AsyncClient(transport=transport, follow_redirects=False) as http:
            return await call(GitHubClient(http, token))

    result = asyncio.run(go())
    # Whatever happened, nothing went anywhere but GitHub's two hosts, over https.
    for request in seen:
        assert request.url.scheme == "https"
        assert request.url.host in {"api.github.com", "codeload.github.com"}
    return result


def metadata() -> RepositoryMetadata:
    async def get(client: GitHubClient) -> RepositoryMetadata:
        return await client.get_repository(parse_repo_ref("acme/web-app"))

    result: RepositoryMetadata = run(lambda _: httpx.Response(200, json=REPO), get)
    return result


def test_reads_metadata_with_github_canonical_name() -> None:
    meta = metadata()
    assert meta.full_name == "Acme/Web-App"
    assert (meta.stars, meta.forks, meta.license, meta.default_branch) == (12, 3, "MIT", "main")


def test_sends_a_token_only_when_configured() -> None:
    headers: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        headers.append(request.headers.get("authorization"))
        return httpx.Response(200, json=REPO)

    ref = parse_repo_ref("acme/web-app")
    run(handler, lambda c: c.get_repository(ref))
    run(handler, lambda c: c.get_repository(ref), token="secret")  # noqa: S106
    assert headers == [None, "Bearer secret"]


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(404), "repository_not_found"),
        (httpx.Response(200, json={**REPO, "private": True}), "repository_private"),
        (httpx.Response(200, json={**REPO, "visibility": "internal"}), "repository_private"),
        (
            httpx.Response(301, headers={"location": "https://evil.example/x"}),
            "repository_moved",
        ),
        (httpx.Response(302, headers={"location": "https://api.github.com/x"}), "repository_moved"),
        (httpx.Response(403, headers={"x-ratelimit-remaining": "0"}), "github_rate_limited"),
        (httpx.Response(429), "github_rate_limited"),
        (httpx.Response(403), "repository_private"),
        (httpx.Response(500), "github_unavailable"),
        (httpx.Response(200, json={**REPO, "full_name": "../../etc"}), "github_unavailable"),
    ],
)
def test_maps_github_responses_to_safe_errors(response: httpx.Response, code: str) -> None:
    ref = parse_repo_ref("acme/web-app")
    with pytest.raises(AnalysisError) as error:
        run(lambda _: response, lambda c: c.get_repository(ref))
    assert error.value.code == code


def test_never_follows_a_redirect() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest"})

    ref = parse_repo_ref("acme/web-app")
    with pytest.raises(AnalysisError):
        run(handler, lambda c: c.get_repository(ref))
    assert calls == ["https://api.github.com/repos/acme/web-app"]


def test_reports_network_failures_and_timeouts_safely() -> None:
    ref = parse_repo_ref("acme/web-app")

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    for handler in (refuse, slow):
        with pytest.raises(AnalysisError) as error:
            run(handler, lambda c: c.get_repository(ref))
        assert error.value.code == "github_unavailable"
        assert "boom" not in error.value.message


def test_resolves_the_default_branch_to_a_commit() -> None:
    meta = metadata()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/repos/Acme/Web-App/commits/main"
        assert request.headers["accept"] == "application/vnd.github.sha"
        return httpx.Response(200, text=SHA)

    assert run(handler, lambda c: c.resolve_commit(meta)) == SHA


@pytest.mark.parametrize("body", ["not-a-sha", "0123", f"{SHA}\n<script>"])
def test_rejects_anything_but_a_commit_sha(body: str) -> None:
    meta = metadata()
    with pytest.raises(AnalysisError):
        run(lambda _: httpx.Response(200, text=body), lambda c: c.resolve_commit(meta))


def test_an_empty_repository_has_nothing_to_analyze() -> None:
    meta = metadata()
    with pytest.raises(AnalysisError) as error:
        run(lambda _: httpx.Response(409), lambda c: c.resolve_commit(meta))
    assert error.value.code == "repository_empty"


def test_downloads_the_archive_for_exactly_that_commit() -> None:
    meta = metadata()

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == f"https://codeload.github.com/Acme/Web-App/tar.gz/{SHA}"
        assert "authorization" not in request.headers
        return httpx.Response(200, content=b"archive-bytes")

    archive = run(handler, lambda c: c.download_archive(meta, SHA, 1024))
    assert archive.read() == b"archive-bytes"


def test_stops_downloading_past_the_size_limit() -> None:
    meta = metadata()

    def declared(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 10, headers={"content-length": "5000"})

    async def chunks() -> AsyncIterator[bytes]:
        # No content-length, so only counting while streaming can catch it.
        for _ in range(2):
            yield b"x" * 600

    def streamed(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=chunks())

    for handler in (declared, streamed):
        with pytest.raises(AnalysisError) as error:
            run(handler, lambda c: c.download_archive(meta, SHA, 1000))
        assert error.value.code == "too_large"


def test_refuses_to_build_an_archive_url_from_an_invalid_sha() -> None:
    meta = metadata()
    with pytest.raises(AnalysisError):
        run(
            lambda _: httpx.Response(200),
            lambda c: c.download_archive(meta, "../../x", 1000),
        )
