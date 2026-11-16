"""Reproducible benchmark of the analysis pipeline on deterministic synthetic repositories.

    .venv/bin/python -m bench.analysis_bench

Synthetic data only: the repositories are generated TypeScript with realistic imports, so the
numbers describe the analyzer, not any real GitHub repository. GitHub download time isn't
included; it depends on the network.
"""

import gzip
import io
import os
import platform
import random
import statistics
import tarfile
import time
from collections.abc import Callable
from typing import Any

from app.analysis.archive import read_snapshot
from app.analysis.evidence import build_index
from app.analysis.graph import build_code_graph, resolve_imports
from app.analysis.parallel import ParserPool
from app.analysis.parser import parse_source
from app.analysis.pipeline import git_blob_sha
from app.analysis.resolver import ModuleResolver
from app.core.config import AnalysisLimits
from app.schemas.graph import RepositoryInfo

SIZES = (100, 500, 1000, 2500, 5000)
RUNS = int(os.environ.get("BENCH_RUNS", "3"))
PREFIX = "acme-bench-0000000"
REPOSITORY = RepositoryInfo(
    owner="acme",
    name="bench",
    full_name="acme/bench",
    url="https://github.com/acme/bench",
    default_branch="main",
    commit_sha="0" * 40,
    stars=0,
    forks=0,
    archived=False,
)


def synthetic_repository(size: int) -> bytes:
    """A gzipped tarball of `size` TypeScript files, like GitHub's archives. Seeded."""
    rng = random.Random(size)
    folders = [f"src/area{a}/part{p}" for a in range(max(1, size // 120)) for p in range(4)]
    paths = [f"{folders[i % len(folders)]}/module{i}.ts" for i in range(size)]
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for i, path in enumerate(paths):
            lines = []
            for j in rng.sample(range(i), k=min(i, rng.randint(1, 5))):
                rel = os.path.relpath(paths[j], os.path.dirname(path)).removesuffix(".ts")
                rel = rel if rel.startswith(".") else f"./{rel}"
                lines.append(f'import {{ fn{j} }} from "{rel}";')
            lines.append('import { z } from "zod";')
            for k in range(rng.randint(3, 12)):
                lines += [
                    f"export function fn{i}_{k}(value: number): number {{",
                    "  if (value > 10 && value < 100) {",
                    "    return value * 2;",
                    "  }",
                    "  return value;",
                    "}",
                ]
            lines.append(f"export const fn{i} = fn{i}_0;")
            content = "\n".join(lines).encode()
            info = tarfile.TarInfo(f"{PREFIX}/{path}")
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def timed(fn: Callable[[], Any]) -> tuple[float, Any]:
    samples, result = [], None
    for _ in range(RUNS):
        start = time.perf_counter()
        result = fn()
        samples.append((time.perf_counter() - start) * 1000)
    return statistics.median(samples), result


def main() -> None:
    limits = AnalysisLimits(_env_file=None, max_source_files=10_000)  # type: ignore[call-arg]
    pool = ParserPool()
    # Starting worker processes is a one-time cost per server, so it's kept out of the timings.
    pool.parse({f"warm{i}.ts": b"export const a = 1;" for i in range(200)}, None)
    print(f"Analysis pipeline, synthetic repositories, median of {RUNS} runs (ms unless noted)")
    print(f"Python {platform.python_version()}, {platform.system()} {platform.machine()}")
    print(f"Parser pool: {pool.workers} worker processes. 'total' uses the pool.")
    header = (
        "files", "archive KB", "read", "parse 1 core", "parse pool", "resolve", "graph", "index",
        "serialize", "JSON KB", "gzip KB", "total",
    )  # fmt: skip
    print(" | ".join(f"{h:>12}" for h in header))
    for size in SIZES:
        archive = synthetic_repository(size)
        t_read, snapshot = timed(lambda: read_snapshot(io.BytesIO(archive), limits))
        t_parse, parsed = timed(
            lambda: [parse_source(p, snapshot.files[p]) for p in sorted(snapshot.files)]
        )
        t_pool, pooled = timed(lambda: pool.parse(snapshot.files, None))
        if pooled != parsed:
            raise SystemExit("parallel parsing must match sequential parsing exactly")

        def resolve() -> Any:
            resolver = ModuleResolver(
                source_paths=set(snapshot.files),
                all_paths=snapshot.all_paths,
                skipped_paths=snapshot.skipped_paths,
                configs=snapshot.configs,
            )
            return resolve_imports(parsed, resolver)

        t_resolve, imports = timed(resolve)
        blobs = {p: git_blob_sha(c) for p, c in snapshot.files.items()}
        t_graph, graph = timed(
            lambda: build_code_graph(REPOSITORY, parsed, imports, snapshot.skipped, blobs=blobs)
        )
        t_index, _ = timed(lambda: build_index(REPOSITORY.commit_sha, parsed, imports, blobs))
        t_json, payload = timed(lambda: graph.model_dump_json(by_alias=True, exclude_none=True))
        zipped = len(gzip.compress(payload.encode(), 6))
        total = t_read + t_pool + t_resolve + t_graph + t_index + t_json
        row = (
            size, len(archive) // 1024, t_read, t_parse, t_pool, t_resolve, t_graph, t_index,
            t_json, len(payload) // 1024, zipped // 1024, total,
        )  # fmt: skip
        print(" | ".join(f"{v:>12.1f}" if isinstance(v, float) else f"{v:>12}" for v in row))
    pool.shutdown()


if __name__ == "__main__":
    main()
