"""Snapshot comparison over a real git history with known changes."""

from pathlib import Path

import pytest

from app.analysis.diff import diff_graphs
from app.schemas.diff import SnapshotDiff
from app.schemas.graph import CodeGraph
from tests.git_fixture import GIT, GitFixture, build_history

pytestmark = pytest.mark.skipif(GIT is None, reason="git isn't installed")


@pytest.fixture(scope="module")
def history(tmp_path_factory: pytest.TempPathFactory) -> tuple[GitFixture, list[CodeGraph]]:
    repo = build_history(Path(tmp_path_factory.mktemp("history")))
    return repo, [repo.analyze(commit) for commit in repo.commits]


def edges(items: list) -> set[tuple[str, str]]:  # type: ignore[type-arg]
    return {(e.source, e.target) for e in items}


def metric(diff: SnapshotDiff, name: str) -> tuple[float, float, float]:
    change = next(m for m in diff.metrics if m.name == name)
    return change.before, change.after, change.delta


def test_each_snapshot_reflects_its_own_commit(history: tuple[GitFixture, list[CodeGraph]]) -> None:
    _, (c1, c2, c3, c4) = history
    assert [f.path for f in c1.files] == ["src/a.ts", "src/b.ts", "src/util.ts"]
    assert [f.path for f in c2.files] == ["src/a.ts", "src/b.ts", "src/c.ts", "src/util.ts"]
    assert [f.path for f in c3.files] == ["src/a.ts", "src/b.ts", "src/helpers.ts"]
    assert [f.path for f in c4.files] == ["src/b.ts", "src/core.ts", "src/helpers.ts"]
    assert c3.analysis is not None
    assert c3.analysis.repository.commit_message == "Move util to helpers and drop c"


def test_blob_identity_matches_git_exactly(history: tuple[GitFixture, list[CodeGraph]]) -> None:
    repo, graphs = history
    for commit, graph in zip(repo.commits, graphs, strict=True):
        for file in graph.files:
            assert file.blob == repo.blob(commit.sha, file.path)


def test_detects_added_and_modified_files_and_new_dependencies(
    history: tuple[GitFixture, list[CodeGraph]],
) -> None:
    _, (c1, c2, _, _) = history
    diff = diff_graphs(c1, c2, None, False)
    assert diff.files.added == ["src/c.ts"]
    assert diff.files.removed == []
    assert [m.path for m in diff.files.modified] == ["src/b.ts"]
    assert diff.files.renamed == []
    # a.ts and util.ts are byte-for-byte identical, so they count as unchanged.
    assert diff.files.unchanged == 2
    assert edges(diff.edges.added) == {("src/c.ts", "src/a.ts"), ("src/b.ts", "src/util.ts")}
    assert diff.edges.removed == []
    assert metric(diff, "files") == (3, 4, 1)
    assert metric(diff, "edges") == (1, 3, 2)


def test_measures_how_a_modified_file_changed(
    history: tuple[GitFixture, list[CodeGraph]],
) -> None:
    _, (c1, c2, _, _) = history
    b = diff_graphs(c1, c2, None, False).files.modified[0]
    assert (b.before.outgoing, b.after.outgoing) == (0, 1)
    assert (b.before.incoming, b.after.incoming) == (1, 1)


def test_detects_a_pure_move_from_content_and_keeps_its_dependencies(
    history: tuple[GitFixture, list[CodeGraph]],
) -> None:
    _, (_, c2, c3, _) = history
    diff = diff_graphs(c2, c3, None, False)
    assert [(r.old_path, r.new_path, r.content_changed) for r in diff.files.renamed] == [
        ("src/util.ts", "src/helpers.ts", False)
    ]
    assert diff.files.added == []
    assert diff.files.removed == ["src/c.ts"]
    assert [m.path for m in diff.files.modified] == ["src/b.ts"]
    # b → util carries over to b → helpers, so the move isn't reported as a dependency change.
    assert edges(diff.edges.removed) == {("src/c.ts", "src/a.ts")}
    assert diff.edges.added == []
    assert diff.rename_detection.method == "content"
    assert diff.rename_detection.complete is False


def test_a_rename_with_edits_needs_githubs_rename_detection(
    history: tuple[GitFixture, list[CodeGraph]],
) -> None:
    _, (_, _, c3, c4) = history
    without = diff_graphs(c3, c4, None, False)
    assert without.files.renamed == []
    assert without.files.removed == ["src/a.ts"]
    assert without.files.added == ["src/core.ts"]

    with_github = diff_graphs(c3, c4, {"src/a.ts": "src/core.ts"}, True)
    assert [(r.old_path, r.new_path, r.content_changed) for r in with_github.files.renamed] == [
        ("src/a.ts", "src/core.ts", True)
    ]
    assert with_github.files.added == with_github.files.removed == []
    assert with_github.edges.added == with_github.edges.removed == []
    assert with_github.rename_detection.method == "github"
    assert with_github.rename_detection.complete is True


def test_ignores_github_renames_that_dont_match_the_snapshots(
    history: tuple[GitFixture, list[CodeGraph]],
) -> None:
    _, (_, _, c3, c4) = history
    diff = diff_graphs(c3, c4, {"src/ghost.ts": "src/core.ts", "src/b.ts": "src/x.ts"}, True)
    assert diff.files.renamed == []


def test_compares_backwards_in_time(history: tuple[GitFixture, list[CodeGraph]]) -> None:
    _, (c1, c2, _, _) = history
    diff = diff_graphs(c2, c1, None, False)
    assert diff.files.removed == ["src/c.ts"]
    assert diff.files.added == []
    assert edges(diff.edges.removed) == {("src/c.ts", "src/a.ts"), ("src/b.ts", "src/util.ts")}
    assert metric(diff, "files") == (4, 3, -1)


def test_compares_across_several_commits(history: tuple[GitFixture, list[CodeGraph]]) -> None:
    _, (c1, _, _, c4) = history
    diff = diff_graphs(c1, c4, {"src/a.ts": "src/core.ts"}, True)
    renamed = {(r.old_path, r.new_path) for r in diff.files.renamed}
    assert renamed == {("src/a.ts", "src/core.ts"), ("src/util.ts", "src/helpers.ts")}
    assert diff.rename_detection.method == "github+content"
    assert edges(diff.edges.added) == {("src/b.ts", "src/helpers.ts")}


def test_identical_snapshots_have_no_changes(history: tuple[GitFixture, list[CodeGraph]]) -> None:
    _, (c1, *_) = history
    diff = diff_graphs(c1, c1, {}, True)
    assert diff.files.unchanged == 3
    assert diff.files.added_count == diff.files.removed_count == diff.files.modified_count == 0
    assert all(m.delta == 0 for m in diff.metrics)


def test_diff_records_both_commits_without_interpreting_them(
    history: tuple[GitFixture, list[CodeGraph]],
) -> None:
    repo, (c1, c2, _, _) = history
    payload = diff_graphs(c1, c2, None, False).model_dump(mode="json", by_alias=True)
    assert payload["base"]["sha"] == repo.commits[0].sha
    assert payload["head"]["message"] == "Add c and use util in b"
    assert payload["files"]["renamed"] == []
    assert set(payload["renameDetection"]) == {"method", "complete", "note"}


DIFF_SAMPLE = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/features/timetravel/__fixtures__/diff-sample.json"
)


def test_frontend_diff_sample_matches_current_output(
    history: tuple[GitFixture, list[CodeGraph]],
) -> None:
    """The frontend's tests parse this. Regenerate with UPDATE_FIXTURES=1 after a change.
    Commit SHAs are stable because the fixture fixes authors, dates and content."""
    import json
    import os

    _, (c1, _, c3, _) = history
    diff = diff_graphs(c1, c3, None, False)
    expected = json.dumps(diff.model_dump(mode="json", by_alias=True), indent=2) + "\n"
    if os.environ.get("UPDATE_FIXTURES") == "1":
        DIFF_SAMPLE.parent.mkdir(parents=True, exist_ok=True)
        DIFF_SAMPLE.write_text(expected)
    assert DIFF_SAMPLE.read_text() == expected
