# Performance

Measured on 16 November 2026. Every number below was collected by the scripts named with it;
nothing is estimated. Synthetic results come from generated, seeded graphs and repositories and
are labelled as such. Real-repository results name the repository and commit.

## Environment

- Apple M4 (10 cores), 16 GB memory, macOS 26.5.1
- Node 20.17.0, Python 3.13.6
- Google Chrome in new-headless mode, GPU rendering through ANGLE on Metal, 1440×900 at 2×
- Frontend: production build (`next build && next start`). Backend: uvicorn, single process.

Results describe this machine. A laptop on battery, a tablet or a phone will be slower.

## How to reproduce

| What | Command |
| --- | --- |
| Frontend CPU pipeline (synthetic) | `npm run bench` in `frontend/` |
| Rendering in Chrome (synthetic) | `npm run build && npm run start`, then `node --experimental-websocket bench/browser.bench.mjs` in `frontend/`. `BENCH_UNCAPPED=1` turns off vsync to show headroom; `BENCH_LOW_POWER=1` measures low power mode. |
| Analysis pipeline (synthetic) | `.venv/bin/python -m bench.analysis_bench` in `backend/` |
| Event loop while analyzing (synthetic) | `.venv/bin/python -m bench.responsiveness_bench` in `backend/` |
| Real repository, 1 core vs pool | `.venv/bin/python -m bench.real_repo_bench honojs/hono` in `backend/` |

Production pages report frame times and renderer counters only with `?perf` in the URL.

## Results

### Backend analysis (synthetic repositories, median of 3 runs, ms)

| Files | Parse, before (1 core) | Parse, after (4 workers) | Whole analysis, before | After |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 22 | 22 (below the pool threshold) | 27 | 28 |
| 500 | 115 | 33 | 139 | 59 |
| 1,000 | 228 | 63 | 278 | 115 |
| 2,500 | 568 | 159 | 698 | 291 |
| 5,000 | 1,158 | 329 | 1,502 | 706 |

Parallel output is checked to be identical to single-core parsing on every run.

**Real repository:** honojs/hono at `f6fbaf0` (452 source files, 1,035 imports): analysis took
486 ms on one core and 165 ms with the pool, with identical graphs. pmndrs/zustand (50 files) is
under the pool threshold: 57 ms and 55 ms. Downloading either from GitHub took about 2 s, which
now dominates.

**Event loop during a 5,000-file analysis** (how late a 5 ms timer fires, which is what other
requests wait): before, median 13.2 ms, p95 13.2 ms, max 24.7 ms. After, median 1.3 ms,
p95 15.9 ms, max 29.4 ms. Parsing no longer blocks other requests; the graph-building steps
that follow still run in the API process and cause the remaining tail.

### API response size

| Graph | Uncompressed | Compressed (gzip, now on) |
| --- | ---: | ---: |
| pmndrs/zustand, real | 27,933 bytes | 4,354 bytes |
| 5,000 files, synthetic | 3,440 KB | 317 KB |

### Frontend CPU (synthetic graphs, median of 7 runs, ms)

| Files | Parse + validate | City layout | Cycles | Insights | Search | Transition plan |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.6 | 0.6 | 0.1 | 0.1 | 0.0 | 0.1 |
| 1,000 | 1.7 | 3.6 | 0.8 | 0.9 | 0.1 | 0.5 |
| 5,000 | 8.1 | 19.9 | 2.6 | 4.6 | 0.5 | 1.8 |

These stay well under a frame at every size, so nothing here was changed.

### Rendering (synthetic stress cities, Chrome, 5 s of continuous orbit)

| Files | Draw calls | Triangles | fps, vsync on | fps, vsync off | p99 frame, vsync off | JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 7 | 2,686 | 60 | 617 | 3.2 ms | 12 MB |
| 1,000 | 7 | 24,046 | 60 | 499 | 2.7 ms | 24 MB |
| 2,500 | 7 | 59,410 | 60 | 634 | 5.4 ms | 29 MB |
| 5,000 | 7 | 114,594 | 60 | 612 | 5.6 ms | 39 MB |

Before and after match within noise: the renderer was already instanced (one draw call per kind
of mesh), and measurement showed no rendering bottleneck on this machine, so it wasn't changed.
2,500 files and up start at medium quality (fewer ambient arcs) by design, for weaker devices.
The first frame appeared 0.4 to 0.7 s after navigation. Selecting the most connected file and
drawing its arcs took 8 to 19 ms.

**Low power mode** at 5,000 files: 6 draw calls instead of 7, 900 arc line segments instead of
6,000, 36 MB heap instead of 39 to 42 MB, and when idle no continuous rendering at all, because
cinematic flight and arc pulses are off and the city renders only when something changes.

## Changes made

- **Parsing in worker processes** (`backend/app/analysis/parallel.py`) for repositories of 150
  files or more, up to 4 workers by default (`GITVERSE_PARSE_WORKERS`). Falls back to in-process
  parsing if a worker dies, and honours the analysis deadline.
- **Compressed responses** for anything over 2 KB.
- **AI Architect shares answers:** identical questions about the same commit, subject and
  history reuse one answer for 15 minutes, and concurrent duplicates wait for the first. Failures
  are never reused. Evidence and checks are unchanged.
- **Time travel races fixed:** a slow comparison from an earlier click can no longer replace a
  later selection, the earlier request is cancelled, and analyses queued for commits the user has
  already moved past are dropped before they start.
- **Low power mode** in the canvas toolbar: lowest rendering tier, no cinematic flight, no arc
  pulses, no atmosphere layer, opaque panels instead of blurred glass. Remembered per browser.
  Search, inspector, lenses, time travel and AI Architect all stay available.
- **Measurement:** the opt-in `?perf` probe, the benchmark scripts above, and stress cities of
  2,500 and 5,000 files.

## Known limitations

- Frame rates are from one fast machine. The adaptive quality governor exists for slower ones,
  but no slower device was measured.
- Graph building and evidence indexing still run in the API process after parsing, which is the
  remaining event-loop tail of up to about 30 ms during a 5,000-file analysis.
- The analyzer accepts at most 4,000 source files by default. The 5,000-file backend benchmark
  raises that limit to measure scaling.
- GitHub download time dominates real analyses and isn't something GitVerse controls.
- Cities draw up to 5,000 buildings. Beyond that, the most important files are drawn and the rest
  remain in the file list, search and inspector, with a note saying how many aren't drawn.
