"""Times analysis of a real GitHub repository, single-core parsing versus the parser pool.

    .venv/bin/python -m bench.real_repo_bench honojs/hono

Downloads the archive once (GitHub and network time reported separately), then analyzes the
same snapshot both ways and checks that the graphs are identical.
"""

import asyncio
import io
import sys
import time

import httpx

from app.analysis.archive import read_snapshot
from app.analysis.github import GitHubClient
from app.analysis.parallel import ParserPool
from app.analysis.pipeline import analyze_snapshot, repository_info
from app.core.config import AnalysisLimits
from app.services.repo_ref import parse_repo_ref


async def main(name: str) -> None:
    limits = AnalysisLimits(_env_file=None)  # type: ignore[call-arg]
    async with httpx.AsyncClient(follow_redirects=False, timeout=60) as http:
        github = GitHubClient(http)
        ref = parse_repo_ref(name)
        start = time.perf_counter()
        metadata = await github.get_repository(ref)
        commit = await github.get_commit(metadata)
        archive = await github.download_archive(metadata, commit.sha, 100 * 1024 * 1024)
        fetched = time.perf_counter() - start
    data = archive.read()
    start = time.perf_counter()
    snapshot = read_snapshot(io.BytesIO(data), limits)
    read = time.perf_counter() - start
    info = repository_info(metadata, commit)
    pool = ParserPool()
    pool.parse({f"warm{i}.ts": b"export const a = 1;" for i in range(200)}, None)

    start = time.perf_counter()
    single = analyze_snapshot(info, snapshot)
    t_single = time.perf_counter() - start
    start = time.perf_counter()
    pooled = analyze_snapshot(info, snapshot, parser=pool)
    t_pool = time.perf_counter() - start
    pool.shutdown()

    skip = {"analysis": {"analyzed_at"}}
    same = single.model_dump(exclude=skip) == pooled.model_dump(exclude=skip)  # type: ignore[arg-type]
    print(
        f"{metadata.full_name} @ {commit.sha[:7]}: {len(snapshot.files)} source files, "
        f"{len(single.edges)} edges, archive {len(data) // 1024} KB"
    )
    print(f"GitHub metadata + download: {fetched * 1000:.0f} ms (network, not GitVerse)")
    print(f"read archive: {read * 1000:.0f} ms")
    print(
        f"analyze, 1 core: {t_single * 1000:.0f} ms; with {pool.workers} workers: "
        f"{t_pool * 1000:.0f} ms; identical graphs: {same}"
    )


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "honojs/hono"))
