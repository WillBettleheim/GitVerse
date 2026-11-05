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
| Directory | District | A raised plot, nested inside its parent's. Folders that only wrap one subfolder are collapsed |
| File | Building | Footprint from lines of code, height from complexity, both log-normalized against this graph |
| File type | Facade and massing | Derived from the path: source, test, config, docs, style, data |
| Central module | Landmark | Top 5% by importance, at most 40, with at least 2 importers. Gets setbacks and a beacon |
| Import | Connection | Directional arc between rooftops |

`frontend/src/lib/city/layout.ts` packs recursively with a skyline packer, trying a few target
widths and keeping the most compact. Inputs are sorted by code unit, never `localeCompare`, so
results don't vary by machine. Coordinates are rounded to fixed precision. Per-file variation comes
from a hash of the file ID, and district colour from a hash of the path, so neither depends on input
order or on what else is in the repository. Building IDs are file IDs.

Normalizing against the graph means **a file's height can change when the repository's maximum
changes**, and adding files can shift positions, because the packer re-runs. Layout is deterministic
for a given graph, but not stable across different versions of a repository.

Importance (`lib/graph/metrics.ts`) is a heuristic: mainly fan-in, then complexity, size and
fan-out, with tests discounted. It uses direct imports only.

## Rendering [built]

Draw calls stay constant as file count grows: one instanced mesh each for buildings, plates, beacons
and ground glow, plus one line geometry for ambient connections. Selecting a file adds two: its
connection tubes and arrowheads.

Measured in development on this project's Mac at 1440×900, with the browser pane hidden:

| Files | Draw calls | Triangles | Frames while idle | Frames during cinematic |
| --- | --- | --- | --- | --- |
| 100 | 7 | 2.7k | 0 | not measured |
| 500 | 7 | 12k | 0 | 60 fps |
| 1,000 | 7 | 24k | 0 | 60 fps |

**Rendering:** on demand, so an idle city renders nothing. It runs continuously only for the hero,
cinematic flights and connection pulses, and stops when off-screen.

**Quality:** `lib/city/quality.ts` picks a tier from what the browser reports, and `FrameGovernor`
steps it down if real frames are too slow. It never steps back up, because a tier that oscillates is
more distracting than a softer image. Tiers control pixel ratio, arc detail, how many connections
show, label count and ground glow.

**Visual limits:** past 5,000 files, the least important aren't drawn and the toolbar says how many
were cut. Past each tier's connection limit, only those between the most important files show, and
the toolbar says so. Selecting a file always shows all its own connections, up to 240.

**Camera:** true orthographic isometric view. All pose maths is in `lib/city/camera.ts` with no
Three.js dependency, and its tests check the results against a real Three.js camera.

## Frontend layout [built]

```
frontend/src/
  app/                 Routes: / (landing), /explore/demo, /explore/demo/stress/[size]
  lib/graph/           CodeGraph schema, adjacency, file categories, importance
  lib/city/            Pure logic: layout, camera, highlight, arcs, quality. No React or WebGL
  features/city/       React Three Fiber scene
  features/explorer/   Explorer shell, panels, Zustand store
  features/demo/       Sample data, stress-test generator, dataset switcher
  features/landing/    Landing page sections
  lib/config.ts        Validated public environment config
```

The 3D scene is loaded client-only. The explorer knows nothing about sample data: demo pages pass
it a graph and a dataset switcher, as a real analysis page will pass it a real graph.

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
