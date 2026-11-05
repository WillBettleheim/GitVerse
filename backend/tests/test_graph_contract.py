"""Keeps the frontend's graph data and this backend's schema in agreement."""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas.graph import CodeGraph

DEMO_GRAPH = Path(__file__).resolve().parents[2] / "frontend/src/features/demo/demo-graph.json"


def _graph() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(DEMO_GRAPH.read_text())
    return data


def test_frontend_demo_graph_satisfies_backend_schema() -> None:
    graph = CodeGraph.model_validate(_graph())
    assert graph.files
    assert graph.edges


def test_demo_graph_is_labelled_as_demo() -> None:
    assert CodeGraph.model_validate(_graph()).provenance.kind == "demo"


def test_rejects_edge_to_unknown_file() -> None:
    data = _graph()
    data["edges"].append({"source": data["files"][0]["id"], "target": "nope", "kind": "import"})
    with pytest.raises(ValidationError, match="unknown file"):
        CodeGraph.model_validate(data)


def test_rejects_duplicate_file_ids() -> None:
    data = _graph()
    data["files"].append(data["files"][0])
    with pytest.raises(ValidationError, match="unique"):
        CodeGraph.model_validate(data)


@pytest.mark.parametrize("path", ["/etc/passwd", "../secret", "a/../b", "a//b", "a\\b", "./a"])
def test_rejects_unsafe_paths(path: str) -> None:
    data = _graph()
    data["files"][0]["path"] = path
    with pytest.raises(ValidationError, match="clean relative"):
        CodeGraph.model_validate(data)
