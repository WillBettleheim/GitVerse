"""Runs analyses in the background with bounded concurrency, de-duplication and caching."""

import asyncio
import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from app.analysis.cache import ResultCache, cache_key
from app.analysis.errors import AnalysisError, ErrorCode
from app.analysis.pipeline import Pipeline, Progress, ProgressCallback, Stage
from app.schemas.graph import CodeGraph, RepositoryInfo
from app.services.repo_ref import RepoRef

logger = logging.getLogger(__name__)

JobStatus = Literal["queued", "running", "complete", "failed"]
_MAX_JOBS = 200


@dataclass
class Job:
    id: str
    ref: RepoRef
    created_at: str
    # A specific commit to analyze, or None for the default branch's latest.
    commit: str | None = None
    status: JobStatus = "queued"
    progress: Progress = field(default_factory=Progress)
    repository: RepositoryInfo | None = None
    result: CodeGraph | None = None
    cached: bool = False
    error_code: ErrorCode | None = None
    error_message: str | None = None

    @property
    def finished(self) -> bool:
        return self.status in ("complete", "failed")


class JobManager:
    def __init__(
        self,
        pipeline: Pipeline,
        cache: ResultCache,
        max_concurrent: int,
        max_queued: int,
        timeout_seconds: float,
    ) -> None:
        self._pipeline = pipeline
        self._cache = cache
        self._slots = asyncio.Semaphore(max_concurrent)
        self._max_concurrent = max_concurrent
        self._max_queued = max_queued
        self._timeout = timeout_seconds
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._tasks: set[asyncio.Task[None]] = set()
        self._task_of: dict[str, asyncio.Task[None]] = {}

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def find_active(self, ref: RepoRef, commit: str | None = None) -> Job | None:
        """An unfinished job for this repository and commit, which a new request can share."""
        for job in self._jobs.values():
            if (
                not job.finished
                and job.commit == commit
                and job.ref.full_name.lower() == ref.full_name.lower()
            ):
                return job
        return None

    def cached(self, ref: RepoRef, commit: str) -> CodeGraph | None:
        """A finished result for an exact commit, without asking GitHub anything."""
        return self._cache.get(cache_key(ref.full_name, commit))

    def complete_from_cache(self, ref: RepoRef, commit: str, graph: CodeGraph) -> Job:
        files = len(graph.files)
        job = Job(
            id=uuid.uuid4().hex,
            ref=ref,
            created_at=_now(),
            commit=commit,
            status="complete",
            progress=Progress("complete", files, files),
            repository=graph.analysis.repository if graph.analysis else None,
            result=graph,
            cached=True,
        )
        self._jobs[job.id] = job
        self._evict()
        return job

    def cancel(self, job_id: str) -> bool:
        """Cancels a job that hasn't started. A running one finishes, and its result is cached."""
        job = self._jobs.get(job_id)
        task = self._task_of.get(job_id)
        if job is None or task is None or job.status != "queued":
            return False
        task.cancel()
        self._fail(job, "cancelled", "The analysis was cancelled before it started.")
        return True

    def submit(self, ref: RepoRef, commit: str | None = None) -> Job:
        existing = self.find_active(ref, commit)
        if existing is not None:
            return existing
        active = sum(1 for job in self._jobs.values() if not job.finished)
        if active >= self._max_concurrent + self._max_queued:
            raise AnalysisError("busy", "The analyzer is busy. Try again in a minute.")

        job = Job(id=uuid.uuid4().hex, ref=ref, created_at=_now(), commit=commit)
        self._jobs[job.id] = job
        self._evict()
        task = asyncio.create_task(self._run(job))
        self._tasks.add(task)
        self._task_of[job.id] = task

        def forget(done: asyncio.Task[None]) -> None:
            self._tasks.discard(done)
            self._task_of.pop(job.id, None)

        task.add_done_callback(forget)
        return job

    async def _run(self, job: Job) -> None:
        def report(progress: Progress) -> None:
            job.progress = Progress(progress.stage, progress.files_total, progress.files_parsed)

        try:
            async with self._slots:
                job.status = "running"
                deadline = time.monotonic() + self._timeout
                await asyncio.wait_for(self._analyze(job, deadline, report), self._timeout + 5)
            job.status = "complete"
            job.progress = Progress("complete", job.progress.files_total, job.progress.files_total)
        except asyncio.CancelledError:
            if not job.finished:
                self._fail(job, "cancelled", "The analysis was cancelled.")
        except AnalysisError as exc:
            self._fail(job, exc.code, exc.message)
        except TimeoutError:
            self._fail(job, "timeout", "The analysis took longer than the time limit.")
        except Exception:
            # Details go to the server log only. Users get a generic message.
            logger.exception("Analysis %s failed unexpectedly", job.id)
            self._fail(job, "internal_error", "The analysis failed unexpectedly.")

    async def _analyze(self, job: Job, deadline: float, report: ProgressCallback) -> None:
        report(Progress(stage="fetching_metadata"))
        repository = await self._pipeline.identify(job.ref, job.commit)
        job.repository = repository
        key = cache_key(repository.full_name, repository.commit_sha)
        cached = self._cache.get(key)
        if cached is not None:
            job.result = cached
            job.cached = True
            files = len(cached.files)
            report(Progress("complete", files, files))
            return
        result = await self._pipeline.analyze(repository, deadline, report)
        self._cache.put(key, result)
        job.result = result

    @staticmethod
    def _fail(job: Job, code: ErrorCode, message: str) -> None:
        job.status = "failed"
        job.error_code = code
        job.error_message = message
        stage: Stage = "failed"
        job.progress = Progress(stage, job.progress.files_total, job.progress.files_parsed)

    def _evict(self) -> None:
        while len(self._jobs) > _MAX_JOBS:
            oldest = next((jid for jid, job in self._jobs.items() if job.finished), None)
            if oldest is None:
                return
            del self._jobs[oldest]

    async def shutdown(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
