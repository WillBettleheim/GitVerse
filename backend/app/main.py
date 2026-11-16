from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app import __version__
from app.analysis.cache import ResultCache
from app.analysis.evidence import EvidenceStore
from app.analysis.github import GitHubClient
from app.analysis.jobs import JobManager
from app.analysis.parallel import ParserPool
from app.analysis.pipeline import Pipeline
from app.api.architect import router as architect_router
from app.api.history import HISTORY_TTL_SECONDS, TtlCache
from app.api.history import router as history_router
from app.api.routes import router
from app.assistant.llm import AnthropicClient, LLMClient
from app.assistant.service import ArchitectService
from app.core.config import AnalysisLimits, Settings, get_limits, get_settings
from app.core.middleware import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.core.ratelimit import SlidingWindowLimiter


def create_app(
    settings: Settings | None = None,
    limits: AnalysisLimits | None = None,
    pipeline: Pipeline | None = None,
    llm: LLMClient | None = None,
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

    evidence = EvidenceStore(
        str(Path(settings.cache_dir).parent / "evidence") if settings.cache_dir else None,
        max_disk_bytes=settings.evidence_max_mb * 1024 * 1024,
    )
    pipeline.evidence = evidence
    parser = ParserPool(settings.parse_workers)
    if pipeline.parser is None:
        pipeline.parser = parser
    api_key = (
        settings.anthropic_api_key.get_secret_value().strip() if settings.anthropic_api_key else ""
    )
    if llm is None and api_key:
        llm = AnthropicClient(
            api_key=api_key,
            model=settings.architect_model,
            effort=settings.architect_effort,
            max_tokens=settings.architect_max_output_tokens,
            timeout_seconds=settings.architect_timeout_seconds,
        )

    jobs = JobManager(
        pipeline=pipeline,
        cache=ResultCache(
            settings.cache_dir or None, max_disk_bytes=settings.cache_max_mb * 1024 * 1024
        ),
        max_concurrent=settings.max_concurrent_analyses,
        max_queued=settings.max_queued_analyses,
        timeout_seconds=limits.analysis_timeout_seconds,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await jobs.shutdown()
        parser.shutdown()
        if http is not None:
            await http.aclose()

    # Interactive docs are for development. In production they'd only advertise the attack surface.
    production = settings.environment == "production"
    app = FastAPI(
        title="GitVerse API",
        version=__version__,
        lifespan=lifespan,
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    app.state.jobs = jobs
    app.state.analysis_limiter = SlidingWindowLimiter(settings.analysis_requests_per_minute)
    app.state.history_limiter = SlidingWindowLimiter(settings.history_requests_per_minute)
    app.state.github = pipeline.github
    app.state.history_cache = TtlCache[dict[str, object]](HISTORY_TTL_SECONDS, 64)
    app.state.diff_cache = TtlCache[dict[str, object]](3600, 64)
    app.state.architect = ArchitectService(evidence, llm, settings.max_concurrent_architect)
    app.state.architect_limiter = SlidingWindowLimiter(settings.architect_requests_per_minute)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    app.add_middleware(SecurityHeadersMiddleware)
    # Graphs are large, repetitive JSON: compression cuts a 5,000-file graph by about 90%.
    app.add_middleware(GZipMiddleware, minimum_size=2048, compresslevel=6)
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
    app.include_router(architect_router)
    return app


app = create_app()
