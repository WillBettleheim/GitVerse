# GitVerse architecture

Status markers: **[built]** exists and is tested. **[planned]** is design only.

## System overview

```
                 ┌───────────────────────── Next.js frontend ───────────────────────┐
 demo-graph.json │                                                                  │
 [built] ───────▶│  CodeGraph ──▶ generateCity() ──▶ CityLayout ──▶ React Three     │
                 │  (validated)    pure, deterministic   plain data     Fiber scene │
                 └───────▲──────────────────────────────────────────────────────────┘
                         │ CodeGraph JSON  (same contract)
                 ┌───────┴──────────────── FastAPI backend ─────────────────────────┐
                 │ repo ref validation [built] ──▶ sandboxed clone [planned]        │
                 │ ──▶ Tree-sitter parse [planned] ──▶ NetworkX graph [planned]     │
                 │ ──▶ git history [planned] ──▶ Claude explanations [planned]      │
                 └──────────────────────────────────────────────────────────────────┘
```

## Principles

1. **One contract.** Everything the renderer sees is a `CodeGraph`. Demo data and real analysis
   go through the same validation and layout code, so demo mode exercises the real path.
2. **Provenance travels with the data.** `provenance.kind` is `"demo"` or `"analysis"`, and the UI
   derives its sample-data labelling from that field. Nothing can look like real analysis
   unless the data says it is, and only the pipeline may set `"analysis"`.
3. **Layout is a pure function.** `generateCity(graph)` has no randomness, clock or locale
   dependence. The renderer only draws its output, so determinism is unit-testable with no WebGL.
4. **Honest unavailability.** `POST /api/v1/analyses` returns 501 until analysis exists. It never
   returns a stubbed graph.

## The CodeGraph contract [built]

Defined twice and kept in agreement by a contract test:

- `frontend/src/lib/graph/schema.ts` (Zod, validates at the boundary)
- `backend/app/schemas/graph.py` (Pydantic, `tests/test_graph_contract.py` validates the
  frontend's demo data against it)

```jsonc
{
  "schemaVersion": 1,
  "provenance": { "kind": "demo", "repository": "...", "note": "..." },
  "files": [{ "id": "src/a.ts", "path": "src/a.ts", "language": "typescript", "loc": 120, "complexity": 9 }],
  "edges": [{ "source": "src/a.ts", "target": "src/b.ts", "kind": "import" }]
}
```

The schema covers only what is rendered today. Commit history gets added when that feature lands.

## City generation [built]

| Code concept | City element | Rule |
| --- | --- | --- |
| Directory | District | One district per directory that directly holds files |
| File | Building | Footprint grows with lines of code, height grows with complexity |
| Import | Connection | Arc between rooftops |

`frontend/src/lib/city/layout.ts` packs buildings into districts and districts into the city with
shelf packing. Inputs are sorted by code unit, never `localeCompare`, so results don't vary by
machine. Coordinates are rounded to fixed precision. District colour comes from a hash of the
path, so a district keeps its colour as the repository changes.

**Known limit:** districts are flat. Nested directories are placed as separate siblings, not inside
their parents. A nested treemap should replace this before large real repositories are loaded.

## Frontend layout [built]

```
frontend/src/
  app/                 Routes: / (landing), /explore/demo (explorer)
  lib/graph/           CodeGraph schema and adjacency queries
  lib/city/            Pure layout: no React, no Three.js
  features/city/       React Three Fiber scene
  features/explorer/   Explorer shell, panels, Zustand store
  features/demo/       Demo data and its loader
  features/landing/    Landing page sections
  lib/config.ts        Validated public environment config
```

The 3D scene is loaded client-only. Buildings are one instanced mesh and connections one line
geometry, so draw calls stay flat as file count grows.

## Backend layout [built]

```
backend/app/
  main.py              App factory, middleware wiring
  core/config.py       Environment settings and analysis limits
  core/middleware.py   Request body size limits
  api/routes.py        /health, /api/v1/meta, /api/v1/analyses (501)
  schemas/graph.py     CodeGraph contract
  services/repo_ref.py Allowlist parser for user-supplied repository references
```

Tree-sitter, NetworkX, PostgreSQL and the Anthropic SDK aren't installed yet. They get added along
with the code that uses them.

## Security model for untrusted repositories

Every repository is hostile input. **Repository code is parsed as text and never executed.**

Built:

- `parse_repo_ref` is the only route from user input to a clone URL. It allowlists host, owner and
  name, and rejects credentials, ports, traversal and leading-dash option injection.
- Request bodies are capped, and a declared `Content-Length` is required.
- Limits are defined and published by `/api/v1/meta`.

Planned, and required before the clone step ships:

- Clone with `--depth`, `--no-tags`, `--single-branch`, `--no-recurse-submodules`, with hooks
  disabled (`core.hooksPath=/dev/null`), LFS smudge disabled, a `--` argument separator and
  `GIT_TERMINAL_PROMPT=0`.
- Check repository size through the GitHub API before cloning, and enforce disk, file count, file
  size and wall-clock limits during it.
- Never follow symlinks. Resolve every path and confirm it stays inside the working directory.
- Never install dependencies or run build scripts, tests or anything else from the repository.
- Run the worker in a container with no credentials, a read-only root, CPU and memory limits and
  restricted egress. Delete the working directory afterwards.
- Parse in a killable subprocess, with per-file timeouts, since parsers can hang on adversarial input.
- Treat repository contents as untrusted when sending them to Claude: they are data that may contain
  prompt injection, and any AI output must be labelled as AI-generated.
