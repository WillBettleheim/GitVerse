"""Runs one analysis end to end: fetch, read, parse, resolve, build."""

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import IO, Literal

from app.analysis.archive import SourceSnapshot, read_snapshot
from app.analysis.cache import cache_key
from app.analysis.errors import AnalysisError
from app.analysis.evidence import EvidenceStore, blob_sha, build_index
from app.analysis.github import CommitInfo, GitHubClient, RepositoryMetadata
from app.analysis.graph import build_code_graph, resolve_imports
from app.analysis.parser import ParsedFile, parse_source
from app.analysis.resolver import ModuleResolver
from app.core.config import AnalysisLimits
from app.schemas.graph import CodeGraph, RepositoryInfo
from app.services.repo_ref import RepoRef

Stage = Literal[
    "queued",
    "fetching_metadata",
    "downloading",
    "reading_archive",
    "parsing",
    "building_graph",
    "complete",
    "failed",
]


@dataclass
class Progress:
    stage: Stage = "queued"
    files_total: int = 0
    files_parsed: int = 0


ProgressCallback = Callable[[Progress], None]


def analyze_snapshot(
    repository: RepositoryInfo,
    snapshot: SourceSnapshot,
    deadline: float | None = None,
    on_progress: ProgressCallback | None = None,
    evidence: EvidenceStore | None = None,
) -> CodeGraph:
    """The synchronous, CPU-bound part. Checks the deadline between files, since a thread
    can't be interrupted from outside. With an evidence store, also saves what AI Architect may
    quote: the symbol and import index, and the source itself."""
    if not snapshot.files:
        raise AnalysisError(
            "no_supported_files",
            "No JavaScript or TypeScript source files were found to analyze.",
        )
    progress = Progress(stage="parsing", files_total=len(snapshot.files))
    parsed: list[ParsedFile] = []
    for path in sorted(snapshot.files):
        if deadline is not None and time.monotonic() > deadline:
            raise AnalysisError("timeout", "Parsing the repository took too long.")
        parsed.append(parse_source(path, snapshot.files[path]))
        progress.files_parsed += 1
        if on_progress and (progress.files_parsed % 25 == 0):
            on_progress(progress)

    progress.stage = "building_graph"
    if on_progress:
        on_progress(progress)
    resolver = ModuleResolver(
        source_paths=set(snapshot.files),
        all_paths=snapshot.all_paths,
        skipped_paths=snapshot.skipped_paths,
        configs=snapshot.configs,
    )
    blobs = {path: git_blob_sha(content) for path, content in snapshot.files.items()}
    imports = resolve_imports(parsed, resolver)
    graph = build_code_graph(repository, parsed, imports, snapshot.skipped, blobs=blobs)
    if evidence is not None:
        evidence.put(
            cache_key(repository.full_name, repository.commit_sha),
            build_index(repository.commit_sha, parsed, imports, blobs),
            snapshot.files,
        )
    return graph


def git_blob_sha(content: bytes) -> str:
    """The SHA git itself gives this content, so identity matches git's, not a guess."""
    return blob_sha(content)


def repository_info(metadata: RepositoryMetadata, commit: CommitInfo | str) -> RepositoryInfo:
    info = commit if isinstance(commit, CommitInfo) else None
    sha = commit.sha if isinstance(commit, CommitInfo) else commit
    return RepositoryInfo(
        owner=metadata.owner,
        name=metadata.name,
        full_name=metadata.full_name,
        url=metadata.url,
        description=metadata.description,
        default_branch=metadata.default_branch,
        commit_sha=sha,
        committed_at=info.committed_at if info else None,
        commit_message=info.summary if info else None,
        commit_author=info.author if info else None,
        stars=metadata.stars,
        forks=metadata.forks,
        primary_language=metadata.primary_language,
        license=metadata.license,
        archived=metadata.archived,
    )


class Pipeline:
    """The async stages around analyze_snapshot. Split so the cache check sits in the middle."""

    def __init__(
        self,
        github: GitHubClient,
        limits: AnalysisLimits,
        evidence: EvidenceStore | None = None,
    ) -> None:
        self.github = github
        self.limits = limits
        self.evidence = evidence

    async def identify(self, ref: RepoRef, commit: str | None = None) -> RepositoryInfo:
        """Repository details and a pinned commit: the one asked for, or the latest."""
        metadata = await self.github.get_repository(ref)
        return repository_info(metadata, await self.github.get_commit(metadata, commit))

    async def analyze(
        self, repository: RepositoryInfo, deadline: float, on_progress: ProgressCallback
    ) -> CodeGraph:
        on_progress(Progress(stage="downloading"))
        metadata = RepositoryMetadata(
            owner=repository.owner,
            name=repository.name,
            full_name=repository.full_name,
            url=repository.url,
            description=repository.description,
            default_branch=repository.default_branch,
            stars=repository.stars,
            forks=repository.forks,
            primary_language=repository.primary_language,
            license=repository.license,
            size_kb=0,
            archived=repository.archived,
        )
        archive: IO[bytes] = await self.github.download_archive(
            metadata, repository.commit_sha, self.limits.max_repo_size_mb * 1024 * 1024
        )
        try:
            on_progress(Progress(stage="reading_archive"))
            snapshot = await asyncio.to_thread(read_snapshot, archive, self.limits, deadline)
        finally:
            archive.close()
        return await asyncio.to_thread(
            analyze_snapshot, repository, snapshot, deadline, on_progress, self.evidence
        )
