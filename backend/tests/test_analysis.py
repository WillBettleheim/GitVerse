"""End-to-end analysis of fixture repositories whose dependencies are known exactly."""

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.analysis.archive import read_snapshot
from app.analysis.errors import AnalysisError
from app.analysis.graph import build_code_graph, resolve_imports
from app.analysis.parser import parse_source
from app.analysis.pipeline import analyze_snapshot
from app.analysis.resolver import ModuleResolver
from app.core.config import AnalysisLimits
from app.schemas.graph import CodeGraph, RepositoryInfo
from tests.archives import tarball_from_directory, tarball_from_entries

SAMPLE_FOR_FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/features/analysis/__fixtures__/analysis-sample.json"
)

REPOSITORY = RepositoryInfo(
    owner="acme",
    name="web-app",
    full_name="acme/web-app",
    url="https://github.com/acme/web-app",
    description="Fixture repository",
    default_branch="main",
    commit_sha="0123456789abcdef0123456789abcdef01234567",
    stars=0,
    forks=0,
    primary_language="TypeScript",
    license=None,
    archived=False,
)
LIMITS = AnalysisLimits(_env_file=None)  # type: ignore[call-arg]


def analyze(fixture: str) -> CodeGraph:
    snapshot = read_snapshot(tarball_from_directory(fixture), LIMITS)
    return analyze_snapshot(REPOSITORY, snapshot)


@pytest.fixture(scope="module")
def web_app() -> CodeGraph:
    return analyze("web-app")


def edges(graph: CodeGraph) -> set[tuple[str, str]]:
    return {(e.source, e.target) for e in graph.edges}


def test_builds_exactly_the_known_internal_edges(web_app: CodeGraph) -> None:
    assert edges(web_app) == {
        ("src/index.ts", "src/app.tsx"),
        ("src/index.ts", "src/types.ts"),
        ("src/index.ts", "src/utils/index.ts"),
        ("src/index.ts", "src/lazy.ts"),
        ("src/app.tsx", "src/utils/helper.ts"),  # through the tsconfig "@/*" alias
        ("src/app.tsx", "src/utils/index.ts"),
        ("src/utils/index.ts", "src/utils/helper.ts"),
        ("src/esm.ts", "src/utils/helper.ts"),  # "./utils/helper.js" names the .ts file
        ("src/legacy.js", "src/lazy.ts"),  # require
        ("src/component.jsx", "src/app.tsx"),
        ("scripts/run.mjs", "src/app.tsx"),
    }


def test_marks_type_only_edges(web_app: CodeGraph) -> None:
    type_only = {(e.source, e.target) for e in web_app.edges if e.type_only}
    assert type_only == {("src/index.ts", "src/types.ts")}


def test_separates_packages_from_builtins(web_app: CodeGraph) -> None:
    assert web_app.analysis is not None
    externals = {(d.name, d.kind, d.importers) for d in web_app.analysis.external_dependencies}
    assert externals == {
        ("react", "package", 1),
        ("lodash", "package", 1),
        ("@acme/tools", "package", 1),
        ("fs", "builtin", 1),
        ("path", "builtin", 1),
    }


def test_lists_every_unresolved_import_with_its_location(web_app: CodeGraph) -> None:
    assert web_app.analysis is not None
    unresolved = [(u.source, u.specifier, u.line) for u in web_app.analysis.unresolved_imports]
    assert unresolved == [
        ("src/decl-user.ts", "../../outside", 3),
        ("src/index.ts", "./missing", 6),
    ]
    assert web_app.analysis.unresolved_import_count == 2


def test_doesnt_call_assets_declarations_or_skipped_files_unresolved(web_app: CodeGraph) -> None:
    assert web_app.analysis is not None
    specifiers = {u.specifier for u in web_app.analysis.unresolved_imports}
    assert not specifiers & {"./styles.css", "./global", "./vendor.min.js"}


def test_reports_skipped_files_and_parse_errors(web_app: CodeGraph) -> None:
    assert web_app.analysis is not None
    assert web_app.analysis.skipped_files == {
        "declaration_file": 1,
        "minified": 1,
        "vendored_or_generated": 2,
    }
    assert web_app.analysis.files_with_parse_errors == 1
    broken = next(f for f in web_app.files if f.path == "src/broken.ts")
    assert broken.metrics is not None and broken.metrics.parse_error


def test_computes_file_metrics_from_the_source(web_app: CodeGraph) -> None:
    app = next(f for f in web_app.files if f.path == "src/app.tsx")
    assert app.language == "tsx"
    assert app.loc == 12  # 15 lines, minus two blank and one comment-only
    assert app.complexity == 3  # 1 + ternary + if
    assert app.metrics is not None
    assert (app.metrics.total_lines, app.metrics.functions, app.metrics.classes) == (15, 2, 1)
    assert app.metrics.exports == 2
    # Imported by index.ts, component.jsx and scripts/run.mjs.
    assert (app.metrics.local_dependencies, app.metrics.incoming_dependencies) == (2, 3)

    helper = next(f for f in web_app.files if f.path == "src/utils/helper.ts")
    assert helper.complexity == 7  # 1 + if + && + for + if + || + ??
    assert helper.metrics is not None
    assert helper.metrics.external_imports == 3
    assert helper.metrics.incoming_dependencies == 3


def test_summarizes_languages_and_hubs(web_app: CodeGraph) -> None:
    assert web_app.analysis is not None
    assert web_app.analysis.languages == {
        "javascript": 2,
        "jsx": 1,
        "tsx": 1,
        "typescript": 8,
    }
    hubs = [(h.id, h.incoming, h.outgoing) for h in web_app.analysis.hubs[:3]]
    assert hubs == [
        ("src/app.tsx", 3, 2),
        ("src/index.ts", 0, 4),
        ("src/utils/helper.ts", 3, 0),
    ]
    assert web_app.analysis.cycles == []


def test_detects_runtime_and_type_only_cycles() -> None:
    graph = analyze("cycles")
    assert graph.analysis is not None
    cycles = [(c.files, c.type_only) for c in graph.analysis.cycles]
    assert cycles == [
        (["src/a.ts", "src/b.ts", "src/c.ts"], False),
        (["src/d.ts", "src/e.ts"], True),
    ]
    assert graph.analysis.cycle_count == 2
    assert "src/f.ts" in {f.id for f in graph.files}


def test_output_is_valid_shared_schema_and_labelled_as_analysis(web_app: CodeGraph) -> None:
    payload = json.loads(web_app.model_dump_json(by_alias=True, exclude_none=True))
    assert CodeGraph.model_validate(payload) == web_app
    assert web_app.provenance.kind == "analysis"
    assert web_app.provenance.repository == "acme/web-app"


def test_is_deterministic_apart_from_the_timestamp() -> None:
    def stable(graph: CodeGraph) -> str:
        data = graph.model_dump(by_alias=True)
        data["analysis"]["analyzedAt"] = ""
        return json.dumps(data, sort_keys=True)

    assert stable(analyze("web-app")) == stable(analyze("web-app"))


def test_fails_clearly_when_there_is_no_supported_source() -> None:
    snapshot = read_snapshot(
        tarball_from_entries([("acme-x-1/README.md", b"# hi\n"), ("acme-x-1/main.py", b"x=1\n")]),
        LIMITS,
    )
    with pytest.raises(AnalysisError) as error:
        analyze_snapshot(REPOSITORY, snapshot)
    assert error.value.code == "no_supported_files"


def test_stops_parsing_at_the_deadline() -> None:
    snapshot = read_snapshot(tarball_from_directory("web-app"), LIMITS)
    with pytest.raises(AnalysisError) as error:
        analyze_snapshot(REPOSITORY, snapshot, deadline=time.monotonic() - 1)
    assert error.value.code == "timeout"


def test_frontend_sample_matches_current_analyzer_output() -> None:
    """The frontend's tests parse this file, which keeps both schemas in step.
    Regenerate it with UPDATE_FIXTURES=1 after an intentional change."""
    snapshot = read_snapshot(tarball_from_directory("web-app"), LIMITS)
    parsed = [parse_source(p, snapshot.files[p]) for p in sorted(snapshot.files)]
    resolver = ModuleResolver(
        set(snapshot.files), snapshot.all_paths, snapshot.skipped_paths, snapshot.configs
    )
    graph = build_code_graph(
        REPOSITORY,
        parsed,
        resolve_imports(parsed, resolver),
        snapshot.skipped,
        analyzed_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    expected = (
        json.dumps(json.loads(graph.model_dump_json(by_alias=True, exclude_none=True)), indent=2)
        + "\n"
    )
    if os.environ.get("UPDATE_FIXTURES") == "1":
        SAMPLE_FOR_FRONTEND.parent.mkdir(parents=True, exist_ok=True)
        SAMPLE_FOR_FRONTEND.write_text(expected)
    assert SAMPLE_FOR_FRONTEND.read_text() == expected
