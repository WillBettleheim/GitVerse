"""HTTP routes. Analysis is deliberately not implemented in this phase."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app import __version__
from app.core.config import AnalysisLimits, get_limits
from app.services.repo_ref import InvalidRepoRef, parse_repo_ref

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    version: str


class Capabilities(BaseModel):
    repository_analysis: bool
    ai_explanations: bool


class MetaResponse(BaseModel):
    version: str
    capabilities: Capabilities
    limits: AnalysisLimits


class AnalysisRequest(BaseModel):
    repository: str = Field(max_length=300, examples=["vercel/next.js"])


@router.get("/health", tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@router.get("/api/v1/meta", tags=["system"])
def meta(limits: Annotated[AnalysisLimits, Depends(get_limits)]) -> MetaResponse:
    return MetaResponse(
        version=__version__,
        capabilities=Capabilities(repository_analysis=False, ai_explanations=False),
        limits=limits,
    )


@router.post(
    "/api/v1/analyses",
    tags=["analysis"],
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    responses={422: {"description": "Not a valid GitHub repository reference"}},
)
def create_analysis(body: AnalysisRequest) -> None:
    """Validates the reference, then reports that analysis isn't built yet.

    It returns 501 rather than a stubbed graph so no client can mistake it for real output.
    """
    try:
        ref = parse_repo_ref(body.repository)
    except InvalidRepoRef as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    raise HTTPException(
        status.HTTP_501_NOT_IMPLEMENTED,
        f"Repository analysis is not implemented yet ({ref.full_name} was not fetched).",
    )
