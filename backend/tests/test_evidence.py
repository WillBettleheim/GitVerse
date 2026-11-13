"""Symbols, import lines and verified source: what AI Architect is allowed to quote."""

from pathlib import Path

import pytest

from app.analysis.evidence import EvidenceStore, blob_sha
from app.analysis.parser import parse_source
from tests.architect_support import analyze_fixture

FIXTURE = Path(__file__).parent / "fixtures" / "repos" / "architect-app"


def test_symbols_have_exact_line_spans_and_export_flags() -> None:
    source = b"""import x from "y";
export function login(user) {
  return 1;
}
const helper = () => 2;
export const LIMIT = 5;
export default class Session {
  start() {}
  stop() {
  }
}
interface Shape { a: 1 }
export type Id = string;
function outer() { function nested() {} }
"""
    symbols = {
        (s.name, s.kind, s.line, s.end_line, s.exported)
        for s in parse_source("a.ts", source).symbols
    }
    assert symbols == {
        ("login", "function", 2, 4, True),
        ("helper", "function", 5, 5, False),
        ("LIMIT", "variable", 6, 6, True),
        ("Session", "class", 7, 11, True),
        ("Session.start", "method", 8, 8, True),
        ("Session.stop", "method", 9, 10, True),
        ("Shape", "interface", 12, 12, False),
        ("Id", "type", 13, 13, True),
        ("outer", "function", 14, 14, False),
    }


def test_index_records_each_import_line_and_where_it_resolved() -> None:
    analyzed = analyze_fixture()
    index = analyzed.store.index(analyzed.key)
    assert index is not None
    session = index.files["src/auth/session.ts"]
    assert [(i.line, i.target) for i in session.imports] == [
        (1, "src/auth/tokens.ts"),
        (2, "src/db/client.ts"),
        (3, "src/services/userService.ts"),
    ]
    tokens = index.files["src/auth/tokens.ts"]
    assert next((i.line, i.package, i.resolution) for i in tokens.imports) == (
        1,
        "jsonwebtoken",
        "external",
    )
    assert {s.name for s in session.symbols} >= {"login", "logout", "currentUserId"}


def test_index_lines_match_the_real_source() -> None:
    analyzed = analyze_fixture()
    index = analyzed.store.index(analyzed.key)
    assert index is not None
    for path, entry in index.files.items():
        lines = (FIXTURE / path).read_text().splitlines()
        for symbol in entry.symbols:
            short = symbol.name.split(".")[-1]
            assert short in lines[symbol.line - 1], (path, symbol)
        for item in entry.imports:
            assert item.specifier in lines[item.line - 1], (path, item)


def test_source_is_stored_by_blob_and_checked_on_read(tmp_path: Path) -> None:
    store = EvidenceStore(str(tmp_path))
    analyzed = analyze_fixture(store=store)
    node = next(f for f in analyzed.graph.files if f.path == "src/auth/tokens.ts")
    assert node.blob is not None
    assert store.source(node.blob) == (FIXTURE / "src/auth/tokens.ts").read_bytes()

    # Tampered content on disk is never returned.
    stored = tmp_path / "blobs" / node.blob[:2] / node.blob
    stored.write_bytes(b"export const injected = true;\n")
    assert store.source(node.blob) is None


def test_index_survives_a_restart(tmp_path: Path) -> None:
    analyzed = analyze_fixture(store=EvidenceStore(str(tmp_path)))
    reopened = EvidenceStore(str(tmp_path))
    index = reopened.index(analyzed.key)
    assert index is not None
    assert "src/db/client.ts" in index.files


@pytest.mark.parametrize("bad", ["../../etc/passwd", "a" * 39, "A" * 40, "", "../" + "a" * 37])
def test_only_hex_shas_are_ever_turned_into_paths(tmp_path: Path, bad: str) -> None:
    assert EvidenceStore(str(tmp_path)).source(bad) is None


def test_memory_store_stays_within_its_byte_budget() -> None:
    store = EvidenceStore(None, memory_bytes=100)
    from app.analysis.evidence import RepositoryIndex

    contents = {f"f{i}.ts": bytes([65 + i]) * 40 for i in range(5)}
    store.put("k", RepositoryIndex(commit_sha="x", files={}), contents)
    kept = [c for c in contents.values() if store.source(blob_sha(c)) is not None]
    assert 0 < len(kept) <= 2
