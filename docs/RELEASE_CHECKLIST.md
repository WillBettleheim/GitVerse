# Release checklist: first public release

Status as of 16 November 2026. ✅ verified, ⚠️ done with a caveat, ⏳ needs the owner's action.

## Product

| Item | Status | Evidence |
| --- | --- | --- |
| Repository input, validation and error messages | ✅ | Live checks against the API; frontend tests |
| Real GitHub analysis (metadata, archive, parsing, graph) | ✅ | Live: pmndrs/zustand, honojs/hono; fixture tests with known graphs |
| 3D city, selection, camera, tooltips | ✅ | Browser checks on the production build; tests |
| Inspector, search, filters, insights, lenses, source links | ✅ | Browser checks; tests |
| Dependency graph view | ✅ | Browser check; screenshot |
| Git Time Travel: history, snapshots, comparison, animation | ✅ | Live on zustand; real-git fixture tests |
| AI Architect retrieval, citations, highlighting, focus, inspector link | ✅ | Live in evidence-only mode; offline evaluations |
| AI Architect answers from Claude | ⚠️ | Not run against the real model: no API key available. Scripted-model tests and a billed live evaluation exist |
| Demo mode clearly separated | ✅ | `provenance.kind: "demo"`, banner and "Sample" tag; tests |
| Responsive layout and reduced motion | ✅ | Browser checks at phone and desktop sizes |
| Error pages (404, error, global error) | ✅ | Added; built |

## Engineering

| Item | Status | Evidence |
| --- | --- | --- |
| `make check` (lint, types, backend and frontend tests, production build) | ✅ | See the release report |
| Docker images build and run healthy as non-root | ✅ | `docker compose up --build`; health checks; `id` in both containers |
| Production mode: API docs hidden, strict CSP without `unsafe-eval` | ✅ | Checked in the containers |
| Debug behaviour off in production | ✅ | Render probe only with `?perf`; uvicorn without `--reload` |
| Environment variables documented | ✅ | `backend/.env.example`, `frontend/.env.example`, docs/DEPLOYMENT.md |
| No secrets, local env files or build output tracked | ✅ | `git ls-files` reviewed |
| Dependency audits | ⚠️ | No known vulnerabilities in runtime dependencies; one moderate advisory in dev-only ESLint tooling (minimatch) whose only fix downgrades `eslint-config-next` |
| Graceful shutdown | ✅ | Lifespan cancels jobs and stops parser processes; 20 s grace in the image |
| Logging without secrets or repository content | ✅ | Reviewed |

## Security

| Item | Status |
| --- | --- |
| No execution of repository code | ✅ |
| Host allowlist, no redirects, validated URLs | ✅ |
| Archive limits and path-traversal protection | ✅ |
| Rate limits, concurrency caps, body limits, disk budgets | ✅ |
| Rate limits count real clients behind a proxy (`GITVERSE_CLIENT_IP_HEADER`) | ✅ |
| CORS limited to configured origins; wildcard ignored | ✅ |
| Security headers on API and frontend | ✅ |
| Credentials server-side only | ✅ |
| Prompt-injection containment | ✅ (offline) |
| Analysis isolated from the API process | ⚠️ Not yet: runs in the same container, as an unprivileged user |

## Owner actions before publishing

| Item | Status |
| --- | --- |
| Choose a license (none is included until you decide) | ⏳ |
| Commit and push the release preparation | ⏳ |
| Enable private vulnerability reporting in the GitHub repository settings (SECURITY.md points to it) | ⏳ |
| Set the GitHub repository description and topics | ⏳ |
| Create hosting accounts and approve their costs | ⏳ |
| Deploy the API and frontend (docs/DEPLOYMENT.md) | ⏳ |
| Optionally add an Anthropic API key and run the live evaluation | ⏳ |
