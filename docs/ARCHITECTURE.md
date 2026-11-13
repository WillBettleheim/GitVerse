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
                 │ ──▶ evidence index ──▶ AI Architect (retrieval ──▶ Claude ──▶ checks)│
                 │ [all built]                                                       │
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
  lib/graph/           CodeGraph schema, adjacency, file categories, importance, traversal and
                       cycles (Tarjan), search, insights, dependency graph layout
  lib/city/            Pure logic: layout, camera, highlight, arcs, quality. No React or WebGL
  features/city/       React Three Fiber scene
  features/explorer/   Explorer shell, panels, Zustand store
  features/architect/  AI Architect panel and its answer state
  lib/architect/       AI Architect API client and answer schema
  features/demo/       Sample data, stress-test generator, dataset switcher
  features/landing/    Landing page sections
  lib/config.ts        Validated public environment config
```

Graph-derived data is computed once per graph (cycles, insights, filter options) or once per
selection, depth and direction (traversal), and shared through `ExplorerDataProvider` and memoized
hooks. Nothing graph-wide is recomputed on hover or while the camera moves. Selection lives in one
store, so the city, file list, inspector, breadcrumbs and graph view always agree.

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

## Git time travel [built]

Real history only. Nothing about past states is simulated: every historical city is a full analysis
of the repository at that commit, downloaded at its exact SHA.

**Endpoints**

- `GET /api/v1/history?repository=&page=` lists the default branch, newest first, 30 commits a page
  for up to 10 pages (the last 300 commits). Pages are cached for five minutes.
- `POST /api/v1/analyses` takes an optional `commit` (a full SHA). A commit that's already cached is
  returned immediately, with no GitHub calls, and doesn't count against the rate limit.
- `DELETE /api/v1/analyses/{id}` cancels an analysis that hasn't started. A running one finishes,
  since its parsing thread can't be stopped safely, and its result is cached for next time.
- `GET /api/v1/compare?repository=&base=&head=` diffs two analyzed commits (409 until both are).

**Not every commit is analyzed.** The frontend analyzes six commits evenly spaced through the first
page, two at a time, and any other commit only when someone selects it. Playback steps through
analyzed commits only. Each new snapshot costs two GitHub API calls plus an archive download.

**Identity.** Every file carries its git blob SHA, computed exactly as git does, so "unchanged" means
byte-for-byte identical and is never inferred from metrics. Files are matched across commits by
path.

**Rename detection, and its limits.** Renames come from two sources, and the diff says which:

1. GitHub's comparison API, which detects renames by content similarity, so it also finds files
   that were renamed and edited. GitHub lists at most 300 changed files. Past that the list is cut
   off, renames in the rest are unknown, and the diff marks rename detection as incomplete.
2. Exact content: a removed file and an added file with the same blob SHA are a move, if the match
   is one-to-one. This works without GitHub, but can't see a rename that also changed content.
   That case shows as one file removed and one added.

Renamed files keep their identity in the animation and in dependency comparisons: an import of a
moved file isn't reported as a dependency change.

**Interpretation.** Commit messages are displayed as the author wrote them, labelled as such.
GitVerse doesn't say why anything changed.

**Animation.** `lib/timetravel/transition.ts` builds a plan from two city layouts: each building's
tiers interpolate between their old and new boxes, added files grow from the ground and removed
ones sink, districts expand or collapse, and removed and added dependency arcs cross-fade. Each
frame only rewrites instance matrices. The camera keeps whatever angle the user chose; without a
user camera move, each new layout is re-framed from the current angle. Reduced motion skips the
animation and shows the result directly.

## AI Architect [built]

Questions in plain language about one analyzed commit, answered from evidence GitVerse gathered
itself. It explains architecture; it isn't a general chatbot, and it never sees the whole repository.

**What it may quote.** When a commit is analyzed, the pipeline also saves an evidence index: each
file's top-level declarations and class methods with their exact line spans, and each import with
its line and where it resolved. Source is stored by git blob SHA, so commits share copies, and is
checked against that SHA every time it's read, so a quoted line is exactly what the commit holds.
Answering a question needs no GitHub calls and no archive download.

**Flow** (`POST /api/v1/architect/questions`, `backend/app/assistant/`):

1. **Retrieve** (`retrieval.py`, deterministic). The question is split into words, with related
   words for common concepts (asking about authentication also searches `login`, `session`,
   `token`, `jwt` and so on). Files are scored on their name, their folder, their declarations and
   the packages they import (`jsonwebtoken` suggests authentication). A file needs a real match to
   count; related words alone don't qualify it. The question type adds graph facts: the most
   connected files, a file's importers with each import's line (and what depends on it
   indirectly), import cycles with their edges and whether they're type-only, a structural
   overview, and, given other analyzed commits, what changed between them. A selected file or a
   path in the question becomes the subject of "this module".
2. **Bound.** At most 8 files, 6 source excerpts of up to 40 lines, 16,000 characters of quoted
   source, and a full file list only for repositories of 300 files or fewer. The finished prompt
   is checked against a hard ceiling before sending. A 1,500-file repository stays well under it.
3. **Short-circuit.** If nothing relates to the question, the answer says so, lists what was
   searched, and no model is called.
4. **Ask** (`llm.py`). One request to `claude-opus-5-5` through the Anthropic SDK, server side.
   Structured output (a JSON schema) returns the answer, claims each marked verified or inferred
   with the evidence ids they rest on, relevant files, relationships, and an uncertainty note.
   Effort is set explicitly (medium by default). Server-side fallback (`fallbacks: "default"`)
   lets the API retry a declined request on Anthropic's recommended fallback model, and the answer
   says when that happened. The model gets no tools.
5. **Check** (`validate.py`). Before anyone sees the answer: files not in the analysis are removed;
   relationships are kept only if the import exists, and carry the analysis's line; citations of
   evidence that wasn't supplied are dropped; a "verified" claim left without evidence becomes
   "inferred" and is marked as relabelled; paths in the prose that aren't in the analysis are
   flagged. Line links come only from evidence, never from the model's text. Everything removed or
   changed is listed in the answer's notes.

**Without an API key**, the same endpoint returns the retrieved evidence, ranked and labelled as
evidence only, with no explanation written on top. `/api/v1/meta` reports whether AI explanations
are on.

**In the explorer**, AI Architect is a tab beside the inspector, for real analyses only. An
answer's files light up in the city (pink), its relationships are drawn as arcs where the import
really exists, "Focus camera" frames those buildings from the current angle, and each file opens
in the inspector or on GitHub at the exact lines, pinned to the analyzed commit. Selecting a file
makes it the subject of the next question. Answers stay tied to the commit they were asked about.

**Evaluations.** `backend/tests/fixtures/repos/architect-app` is a small Express API whose answers
are known: authentication in `src/auth` and `src/middleware/auth.ts`, routes in `src/routes`, a
runtime import cycle between `src/auth/session.ts` and `src/services/userService.ts`, and a
prompt-injection comment in `src/lib/logger.ts`. `tests/architect_cases.py` holds the cases.
`test_architect_eval.py` checks, with no network: that retrieval finds each known answer; that
every excerpt is verbatim with correct line numbers and every import line points at that import;
that invented files, relationships and citations are removed; that unsupported questions get an
honest no without a model call; that repository text is quoted as untrusted; and that prompts stay
bounded on a large repository. `test_architect_live_eval.py` grades the real model on the same
cases. It's billed, so it only runs with `GITVERSE_RUN_LIVE_EVALS=1` and a key.

**Limits.** Retrieval matches words, related words and structure. It has no embeddings, so a
concept named in ways it doesn't know can be missed; the answer then says the evidence is
insufficient rather than guessing. It sees what the analysis sees: JavaScript and TypeScript
structure, not runtime behavior, configuration values or other languages. Each question stands
alone; follow-ups don't carry the previous answer.

## Backend layout [built]

```
backend/app/
  main.py              App factory: HTTP client, job manager, middleware
  core/config.py       Environment settings and analysis limits
  core/middleware.py   Request body size limits
  core/ratelimit.py    Per-client sliding-window limit for new analyses
  api/routes.py        /health, /api/v1/meta, /api/v1/analyses
  api/history.py       /api/v1/history, /api/v1/compare
  api/architect.py     /api/v1/architect/questions
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
  analysis/evidence.py Symbol and import index, and source stored by blob SHA
  assistant/           AI Architect: retrieval, prompt, Claude client, answer checks, service
  schemas/assistant.py AI Architect request and answer contract
```

The backend's fixture test writes `frontend/src/features/analysis/__fixtures__/analysis-sample.json`
(`UPDATE_FIXTURES=1`), and the frontend's tests parse it, so the two schemas can't drift apart.
`frontend/src/features/architect/__fixtures__/answer-sample.json` does the same for AI Architect's
answer format.

## Security model for untrusted repositories

Every repository is hostile input. **Repository code is parsed as text and never executed.**

Built and tested:

- `parse_repo_ref` is the only route from user input to a URL. It allowlists host, owner and name,
  and rejects credentials, ports, traversal and leading-dash option injection.
- Requests go only to `api.github.com` and `codeload.github.com`, over https, with URLs built from
  validated parts and a 40-hex commit SHA. Redirects are never followed: a renamed repository is
  reported, not chased.
- Nothing from the repository is executed, and no dependencies are installed. Tar entries are
  read into memory; symlinks, hard links and devices are skipped; any absolute or `..` path rejects
  the archive. The only repository content written to disk is analyzed source, saved as inert
  bytes for AI Architect to quote, under a name that is its validated blob SHA, and checked
  against that SHA when read.
- Limits on download size, archive entries, source files, per-file size, total source, declared
  unpacked size (a decompression-bomb guard) and wall-clock time. Too many files fails clearly
  instead of silently truncating.
- At most `GITVERSE_MAX_CONCURRENT_ANALYSES` run at once, with a bounded queue (503 when full).
  New analyses are rate limited per client address (429 with `Retry-After`). Requests that join an
  analysis already running aren't counted.
- Users see only prepared error messages. Unexpected exceptions are logged server-side and reported
  as a generic failure.
- Request bodies are capped, and a declared `Content-Length` is required.
- **AI Architect** treats source, comments, descriptions and commit messages as untrusted. They're
  quoted to the model inside `<untrusted>` tags it is told never to obey, and any tag-like text
  inside them is defused so they can't close the block. That's one layer; the others don't rely on
  the model. It has no tools, so it can't run commands or read files. It sees only the bounded
  evidence for one question, from the commit asked about. Every file, line and relationship in its
  answer is checked against the analysis, so a model that obeyed injected text still couldn't
  introduce a file or dependency. The API key stays on the server and is never sent to the
  browser. Questions are capped at 500 characters, rate limited per client
  (`GITVERSE_ARCHITECT_REQUESTS_PER_MINUTE`), and limited to
  `GITVERSE_MAX_CONCURRENT_ARCHITECT` model calls at once (503 when busy). Model errors become
  prepared messages; details are logged only.

Not yet built:

- **Process isolation.** Parsing runs in a worker thread of the API process. Its deadline is
  cooperative, checked between files, and memory isn't capped. Running analysis in a separate
  container with CPU and memory limits and no credentials is the next hardening step.
- The rate limiter and job store are in memory and per process, so they reset on restart and don't
  share state across instances.
- The client address comes straight from the connection. Behind a proxy, every client would share
  one address until trusted forwarding headers are configured.
- AI Architect's evidence store has no size cap or expiry on disk yet. Clearing
  `.cache/evidence` is safe: answers fall back to the graph, without excerpts or line numbers,
  until the commit is analyzed again.
