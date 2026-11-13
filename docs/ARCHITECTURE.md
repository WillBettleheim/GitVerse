# GitVerse architecture

Status markers: **[built]** exists and is tested. **[planned]** is design only.

## System overview

```
                 ┌───────────────────────── Next.js frontend ───────────────────────┐
 demo + analysis │                                                                  │
 [built] ───────▶│  CodeGraph ──▶ generateCity() ──▶ CityLayout ──▶ React Three     │
                 │  (validated)    pure, deterministic   plain data     Fiber scene │
                 └───────▲──────────────────────────────────────────────────────────┘
                         │ CodeGraph JSON  (same contract)
                 ┌───────┴──────────────── FastAPI backend ─────────────────────────┐
                 │ repo ref validation ──▶ GitHub archive (in memory) ──▶ Tree-sitter │
                 │ ──▶ import resolution ──▶ NetworkX graph ──▶ cached CodeGraph     │
                 │ [all built]   git history [planned]   Claude explanations [planned]│
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

## Analysis pipeline [built]

`POST /api/v1/analyses` validates the reference and starts a background job, then
`GET /api/v1/analyses/{id}` reports progress and `GET /api/v1/analyses/{id}/graph` returns the
CodeGraph. The pipeline:

1. **Identify.** Fetch repository metadata from `api.github.com` and resolve the default branch to
   a commit SHA. Private repositories are refused.
2. **Cache check.** Results are keyed by repository, commit SHA and analyzer version, in memory and
   on disk (`GITVERSE_CACHE_DIR`). A commit never changes, so a hit is always valid.
3. **Download.** Stream `codeload.github.com/{owner}/{name}/tar.gz/{sha}`, stopping at the size limit.
4. **Read.** Walk the tarball in memory (`analysis/archive.py`). Only regular `.ts .tsx .mts .cts
   .js .jsx .mjs .cjs` files are read. Declaration files, minified code, `node_modules`, build
   output and oversized files are skipped and counted.
5. **Parse.** Tree-sitter (`analysis/parser.py`) extracts imports (static, type-only, re-export,
   `require`, dynamic `import()`), exports, functions, classes, lines of code (lines with a non-comment
   token) and file-level cyclomatic complexity (1 + each `if`, loop, `case`, `catch`, ternary, `&&`,
   `||`, `??`).
6. **Resolve.** `analysis/resolver.py` classifies every import as internal, external package, Node
   builtin, asset, declaration, skipped or unresolved, with a reason for unresolved ones.
7. **Graph.** NetworkX builds the internal dependency graph. Cycles are strongly connected
   components, marked type-only when every edge in them is. Hubs are ranked by imports in plus out.

### Resolution rules

Supported: relative paths with extension and `index` lookup, TypeScript's convention of writing `.js`
for a `.ts` file, and `baseUrl` and `paths` from the nearest tsconfig.json or jsconfig.json,
following local `extends`. Inherited `paths` are rebased onto a child's `baseUrl`, as `tsc` does.

Not supported, so these are reported as external or unresolved rather than guessed: package.json
`exports` and `imports`, **workspace packages in monorepos** (an import of a sibling package by name
is listed as an external package), bundler aliases outside tsconfig, and non-literal specifiers
such as `require(name)`, which are ignored.

## Backend layout [built]

```
backend/app/
  main.py              App factory: HTTP client, job manager, middleware
  core/config.py       Environment settings and analysis limits
  core/middleware.py   Request body size limits
  core/ratelimit.py    Per-client sliding-window limit for new analyses
  api/routes.py        /health, /api/v1/meta, /api/v1/analyses
  schemas/graph.py     CodeGraph contract
  services/repo_ref.py Allowlist parser for user-supplied repository references
  analysis/github.py   GitHub client: two fixed hosts, no redirects
  analysis/archive.py  In-memory tarball reader with limits
  analysis/parser.py   Tree-sitter extraction
  analysis/resolver.py JS/TS import resolution
  analysis/graph.py    NetworkX graph, cycles, hubs, CodeGraph output
  analysis/pipeline.py Orchestration
  analysis/jobs.py     Background jobs, concurrency, de-duplication
  analysis/cache.py    Memory and disk result cache
```

The backend's fixture test writes `frontend/src/features/analysis/__fixtures__/analysis-sample.json`
(`UPDATE_FIXTURES=1`), and the frontend's tests parse it, so the two schemas can't drift apart.

## Security model for untrusted repositories

Every repository is hostile input. **Repository code is parsed as text and never executed.**

Built and tested:

- `parse_repo_ref` is the only route from user input to a URL. It allowlists host, owner and name,
  and rejects credentials, ports, traversal and leading-dash option injection.
- Requests go only to `api.github.com` and `codeload.github.com`, over https, with URLs built from
  validated parts and a 40-hex commit SHA. Redirects are never followed: a renamed repository is
  reported, not chased.
- Nothing from the repository is written to disk or executed, and no dependencies are installed.
  Tar entries are read into memory; symlinks, hard links and devices are skipped; any absolute or
  `..` path rejects the archive.
- Limits on download size, archive entries, source files, per-file size, total source, declared
  unpacked size (a decompression-bomb guard) and wall-clock time. Too many files fails clearly
  instead of silently truncating.
- At most `GITVERSE_MAX_CONCURRENT_ANALYSES` run at once, with a bounded queue (503 when full).
  New analyses are rate limited per client address (429 with `Retry-After`). Requests that join an
  analysis already running aren't counted.
- Users see only prepared error messages. Unexpected exceptions are logged server-side and reported
  as a generic failure.
- Request bodies are capped, and a declared `Content-Length` is required.

Not yet built:

- **Process isolation.** Parsing runs in a worker thread of the API process. Its deadline is
  cooperative, checked between files, and memory isn't capped. Running analysis in a separate
  container with CPU and memory limits and no credentials is the next hardening step.
- The rate limiter and job store are in memory and per process, so they reset on restart and don't
  share state across instances.
- The client address comes straight from the connection. Behind a proxy, every client would share
  one address until trusted forwarding headers are configured.
- Claude explanations will need to treat repository contents as untrusted input, since they can
  carry prompt injection, and label their output as AI-generated.
