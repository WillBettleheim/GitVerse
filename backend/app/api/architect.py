"""AI Architect: questions about an analyzed commit, answered from its evidence."""

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.analysis.cache import cache_key
from app.analysis.jobs import JobManager
from app.assistant.llm import LLMError, LLMErrorCode
from app.assistant.service import ArchitectService
from app.core.ratelimit import SlidingWindowLimiter
from app.schemas.assistant import ArchitectAnswer, QuestionRequest
from app.services.repo_ref import InvalidRepoRef, parse_repo_ref

logger = logging.getLogger(__name__)
router = APIRouter(tags=["architect"])

_ERROR_STATUS: dict[LLMErrorCode, int] = {
    "not_configured": status.HTTP_503_SERVICE_UNAVAILABLE,
    "busy": status.HTTP_503_SERVICE_UNAVAILABLE,
    "unavailable": status.HTTP_502_BAD_GATEWAY,
    "refused": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "invalid_output": status.HTTP_502_BAD_GATEWAY,
}


def _service(request: Request) -> ArchitectService:
    service: ArchitectService = request.app.state.architect
    return service


def _jobs(request: Request) -> JobManager:
    jobs: JobManager = request.app.state.jobs
    return jobs


def _error(
    code: str, message: str, status_code: int, retry_after: int | None = None
) -> JSONResponse:
    return JSONResponse(
        {"detail": message, "code": code},
        status_code=status_code,
        headers={"Retry-After": str(retry_after)} if retry_after else None,
    )


@router.post(
    "/api/v1/architect/questions",
    responses={
        409: {"description": "That commit hasn't been analyzed"},
        429: {"description": "Too many questions from this client"},
        502: {"description": "The model failed or returned an unusable answer"},
        503: {"description": "AI Architect is busy or not set up"},
    },
)
async def ask(
    request: Request,
    body: Annotated[QuestionRequest, Body()],
    service: Annotated[ArchitectService, Depends(_service)],
    jobs: Annotated[JobManager, Depends(_jobs)],
) -> Any:
    try:
        ref = parse_repo_ref(body.repository)
    except InvalidRepoRef as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    graph = jobs.cached(ref, body.commit)
    if graph is None or graph.analysis is None:
        return _error(
            "not_analyzed",
            "Analyze this commit before asking about it.",
            status.HTTP_409_CONFLICT,
        )

    limiter: SlidingWindowLimiter = request.app.state.architect_limiter
    retry_after = limiter.check(request.client.host if request.client else "unknown")
    if retry_after is not None:
        return _error(
            "rate_limited",
            "Too many questions. Wait a minute and try again.",
            status.HTTP_429_TOO_MANY_REQUESTS,
            int(retry_after),
        )

    question = " ".join(body.question.split())
    if not question:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ask a question.")
    history = [
        snapshot
        for sha in dict.fromkeys(body.snapshots)
        if sha != body.commit and (snapshot := jobs.cached(ref, sha)) is not None
    ]
    try:
        answer: ArchitectAnswer = await service.ask(
            question,
            graph,
            cache_key(ref.full_name, body.commit),
            focus=body.focus,
            history=history,
        )
    except LLMError as exc:
        return _error(
            exc.code,
            exc.message,
            _ERROR_STATUS[exc.code],
            30 if exc.code == "busy" else None,
        )
    except Exception:
        logger.exception("AI Architect failed unexpectedly")
        return _error(
            "internal_error",
            "AI Architect failed unexpectedly.",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return answer.model_dump(mode="json", by_alias=True)
