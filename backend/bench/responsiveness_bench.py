"""How responsive the server's event loop stays while a large analysis runs.

    .venv/bin/python -m bench.responsiveness_bench

Runs the real analyze step on a synthetic 5,000-file repository the way the job manager does,
while a probe coroutine measures how late each 5 ms timer fires. Long delays mean other requests,
like progress polling, wait behind the analysis.
"""

import asyncio
import io
import os
import statistics
import time

from app.analysis.archive import read_snapshot
from app.analysis.parallel import ParserPool
from app.analysis.pipeline import Pipeline, analyze_snapshot
from app.core.config import AnalysisLimits
from bench.analysis_bench import REPOSITORY, synthetic_repository

SIZE = 5000


async def main() -> None:
    limits = AnalysisLimits(_env_file=None, max_source_files=10_000)  # type: ignore[call-arg]
    snapshot = read_snapshot(io.BytesIO(synthetic_repository(SIZE)), limits)
    workers = int(os.environ.get("PARSE_WORKERS", "0")) or None
    pipeline = Pipeline(github=None, limits=limits, parser=ParserPool(workers))  # type: ignore[arg-type]
    print(f"parser workers: {pipeline.parser.workers if pipeline.parser else 0}")
    delays: list[float] = []
    done = False

    async def probe() -> None:
        while not done:
            start = time.perf_counter()
            await asyncio.sleep(0.005)
            delays.append((time.perf_counter() - start) * 1000 - 5)

    task = asyncio.create_task(probe())
    start = time.perf_counter()
    await pipeline.run_snapshot(REPOSITORY, snapshot, time.monotonic() + 600, lambda _: None)
    elapsed = (time.perf_counter() - start) * 1000
    done = True
    await task
    delays.sort()
    print(f"{SIZE} synthetic files analyzed in {elapsed:.0f} ms")
    print(
        f"event loop delay: median {statistics.median(delays):.1f} ms, "
        f"p95 {delays[int(len(delays) * 0.95)]:.1f} ms, max {delays[-1]:.1f} ms, "
        f"{len(delays)} probes"
    )
    _ = analyze_snapshot
    if pipeline.parser:
        pipeline.parser.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
