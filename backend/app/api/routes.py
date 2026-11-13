"""HTTP routes."""

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app import __version__
from app.analysis.errors import AnalysisError
from app.analysis.jobs import Job, JobManager
from app.core.config import AnalysisLimits, get_limits
from app.core.ratelimit import SlidingWindowLimiter
from app.schemas.graph import RepositoryInfo
from app.services.repo_ref import InvalidRepoRef, parse_repo_ref

router = APIRouter()
_JOB_ID = re.compile(r"[0-9a-f]{32}")


class HealthResponse(BaseModel):
    status: str
    version: str


class Capabilities(BaseModel):
    repository_analysis: bool
    ai_explanations: bool
    languages: list[str]


class MetaResponse(BaseModel):
    version: str
    capabilities: Capabilities
    limits: AnalysisLimits


class AnalysisRequest(BaseModel):
    repository: str = Field(max_length=300, examples=["sindresorhus/ky"])
    # A full commit SHA from the repository's history. Omitted means the latest commit.
    commit: str | None = Field(default=None, pattern=r"^[0-9a-f]{40}$")


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ProgressView(_Camel):
    stage: str
    files_total: int
    files_parsed: int


class ErrorView(_Camel):
    code: str
    message: str


class JobView(_Camel):
    id: str
    requested: str
    commit: str | None
    status: str
    created_at: str
    progress: ProgressView
    repository: RepositoryInfo | None
    cached: bool
    error: ErrorView | None


def get_jobs(request: Request) -> JobManager:
    jobs: JobManager = request.app.state.jobs
    return jobs


def get_limiter(request: Request) -> SlidingWindowLimiter:
    limiter: SlidingWindowLimiter = request.app.state.analysis_limiter
    return limiter


def _view(job: Job) -> dict[str, Any]:
    view = JobView(
        id=job.id,
        requested=job.ref.full_name,
        commit=job.commit,
        status=job.status,
        created_at=job.created_at,
        progress=ProgressView(
            stage=job.progress.stage,
            files_total=job.progress.files_total,
            files_parsed=job.progress.files_parsed,
        ),
        repository=job.repository,
        cached=job.cached,
        error=ErrorView(code=job.error_code, message=job.error_message or "")
        if job.error_code
        else None,
    )
    return view.model_dump(mode="json", by_alias=True)


def _find(jobs: JobManager, job_id: str) -> Job:
    job = jobs.get(job_id) if _JOB_ID.fullmatch(job_id) else None
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found.")
    return job


@router.get("/health", tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@router.get("/api/v1/meta", tags=["system"])
def meta(request: Request, limits: Annotated[AnalysisLimits, Depends(get_limits)]) -> MetaResponse:
    return MetaResponse(
        version=__version__,
        capabilities=Capabilities(
            repository_analysis=True,
            # AI Architect always finds evidence. This says whether a model explains it.
            ai_explanations=request.app.state.architect.enabled,
            languages=["javascript", "jsx", "typescript", "tsx"],
        ),
        limits=limits,
    )


@router.post(
    "/api/v1/analyses",
    tags=["analysis"],
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        422: {"description": "Not a valid public GitHub repository reference"},
        429: {"description": "Too many analysis requests from this client"},
        503: {"description": "The analyzer is at capacity"},
    },
)
async def create_analysis(
    # Async on purpose: jobs start as tasks on the server's event loop.
    body: AnalysisRequest,
    request: Request,
    jobs: Annotated[JobManager, Depends(get_jobs)],
    limiter: Annotated[SlidingWindowLimiter, Depends(get_limiter)],
) -> JSONResponse:
    try:
        ref = parse_repo_ref(body.repository)
    except InvalidRepoRef as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    # Joining an analysis that's already running costs nothing, so it isn't rate limited.
    existing = jobs.find_active(ref, body.commit)
    if existing is not None:
        return JSONResponse(_view(existing), status_code=status.HTTP_202_ACCEPTED)
    # Neither is an exact commit that's already been analyzed: it needs nothing from GitHub.
    if body.commit is not None:
        cached = jobs.cached(ref, body.commit)
        if cached is not None:
            job = jobs.complete_from_cache(ref, body.commit, cached)
            return JSONResponse(_view(job), status_code=status.HTTP_202_ACCEPTED)

    client = request.client.host if request.client else "unknown"
    retry_after = limiter.check(client)
    if retry_after is not None:
        return JSONResponse(
            {"detail": "Too many analysis requests. Wait a minute and try again."},
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": str(int(retry_after))},
        )

    try:
        job = jobs.submit(ref, body.commit)
    except AnalysisError as exc:
        return JSONResponse(
            {"detail": exc.message},
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers={"Retry-After": "30"},
        )
    return JSONResponse(_view(job), status_code=status.HTTP_202_ACCEPTED)


@router.get("/api/v1/analyses/{job_id}", tags=["analysis"])
def get_analysis(job_id: str, jobs: Annotated[JobManager, Depends(get_jobs)]) -> dict[str, Any]:
    return _view(_find(jobs, job_id))


@router.delete("/api/v1/analyses/{job_id}", tags=["analysis"])
def cancel_analysis(job_id: str, jobs: Annotated[JobManager, Depends(get_jobs)]) -> dict[str, Any]:
    """Cancels an analysis that hasn't started. One already running finishes and is cached."""
    job = _find(jobs, job_id)
    if not jobs.cancel(job.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only an analysis that hasn't started can be cancelled.",
        )
    return _view(job)


@router.get("/api/v1/analyses/{job_id}/graph", tags=["analysis"])
def get_analysis_graph(job_id: str, jobs: Annotated[JobManager, Depends(get_jobs)]) -> Response:
    job = _find(jobs, job_id)
    if job.result is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This analysis has no result yet.")
    return Response(
        job.result.model_dump_json(by_alias=True, exclude_none=True),
        media_type="application/json",
    )
