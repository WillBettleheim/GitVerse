"""Parallel parsing gives exactly the same results, fails safe, and responses are compressed."""

import tarfile
import time
from concurrent.futures.process import BrokenProcessPool
from typing import Any

import pytest

from app.analysis import parallel
from app.analysis.archive import read_snapshot
from app.analysis.errors import AnalysisError
from app.analysis.parallel import ParserPool, parse_sequentially
from app.analysis.pipeline import analyze_snapshot
from tests.architect_support import LIMITS, repository
from tests.archives import PREFIX, tarball_from_entries
from tests.test_api import make_client


def many_files(count: int) -> dict[str, bytes]:
    return {
        f"src/m{i}.ts": (
            (f'import {{ f{i - 1} }} from "./m{i - 1}";\n' if i else "")
            + f"export function f{i}(x: number) {{ return x > {i} ? x : {i}; }}\n"
        ).encode()
        for i in range(count)
    }


@pytest.fixture(scope="module")
def pool() -> Any:
    instance = ParserPool(workers=2)
    yield instance
    instance.shutdown()


def test_parallel_parsing_matches_sequential_parsing_exactly(pool: ParserPool) -> None:
    files = many_files(400)
    assert pool.parse(files, None) == parse_sequentially(files, None)


def test_parallel_and_sequential_analyses_build_the_same_graph(pool: ParserPool) -> None:
    entries: list[tarfile.TarInfo | tuple[str, bytes]] = [
        (f"{PREFIX}/{path}", content) for path, content in many_files(300).items()
    ]
    snapshot = read_snapshot(tarball_from_entries(entries), LIMITS)
    sequential = analyze_snapshot(repository(), snapshot)
    pooled = analyze_snapshot(repository(), snapshot, parser=pool)
    assert pooled.model_dump(exclude={"analysis": {"analyzed_at"}}) == sequential.model_dump(
        exclude={"analysis": {"analyzed_at"}}
    )


def test_small_repositories_skip_the_workers(pool: ParserPool, monkeypatch: Any) -> None:
    monkeypatch.setattr(pool, "_pool", lambda: pytest.fail("workers started for a small repo"))
    assert len(pool.parse(many_files(10), None)) == 10


def test_reports_progress_as_chunks_finish(pool: ParserPool) -> None:
    seen: list[int] = []
    pool.parse(many_files(400), None, seen.append)
    assert seen == sorted(seen) and seen[-1] == 400


def test_a_passed_deadline_stops_parsing(pool: ParserPool) -> None:
    with pytest.raises(AnalysisError) as raised:
        pool.parse(many_files(400), time.monotonic() - 1)
    assert raised.value.code == "timeout"


def test_a_crashed_worker_falls_back_to_parsing_in_process(monkeypatch: Any) -> None:
    broken = ParserPool(workers=2)

    class Exploding:
        def submit(self, *args: object) -> Any:
            raise BrokenProcessPool("worker died")

        def shutdown(self, **kwargs: object) -> None:
            pass

    monkeypatch.setattr(broken, "_pool", lambda: Exploding())
    files = many_files(200)
    assert broken.parse(files, None) == parse_sequentially(files, None)


def test_a_single_worker_never_starts_processes() -> None:
    assert ParserPool(workers=1).parse(many_files(300), None)[0].path == "src/m0.ts"
    assert parallel.default_workers() >= 1


def test_large_responses_are_compressed() -> None:
    with make_client() as client:
        small = client.get("/health", headers={"Accept-Encoding": "gzip"})
        meta = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert "gzip" not in small.headers.get("content-encoding", "")
    assert meta.headers["content-encoding"] == "gzip"
    assert meta.headers["x-content-type-options"] == "nosniff"
