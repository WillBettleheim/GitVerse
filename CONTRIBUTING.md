# Contributing to GitVerse

Thanks for your interest. This guide covers how the project is organized, how to run it, and what
a change needs before it's merged.

## Set up

You need Node.js 20.17 or newer, Python 3.12 or 3.13, and GNU Make.

```bash
make setup   # installs dependencies and creates backend/.env and frontend/.env.local
make dev     # frontend on :3000, backend on :8000
```

## Project layout

```
frontend/   Next.js app: landing page, explorer, city layout and 3D scene
backend/    FastAPI app: ingestion, analysis, time travel, AI Architect
docs/       Architecture, security model, performance, deployment, release notes
scripts/    Development and screenshot scripts
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit and why.

## Before you open a pull request

```bash
make check
```

This runs Ruff, mypy (strict), ESLint, TypeScript, pytest, Vitest and the production build. It must
pass. Then:

- **Add tests for what you change.** Analysis changes need a fixture with a known answer.
  Frontend behaviour needs a test that would fail without the change.
- **Keep the CodeGraph contract in sync.** The backend writes
  `frontend/src/features/analysis/__fixtures__/analysis-sample.json` and the AI Architect answer
  sample; regenerate them with `UPDATE_FIXTURES=1 .venv/bin/pytest` in `backend/` and commit them
  with the schema change. Changing analysis output for the same commit also means bumping
  `ANALYZER_VERSION` in `backend/app/analysis/__init__.py`.
- **Update docs** when behaviour, configuration or limits change.

## Rules that aren't negotiable

- **Never execute repository code.** Analyzed repositories are parsed as text. No installs, builds,
  imports or evaluation of anything they contain.
- **Never present sample data as analysis.** Demo and generated data carry `provenance.kind: "demo"`
  and the interface labels it.
- **Never invent facts in the interface or in AI answers.** Every number comes from the graph;
  every file, line and relationship AI Architect shows is checked against the analysis.
- **Keep secrets on the server.** Nothing secret goes in a `NEXT_PUBLIC_` variable or the bundle.
- **Keep the layout deterministic.** `generateCity` has no randomness, clock or locale dependence.

## Style

- Backend: Ruff formats and lints (`make format`); mypy runs in strict mode.
- Frontend: ESLint; code is hand-formatted at about 100 columns.
- Write comments that explain why, in plain sentences. Name things for what they mean.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(city): …`, `fix(api): …`), one logical change per commit.

## Pinned backend dependencies

`backend/requirements.lock` pins the runtime dependencies the Docker image installs. After changing
`backend/pyproject.toml`, reinstall (`make setup`), run `make check`, and regenerate the lock from
the tested environment (see the comment at the top of the file).

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
