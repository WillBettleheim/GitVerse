# GitVerse

**Explore Code Like a Universe.**

GitVerse turns a code repository into a 3D city. Folders become districts, files become buildings,
complexity shapes the skyline, and imports become glowing connections.

> **Status:** analyzes public JavaScript and TypeScript repositories from GitHub and builds a city
> from the real dependency graph. A clearly labelled demo city works without the backend.

## Quick start

You need:

- Node.js 20.17 or newer (tested on 20.17)
- Python 3.12 or 3.13 (tested on 3.13)
- GNU Make

```bash
make setup
```

```bash
make dev
```

Then open:

| URL | What it is |
| --- | --- |
| http://localhost:3000 | Landing page |
| http://localhost:3000/explore/demo | Explorer in demo mode |
| http://localhost:8000/docs | Interactive API docs |

Demo mode doesn't need the backend. To run only the frontend, use `make dev-frontend`.

## Commands

| Command | What it does |
| --- | --- |
| `make setup` | Installs dependencies and creates local env files |
| `make dev` | Runs frontend and backend together |
| `make dev-frontend` / `make dev-backend` | Runs one side only |
| `make test` | Runs pytest and Vitest |
| `make lint` | Runs Ruff and ESLint |
| `make typecheck` | Runs mypy (strict) and TypeScript |
| `make build` | Builds the frontend for production |
| `make check` | Runs lint, typecheck, test and build |
| `make format` | Auto-formats backend code |

## What works today

- **Landing page** with a live 3D city rendered from the sample graph
- **Explorer** at `/explore/demo`, an isometric city generated from the graph:
  - Nested districts, procedural buildings with a distinct look per file type, and beacons on key modules
  - Orbit, zoom and pan, with smooth camera transitions
  - Hover for a file tooltip; select by clicking a building or using the file list
  - Trace imports (cyan) and importers (violet), with arrowheads and pulses showing direction
  - Fit to city (`F`), reset view (`R`), clear selection (`Esc`), and an optional cinematic overview
  - Respects reduced motion, and adapts quality to the device
- **Architecture tools** in the explorer:
  - File inspector: path breadcrumbs, language, lines, functions, classes, exports, complexity,
    imports and importers, cycle membership, and a GitHub link pinned to the analyzed commit
  - Dependency mode: imports, importers or both, 1 to 3 hops or everything reachable, with cycle
    members marked; shown in the city, as a list, or as a left-to-right graph
  - Search by name or path, filtered by folder, language, lines, complexity and importer count,
    with matches lit in the city
  - Insights: files, edges, cycles, most depended-upon files, largest modules, complexity hotspots
    and how code is spread across folders, all counted from the graph
- **Stress-test cities** with generated data, at `/explore/demo/stress/100`, `/500` and `/1000`
- **Deterministic city layout**: the same graph always builds the same city, whatever the input order
- **Real repository analysis**: paste a public GitHub URL on the landing page. The backend fetches
  one commit, parses JS/JSX/TS/TSX with Tree-sitter, resolves imports, and builds a NetworkX graph
  with cycles, hubs, external packages and unresolved imports. Results are cached per commit.
- **API**: `/health`, `/api/v1/meta`, and `/api/v1/analyses` with progress polling, limits, rate
  limiting and concurrency control

## What isn't built yet

- Languages other than JavaScript and TypeScript
- Workspace packages in monorepos (cross-package imports appear as external packages)
- Running analysis in an isolated container
- Git history and city evolution
- Claude explanations
- PostgreSQL persistence

The demo cities come from `frontend/src/features/demo`: hand-written data for a fictional project,
and generated stress-test data. The explorer always labels both as sample data. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the security model.

## Configuration

`make setup` copies each template to its local file. Local files are git-ignored.

| Template | Local file | Holds |
| --- | --- | --- |
| `frontend/.env.example` | `frontend/.env.local` | API URL |
| `backend/.env.example` | `backend/.env` | CORS, analysis limits, concurrency, rate limit, cache folder, GitHub token |

## Repository layout

```
frontend/   Next.js app: landing page, explorer, city layout and 3D scene
backend/    FastAPI app: API routes, validation, CodeGraph schema
docs/       Architecture and security model
scripts/    Development scripts
```

## Troubleshooting

**"GitHub's rate limit for this server has been reached."** Without a token, GitHub allows 60 API
requests an hour, and each analysis uses two. Set `GITVERSE_GITHUB_TOKEN` in `backend/.env` to a
token with no scopes (read-only public access) to raise it to 5,000.

**A Tailwind or `magic-string` error mentions `require() of ES Module`, or an old error persists
after fixing it.** Turbopack caches errors on disk. Stop the server and delete the cache:

```bash
rm -rf frontend/.next
```

**Why does `frontend/package.json` override `magic-string`, and why is jsdom pinned to 25?** Newer
versions of both need Node's `require(esm)` support, which Node 20.17 doesn't have. Both pins can go
once the project moves to Node 22.12 or newer.
