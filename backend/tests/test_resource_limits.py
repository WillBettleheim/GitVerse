"""Disk and memory stay bounded however many analyses are requested."""

import os
from pathlib import Path

from app.analysis import jobs as jobs_module
from app.analysis.cache import ResultCache, cache_key
from app.analysis.disk import DiskBudget, prune
from app.analysis.evidence import EvidenceStore, RepositoryIndex, blob_sha
from app.analysis.jobs import Job, JobManager
from app.analysis.pipeline import Progress
from app.services.repo_ref import RepoRef
from tests.architect_support import analyze_fixture


def write(path: Path, size: int, age: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    stamp = 1_700_000_000 + age
    os.utime(path, (stamp, stamp))


def test_prune_removes_least_recently_used_files_first(tmp_path: Path) -> None:
    for i in range(10):
        write(tmp_path / "blobs" / f"{i:02d}", 100, age=i)
    removed = prune(tmp_path, max_bytes=500)
    left = sorted(p.name for p in (tmp_path / "blobs").iterdir())
    # Back under 90% of the budget, keeping the newest.
    assert removed == 6
    assert left == ["06", "07", "08", "09"]


def test_prune_does_nothing_within_budget(tmp_path: Path) -> None:
    write(tmp_path / "a", 100, age=0)
    assert prune(tmp_path, max_bytes=1000) == 0
    assert (tmp_path / "a").exists()


def test_budget_prunes_at_most_every_so_often(tmp_path: Path) -> None:
    budget = DiskBudget(tmp_path, max_bytes=100)
    write(tmp_path / "a", 200, age=0)
    assert budget.maybe_prune() == 1
    write(tmp_path / "b", 200, age=1)
    assert budget.maybe_prune() == 0
    assert budget.maybe_prune(force=True) == 1


def test_reading_evidence_keeps_it_from_being_pruned(tmp_path: Path) -> None:
    store = EvidenceStore(str(tmp_path))
    old, new = b"export const old = 1;\n" * 20, b"export const fresh = 2;\n" * 20
    store.put("k", RepositoryIndex(commit_sha="x", files={}), {"a.ts": old, "b.ts": new})
    for content, age in ((old, 0), (new, 100)):
        path = tmp_path / "blobs" / blob_sha(content)[:2] / blob_sha(content)
        os.utime(path, (1_700_000_000 + age, 1_700_000_000 + age))
    # Reading the older blob marks it as in use.
    assert store.source(blob_sha(old)) == old
    index_size = sum(p.stat().st_size for p in (tmp_path / "index").iterdir())
    prune(tmp_path, max_bytes=len(old) + index_size + len(new) // 2)
    assert store.source(blob_sha(old)) == old
    assert store.source(blob_sha(new)) is None


def test_evidence_and_results_respect_their_disk_budgets(tmp_path: Path) -> None:
    store = EvidenceStore(str(tmp_path / "evidence"), max_disk_bytes=2_000)
    analyze_fixture(store=store)
    total = sum(p.stat().st_size for p in (tmp_path / "evidence").rglob("*") if p.is_file())
    assert total <= 2_000

    cache = ResultCache(str(tmp_path / "results"), max_disk_bytes=1)
    analyzed = analyze_fixture()
    cache.put("one", analyzed.graph)
    assert list((tmp_path / "results").iterdir()) == []
    # Pruned from disk, but the in-memory copy still serves this process.
    assert cache.get("one") is not None


def test_old_job_results_leave_memory_and_come_back_from_the_cache(tmp_path: Path) -> None:
    analyzed = analyze_fixture()
    repository = analyzed.graph.analysis.repository  # type: ignore[union-attr]
    cache = ResultCache(str(tmp_path), memory_entries=1)
    cache.put(cache_key(repository.full_name, repository.commit_sha), analyzed.graph)
    manager = JobManager(
        pipeline=None,  # type: ignore[arg-type]
        cache=cache,
        max_concurrent=1,
        max_queued=1,
        timeout_seconds=1,
    )
    ref = RepoRef(repository.owner, repository.name)

    jobs = []
    for _ in range(jobs_module._RESULTS_IN_MEMORY + 5):
        job = Job(
            id=os.urandom(16).hex(),
            ref=ref,
            created_at="now",
            status="complete",
            progress=Progress("complete", 1, 1),
            repository=repository,
            result=analyzed.graph,
        )
        manager._jobs[job.id] = job
        jobs.append(job)
    manager._evict()

    assert jobs[0].result is None
    assert jobs[-1].result is analyzed.graph
    assert manager.result(jobs[0]) == analyzed.graph
