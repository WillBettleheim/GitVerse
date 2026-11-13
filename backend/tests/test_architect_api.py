"""The AI Architect endpoint and the Claude client, with the network replaced."""

import asyncio
import json
import os
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

from app.analysis.archive import read_snapshot
from app.analysis.pipeline import Pipeline, Progress, ProgressCallback, analyze_snapshot
from app.assistant.llm import FALLBACK_BETA, AnthropicClient, LLMError, LLMRequest
from app.assistant.prompt import ANSWER_SCHEMA
from app.core.config import Settings
from app.main import create_app
from app.schemas.graph import CodeGraph, RepositoryInfo
from app.services.repo_ref import RepoRef
from tests.architect_support import (
    LIMITS,
    SHA,
    EvidenceCitingLLM,
    ScriptedLLM,
    answer_json,
    repository,
)
from tests.archives import tarball_from_directory

SECRET = "sk-ant-test-never-leaks"  # noqa: S105 - a fake key, to prove it never leaks


class FixturePipeline(Pipeline):
    """Analyzes the architect-app fixture for any repository, with GitHub replaced."""

    def __init__(self) -> None:
        super().__init__(github=None, limits=LIMITS)  # type: ignore[arg-type]

    async def identify(self, ref: RepoRef, commit: str | None = None) -> RepositoryInfo:
        return repository(ref.full_name, commit or SHA)

    async def analyze(
        self, repository: RepositoryInfo, deadline: float, on_progress: ProgressCallback
    ) -> CodeGraph:
        on_progress(Progress(stage="parsing"))
        snapshot = read_snapshot(tarball_from_directory("architect-app"), LIMITS)
        return analyze_snapshot(repository, snapshot, deadline, on_progress, self.evidence)


def make_client(llm: Any = None, **settings: Any) -> TestClient:
    settings.setdefault("cache_dir", "")
    config = Settings(
        _env_file=None,  # type: ignore[call-arg]
        cors_origins="http://localhost:3000",
        **settings,
    )
    return TestClient(create_app(config, LIMITS, FixturePipeline(), llm=llm))


def analyze(client: TestClient) -> None:
    created = client.post("/api/v1/analyses", json={"repository": "acme/architect-app"}).json()
    for _ in range(200):
        job = client.get(f"/api/v1/analyses/{created['id']}").json()
        if job["status"] == "complete":
            return
        asyncio.run(asyncio.sleep(0.02))
    raise AssertionError("analysis didn't finish")


def question(text: str = "Where is authentication implemented?", **extra: Any) -> dict[str, Any]:
    return {"repository": "acme/architect-app", "commit": SHA, "question": text, **extra}


@pytest.fixture
def llm() -> EvidenceCitingLLM:
    return EvidenceCitingLLM()


@pytest.fixture
def client(llm: EvidenceCitingLLM) -> Iterator[TestClient]:
    with make_client(llm) as c:
        analyze(c)
        yield c


def test_answers_with_checked_files_lines_and_evidence(
    client: TestClient, llm: EvidenceCitingLLM
) -> None:
    response = client.post("/api/v1/architect/questions", json=question())
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "ai"
    assert body["model"] == "evidence-citing"
    assert body["commitSha"] == SHA
    paths = [f["path"] for f in body["files"]]
    assert {"src/auth/session.ts", "src/auth/tokens.ts", "src/middleware/auth.ts"} <= set(paths)
    assert all(f["lines"] for f in body["files"])
    assert {e["kind"] for e in body["evidence"]} >= {"file", "snippet"}
    assert len(llm.requests) == 1


def test_selected_file_is_used_as_the_subject(client: TestClient) -> None:
    body = client.post(
        "/api/v1/architect/questions",
        json=question("What depends on this module?", focus="src/db/client.ts"),
    ).json()
    assert body["search"]["target"] == "src/db/client.ts"
    importers = next(e for e in body["evidence"] if e["kind"] == "importers")
    assert {(e["source"], e["line"]) for e in importers["edges"]} == {
        ("src/auth/session.ts", 2),
        ("src/services/userService.ts", 1),
    }


def test_unknown_focus_is_ignored(client: TestClient) -> None:
    body = client.post(
        "/api/v1/architect/questions",
        json=question("What depends on this module?", focus="../../etc/passwd"),
    ).json()
    assert body["search"]["target"] is None


def test_commit_must_be_analyzed_first(llm: EvidenceCitingLLM) -> None:
    with make_client(llm) as c:
        response = c.post("/api/v1/architect/questions", json=question())
    assert response.status_code == 409
    assert response.json()["code"] == "not_analyzed"
    assert llm.requests == []


@pytest.mark.parametrize(
    "body",
    [
        question(""),
        question("x" * 501),
        {**question(), "commit": "main"},
        {**question(), "repository": "https://evil.example/acme/repo"},
        {**question(), "snapshots": ["a" * 40] * 9},
        {**question(), "tools": ["bash"]},
    ],
)
def test_invalid_requests_are_rejected(client: TestClient, body: dict[str, Any]) -> None:
    assert client.post("/api/v1/architect/questions", json=body).status_code == 422


def test_questions_are_rate_limited_per_client(llm: EvidenceCitingLLM) -> None:
    with make_client(llm, architect_requests_per_minute=2) as c:
        analyze(c)
        statuses = [
            c.post("/api/v1/architect/questions", json=question()).status_code for _ in range(3)
        ]
        limited = c.post("/api/v1/architect/questions", json=question())
    assert statuses == [200, 200, 429]
    assert limited.headers["Retry-After"]
    assert limited.json()["code"] == "rate_limited"


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("busy", 503),
        ("not_configured", 503),
        ("unavailable", 502),
        ("refused", 422),
        ("invalid_output", 502),
    ],
)
def test_model_failures_become_safe_errors(code: str, status: int) -> None:
    with make_client(ScriptedLLM(error=code)) as c:  # type: ignore[arg-type]
        analyze(c)
        response = c.post("/api/v1/architect/questions", json=question())
    assert response.status_code == status
    assert response.json()["code"] == code


def test_malformed_model_output_is_an_error_not_an_answer() -> None:
    with make_client(ScriptedLLM(reply="Sure! Authentication is in auth.ts")) as c:
        analyze(c)
        response = c.post("/api/v1/architect/questions", json=question())
    assert response.status_code == 502
    assert response.json()["code"] == "invalid_output"


def test_unexpected_failures_reveal_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    class Exploding:
        model = "x"

        async def complete(self, request: LLMRequest) -> Any:
            raise RuntimeError(f"internal detail {SECRET}")

    with make_client(Exploding()) as c:
        analyze(c)
        response = c.post("/api/v1/architect/questions", json=question())
    assert response.status_code == 500
    assert SECRET not in response.text
    assert response.json() == {
        "detail": "AI Architect failed unexpectedly.",
        "code": "internal_error",
    }


def test_without_a_key_it_returns_labelled_evidence_only() -> None:
    with make_client(None) as c:
        analyze(c)
        meta = c.get("/api/v1/meta").json()
        body = c.post("/api/v1/architect/questions", json=question()).json()
    assert meta["capabilities"]["ai_explanations"] is False
    assert body["mode"] == "evidence_only"
    assert body["answer"] is None and body["model"] is None
    assert any("AI explanations are turned off" in note for note in body["notes"])
    assert body["files"][0]["path"] == "src/auth/tokens.ts"


def test_the_api_key_stays_on_the_server(llm: EvidenceCitingLLM) -> None:
    with make_client(None, anthropic_api_key=SECRET) as c:
        analyze(c)
        meta = c.get("/api/v1/meta")
        assert meta.json()["capabilities"]["ai_explanations"] is True
        assert SECRET not in meta.text
        openapi = c.get("/openapi.json")
        assert SECRET not in openapi.text


def test_an_empty_key_means_ai_is_off() -> None:
    with make_client(None, anthropic_api_key="  ") as c:
        assert c.get("/api/v1/meta").json()["capabilities"]["ai_explanations"] is False


def test_unsupported_questions_cost_nothing(client: TestClient, llm: EvidenceCitingLLM) -> None:
    body = client.post(
        "/api/v1/architect/questions", json=question("Which GraphQL resolvers handle payments?")
    ).json()
    assert body["mode"] == "insufficient_evidence"
    assert llm.requests == []


# The Claude client itself, with the SDK call replaced.


def fake_message(**overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        "stop_reason": "end_turn",
        "model": "claude-opus-5-5",
        "content": [
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text=answer_json()),
        ],
        "usage": SimpleNamespace(iterations=None),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def claude(monkeypatch: pytest.MonkeyPatch, outcome: Any) -> tuple[AnthropicClient, list[Any]]:
    client = AnthropicClient(SECRET, "claude-opus-5-5", "medium", 16000, 30)
    calls: list[Any] = []

    async def create(**kwargs: Any) -> Any:
        calls.append(kwargs)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(client._client.beta.messages, "create", create)
    return client, calls


REQUEST = LLMRequest(system="rules", user="evidence", schema=ANSWER_SCHEMA)


def test_claude_request_uses_structured_output_fallbacks_and_no_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, calls = claude(monkeypatch, fake_message())
    reply = asyncio.run(client.complete(REQUEST))
    assert json.loads(reply.text)["answer"] == "An answer."
    sent = calls[0]
    assert sent["model"] == "claude-opus-5-5"
    assert sent["betas"] == [FALLBACK_BETA]
    assert sent["fallbacks"] == "default"
    assert sent["output_config"] == {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": ANSWER_SCHEMA},
    }
    assert "tools" not in sent and "tool_choice" not in sent
    assert sent["system"] == "rules"
    assert sent["messages"] == [{"role": "user", "content": "evidence"}]


def test_claude_fallback_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    message = fake_message(
        model="claude-opus-4-8",
        usage=SimpleNamespace(iterations=[SimpleNamespace(type="fallback_message")]),
    )
    client, _ = claude(monkeypatch, message)
    reply = asyncio.run(client.complete(REQUEST))
    assert reply.fallback and reply.model == "claude-opus-4-8"


@pytest.mark.parametrize(
    ("message", "code"),
    [
        (fake_message(stop_reason="refusal", content=[]), "refused"),
        (fake_message(stop_reason="max_tokens"), "invalid_output"),
        (fake_message(content=[SimpleNamespace(type="thinking", thinking="")]), "invalid_output"),
    ],
)
def test_claude_stop_reasons_are_checked(
    monkeypatch: pytest.MonkeyPatch, message: Any, code: str
) -> None:
    client, _ = claude(monkeypatch, message)
    with pytest.raises(LLMError) as raised:
        asyncio.run(client.complete(REQUEST))
    assert raised.value.code == code


def _response(status: int) -> httpx2.Response:
    return httpx2.Response(status, request=httpx2.Request("POST", "https://api.anthropic.com"))


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (anthropic.RateLimitError("slow", response=_response(429), body=None), "busy"),
        (
            anthropic.AuthenticationError("bad", response=_response(401), body=None),
            "not_configured",
        ),
        (anthropic.InternalServerError("down", response=_response(500), body=None), "unavailable"),
        (anthropic.BadRequestError("bad", response=_response(400), body=None), "unavailable"),
        (anthropic.APIConnectionError(request=httpx2.Request("POST", "https://x")), "unavailable"),
    ],
)
def test_claude_errors_are_mapped_without_details(
    monkeypatch: pytest.MonkeyPatch, error: Exception, code: str
) -> None:
    client, _ = claude(monkeypatch, error)
    with pytest.raises(LLMError) as raised:
        asyncio.run(client.complete(REQUEST))
    assert raised.value.code == code
    assert SECRET not in raised.value.message


# The answer contract shared with the frontend.

ANSWER_SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/features/architect/__fixtures__/answer-sample.json"
)


def test_frontend_answer_sample_matches_the_current_contract() -> None:
    """A real, checked answer about the same fixture the frontend's sample graph comes from.

    Regenerate with UPDATE_FIXTURES=1 after changing the answer format.
    """
    from app.analysis.cache import cache_key
    from app.analysis.evidence import EvidenceStore
    from app.assistant.service import ArchitectService
    from tests.test_analysis import REPOSITORY

    store = EvidenceStore(None)
    snapshot = read_snapshot(tarball_from_directory("web-app"), LIMITS)
    graph = analyze_snapshot(REPOSITORY, snapshot, evidence=store)
    llm = ScriptedLLM(
        reply=answer_json(
            "src/utils/helper.ts is imported directly by three files, so a change there reaches "
            "most of the app.",
            claims=[
                {
                    "text": "src/app.tsx, src/esm.ts and src/utils/index.ts import it directly.",
                    "basis": "verified",
                    "evidence": ["E1"],
                },
                {
                    "text": "It acts as a shared utility layer.",
                    "basis": "inferred",
                    "evidence": ["E1", "E3"],
                },
                {"text": "It is covered by tests.", "basis": "verified", "evidence": []},
            ],
            files=[
                {
                    "path": "src/utils/helper.ts",
                    "reason": "The module asked about.",
                    "evidence": ["E3"],
                },
                {"path": "src/app.tsx", "reason": "Imports it directly.", "evidence": ["E1"]},
                {"path": "src/utils/index.ts", "reason": "Re-exports it.", "evidence": ["E1"]},
                {"path": "src/helpers/missing.ts", "reason": "Invented.", "evidence": []},
            ],
            relationships=[
                {"source": "src/app.tsx", "target": "src/utils/helper.ts", "evidence": ["E1"]},
                {
                    "source": "src/utils/index.ts",
                    "target": "src/utils/helper.ts",
                    "evidence": ["E1"],
                },
            ],
            uncertainty="The analysis can't tell how often these imports run.",
        )
    )
    service = ArchitectService(store, llm)
    answer = asyncio.run(
        service.ask(
            "What depends on src/utils/helper.ts?",
            graph,
            cache_key(REPOSITORY.full_name, REPOSITORY.commit_sha),
        )
    )
    expected = json.dumps(answer.model_dump(mode="json", by_alias=True), indent=2) + "\n"
    if os.environ.get("UPDATE_FIXTURES") == "1":
        ANSWER_SAMPLE.parent.mkdir(parents=True, exist_ok=True)
        ANSWER_SAMPLE.write_text(expected)
    assert ANSWER_SAMPLE.read_text() == expected
