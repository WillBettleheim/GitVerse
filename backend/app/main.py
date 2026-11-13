from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.analysis.cache import ResultCache
from app.analysis.github import GitHubClient
from app.analysis.jobs import JobManager
from app.analysis.pipeline import Pipeline
from app.api.history import HISTORY_TTL_SECONDS, TtlCache
from app.api.history import router as history_router
from app.api.routes import router
from app.core.config import AnalysisLimits, Settings, get_limits, get_settings
from app.core.middleware import BodySizeLimitMiddleware
from app.core.ratelimit import SlidingWindowLimiter


def create_app(
    settings: Settings | None = None,
    limits: AnalysisLimits | None = None,
    pipeline: Pipeline | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    limits = limits or get_limits()

    http: httpx.AsyncClient | None = None
    if pipeline is None:
        http = httpx.AsyncClient(
            # Redirects are refused, so a response can never send a request to another host.
            follow_redirects=False,
            timeout=httpx.Timeout(15.0, read=30.0),
            limits=httpx.Limits(max_connections=8),
        )
        token = settings.github_token.get_secret_value() if settings.github_token else None
        pipeline = Pipeline(GitHubClient(http, token), limits)

    jobs = JobManager(
        pipeline=pipeline,
        cache=ResultCache(settings.cache_dir or None),
        max_concurrent=settings.max_concurrent_analyses,
        max_queued=settings.max_queued_analyses,
        timeout_seconds=limits.analysis_timeout_seconds,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await jobs.shutdown()
        if http is not None:
            await http.aclose()

    app = FastAPI(title="GitVerse API", version=__version__, lifespan=lifespan)
    app.state.jobs = jobs
    app.state.analysis_limiter = SlidingWindowLimiter(settings.analysis_requests_per_minute)
    app.state.history_limiter = SlidingWindowLimiter(settings.history_requests_per_minute)
    app.state.github = pipeline.github
    app.state.history_cache = TtlCache[dict[str, object]](HISTORY_TTL_SECONDS, 64)
    app.state.diff_cache = TtlCache[dict[str, object]](3600, 64)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    # Added last so it is outermost: limit rejections still carry CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
        # Without this, browsers hide Retry-After from the frontend.
        expose_headers=["Retry-After"],
    )
    app.include_router(router)
    app.include_router(history_router)
    return app


app = create_app()
