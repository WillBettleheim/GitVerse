# GitVerse: portfolio materials

Everything below describes what is built and tested. Numbers come from
[PERFORMANCE.md](PERFORMANCE.md) and were measured on an Apple M4.

## GitHub description

> Explore any public JavaScript or TypeScript repository as an interactive 3D city, with real AST
> analysis, git time travel and an evidence-grounded AI architect.

## Portfolio description

**GitVerse turns a codebase into a city you can walk through.** Paste a public GitHub repository and
it becomes a 3D city: folders are districts, files are buildings whose height is their complexity
and whose footprint is their size, and imports are arcs of light. Select a building to trace what
it depends on and what depends on it, scrub through the repository's real commit history and
watch the architecture change, or ask an AI architect where authentication lives and get an answer
that cites the exact files and lines.

**Why I built it.** File trees hide how software fits together. When you join a new codebase, the
questions that matter (what's central, what depends on what, where the tangles are, how it got this
way) are answered by structure, not by reading files one at a time. I wanted a tool that shows that
structure at a glance, and that never shows anything it can't back up.

**The interesting problems:**

- *Analyzing untrusted code safely.* Every repository is treated as hostile. GitVerse never runs
  it: archives are read in memory with strict limits, parsed as text with Tree-sitter, and only two
  fixed GitHub hosts are ever contacted, with redirects refused.
- *Making the picture honest.* Every visual property maps to a measured value, the layout is a pure
  function so the same commit always builds the same city, and sample data is labelled as such
  everywhere.
- *Comparing history correctly.* Files are matched across commits by git blob SHA, so "unchanged"
  means byte-for-byte identical, and renames come from GitHub's comparison or identical content,
  so a moved file isn't reported as one deletion and one addition.
- *An AI that can't make things up.* The assistant answers only from evidence GitVerse retrieved
  itself, marks each claim as verified or inferred, and every file, line and dependency in its
  answer is checked against the analysis before anyone sees it. Repository text is treated as
  untrusted, so a comment telling the model to ignore its instructions changes nothing.
- *Staying fast.* The city renders in 7 draw calls whatever the repository's size, held 60 fps on
  a synthetic 5,000-file benchmark, and parsing runs across worker processes, which cut analysis of honojs/hono from
  486 ms to 165 ms.

**Stack:** Next.js, React, TypeScript, React Three Fiber and Three.js on the front end; Python,
FastAPI, Tree-sitter and NetworkX on the back end; Claude for the AI architect; Docker for delivery.

## Resume bullets

- Built GitVerse, a full-stack 3D repository explorer (Next.js, React Three Fiber, FastAPI) that
  parses JavaScript and TypeScript with Tree-sitter, resolves imports into a NetworkX dependency
  graph with cycle and hub detection, and renders it as a deterministic city in 7 instanced draw
  calls, holding 60 fps on a synthetic 5,000-file benchmark.
- Designed a security model for analyzing untrusted repositories: allowlisted inputs, two fixed
  hosts with no redirects, in-memory archive reading with size, entry, time and path-traversal
  limits, no code execution, per-client rate limits and a Content-Security-Policy, covered by
  over 300 backend tests.
- Built an evidence-grounded AI assistant on the Claude API that retrieves bounded evidence from
  the analysis, separates verified facts from inferences, and validates every cited file, line and
  dependency before display; evaluated it against fixture repositories with known answers,
  including prompt-injection and unsupported-question cases.

## Demo script (about 75 seconds)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Landing page | "GitVerse turns a GitHub repository into a 3D city. I'll paste a real one." |
| 0:06 | Type `pmndrs/zustand`, press Analyze; progress steps tick by | "It downloads one commit, parses every file with Tree-sitter, and resolves the imports into a graph. It never runs the code." |
| 0:16 | The city appears; slow orbit | "Folders are districts. Height is complexity, footprint is lines of code, and the beacons mark the files everything depends on." |
| 0:26 | Click the tallest beacon, `vanilla.ts` | "Selecting a file traces its dependencies: violet arcs are the seventeen files that import it. The inspector shows its metrics and links to the source at this exact commit." |
| 0:36 | Press "Open as graph", then back | "The same relationships as a graph, if you prefer it flat." |
| 0:42 | Click an earlier commit on the timeline | "This is the repository's real history. Selecting an earlier commit analyzes it and animates the city: removed files sink, changed ones resize, and the panel lists exactly what changed." |
| 0:54 | Press Latest, open Ask AI, choose "Which files are central to the architecture?" | "And I can ask questions. AI Architect answers from evidence the analysis found, marks what's verified versus inferred, and lights up the files it names." |
| 1:06 | Press Focus camera, then click a file in the answer | "One click flies to those buildings, and any file opens in the inspector." |
| 1:12 | Fit to city | "That's GitVerse: real analysis, honest visuals, and an AI that can't make things up." |

If no API key is configured, say "evidence-only" at 0:54: the answer shows the retrieved evidence
without a written explanation.

## Technical interview preparation

### AST-based source analysis

- **Why Tree-sitter, not regular expressions:** imports can be commented out, inside strings,
  conditional, dynamic (`import()`), CommonJS (`require`), re-exports or type-only. A syntax tree
  tells them apart; a regex can't. Tree-sitter is fast, tolerant of syntax errors (it recovers and
  GitVerse flags the file), and has grammars for JS, JSX, TS and TSX.
- **What's extracted:** imports with their kind and line, exports, top-level declarations with line
  spans, function and class counts, and McCabe cyclomatic complexity (one plus each decision
  point and logical operator).
- **Resolution** follows Node and TypeScript rules: relative paths with extension and `index`
  probing, `.js` specifiers that point at `.ts` files, `tsconfig` `paths` and `baseUrl`, and bare specifiers classified as packages or Node
  built-ins. Imports that can't be resolved are listed with a reason rather than guessed.
- **Trade-off:** walking the tree is pure Python, so parsing a large repository is CPU-bound. It
  runs in worker processes (3.5× faster parsing at 5,000 files on 4 workers), which also keeps the
  API responsive during analysis.

### Dependency graph modelling

- A NetworkX directed graph: one node per file, one edge per resolved internal import, marked
  type-only when every import along it is `import type` (they vanish at runtime).
- **Cycles** are strongly connected components with more than one file, so a cycle is reported as
  the set of files that all reach each other, not as an arbitrary list of loops. Type-only cycles
  are told apart because they can't cause load-order bugs.
- **Hubs** are ranked by imports in plus imports out; insights also rank by incoming dependencies
  alone. Everything shown is counted from the graph.
- **One contract:** the `CodeGraph` schema is defined in Pydantic and Zod, and a backend test
  writes a real analysis sample that the frontend's tests parse, so the two can't drift.

### Deterministic 3D layout

- `generateCity(graph)` is a pure function: no randomness, clock or locale. Ordering uses code-unit
  comparison, and per-file variation (aspect ratio, window seeds, district colours) comes from an
  FNV-1a hash of the path, so it's stable across runs and machines.
- Districts nest like folders. Within each, buildings are placed with **skyline packing**: each
  rectangle drops to the lowest spot it fits, which fills the gaps beside tall buildings. A few
  widths are tried and the most compact result kept.
- Sizes use log scaling, so one huge file doesn't flatten everything else.
- Because layout is pure data, it's unit-tested without WebGL, and time travel can animate between
  two layouts by matching buildings by identity.

### Rendering performance

- All buildings are one instanced mesh; districts, beacons and connections are others. The scene
  renders in 7 draw calls whatever the file count, with custom shaders for windows and tints.
- Rendering is on demand: frames are drawn only while something moves.
- A frame-time governor lowers quality (pixel ratio, arc count, effects) if the device can't keep
  up, and a manual low power mode does the same plus stops idle rendering.
- **Measured** in Chrome on an M4: 60 fps at every size up to 5,000 files with vsync, 500 to 630 fps
  without it, p99 frame time under 6 ms. Measuring first showed rendering wasn't the bottleneck, so
  optimization went to the backend instead.

### Git snapshot comparison

- Each historical city is a full analysis of that exact commit, cached by repository, commit SHA
  and analyzer version, never an interpolation.
- **Identity is the git blob SHA**, computed exactly as git does, so a file is unchanged only when
  its bytes are.
- **Renames:** GitHub's comparison (similarity-based) where available, plus exact-content matches
  where a removed and an added file share a blob. The diff says which method applied and whether
  GitHub's file list was truncated.
- Dependency changes are computed after carrying renamed files across, so moving a file doesn't
  show up as a broken and a new import.
- **Races:** only the latest selection may update the view, earlier requests are cancelled, and
  analyses queued for commits the user moved past are dropped.

### Evidence-grounded AI

- **Retrieval is deterministic and bounded:** keyword and concept matching over paths,
  declarations and imported packages, plus graph facts chosen by question type (dependents,
  cycles, hubs, relationships, history). At most 8 files and 16,000 characters of source, so a
  large repository never floods the prompt.
- **Generation:** one Claude call with a JSON schema. Each claim is `verified` or `inferred` and
  cites evidence ids; uncertainty is a required field.
- **Validation is the real safeguard:** files not in the analysis are removed, relationships must
  exist in the graph, unknown citations are dropped, a "verified" claim without evidence becomes
  "inferred", and line links come only from the analysis. Every change is shown to the user.
- **Prompt injection:** repository text is wrapped as untrusted data and tag-like text inside it is
  defused, the model has no tools, and validation means even an obedient model can't introduce a
  file or dependency.
- **Evaluated** offline against fixture repositories with known answers. Live model answers haven't
  been evaluated yet; a billed live evaluation exists for that.
