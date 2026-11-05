import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { CodeGraph } from "@/lib/graph/schema";
import { HeroCity } from "./HeroCity";

type Status = "live" | "planned";

const MAPPING: { code: string; city: string; rule: string; status: Status }[] = [
  {
    code: "Folders & packages",
    city: "Districts",
    rule: "Each directory gets its own walled plot with a stable colour.",
    status: "live",
  },
  {
    code: "Files & modules",
    city: "Buildings",
    rule: "More lines of code means a wider footprint.",
    status: "live",
  },
  {
    code: "Complexity",
    city: "Skyline",
    rule: "The most tangled files tower over the rest, so hotspots stand out.",
    status: "live",
  },
  {
    code: "Imports",
    city: "Light arcs",
    rule: "Select a building to trace what it depends on and what depends on it.",
    status: "live",
  },
  {
    code: "Commit history",
    city: "City growth",
    rule: "Scrub through time and watch the architecture change.",
    status: "planned",
  },
  {
    code: "Claude",
    city: "Your guide",
    rule: "Ask why a district exists and get answers grounded in the graph.",
    status: "planned",
  },
];

const PIPELINE: { step: string; detail: string; status: Status }[] = [
  { step: "Fetch", detail: "Shallow clone with hooks, submodules and LFS disabled", status: "planned" },
  { step: "Parse", detail: "Real ASTs from Tree-sitter, never regex guesses", status: "planned" },
  { step: "Connect", detail: "A NetworkX dependency graph with resolved imports", status: "planned" },
  { step: "Lay out", detail: "Deterministic: the same graph builds the same city", status: "live" },
  { step: "Explore", detail: "Fly through it, select a file and trace its links", status: "live" },
];

const SAFEGUARDS = [
  "Repository code is parsed as text. Nothing gets installed, built or run.",
  "Only plain GitHub owner/repo references are accepted. Everything else is rejected.",
  "Hard limits on repository size, file count, memory and time.",
  "Every graph records where it came from. Sample data is always labelled as sample data.",
];

function StatusTag({ status }: { status: Status }) {
  return status === "live" ? (
    <span className="font-mono text-[11px] tracking-wide text-cyan">In the demo</span>
  ) : (
    <span className="font-mono text-[11px] tracking-wide text-faint">Planned</span>
  );
}

const primaryCta =
  "inline-flex h-11 items-center justify-center rounded-md bg-text px-5 text-sm font-medium text-void transition-colors hover:bg-cyan";

export function LandingPage({ graph }: { graph: CodeGraph }) {
  return (
    <div className="bg-void">
      <header className="absolute inset-x-0 top-0 z-20">
        <nav
          aria-label="Main"
          className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8"
        >
          <Logo />
          <div className="flex items-center gap-6 text-sm text-muted">
            <a href="#map" className="hidden transition-colors hover:text-text sm:block">
              The map
            </a>
            <a href="#pipeline" className="hidden transition-colors hover:text-text sm:block">
              Pipeline
            </a>
            <a href="#safety" className="hidden transition-colors hover:text-text sm:block">
              Safety
            </a>
            <Link href="/explore/demo" className="text-text transition-colors hover:text-cyan">
              Open demo →
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative flex min-h-svh items-end overflow-hidden lg:items-center">
          <div aria-hidden="true" className="absolute inset-0">
            <HeroCity graph={graph} />
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-void via-void/75 to-void/10 lg:bg-gradient-to-r lg:from-void lg:via-void/70 lg:to-transparent"
          />
          <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-24 pb-20 sm:px-8 lg:pb-8">
            <p className="font-mono text-xs tracking-wide text-cyan">
              Early build: the demo city is live, repository analysis is next
            </p>
            <h1 className="mt-5 max-w-3xl text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-7xl">
              Explore Code Like a Universe.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              GitVerse rebuilds a codebase as a 3D city you can fly through. Folders are districts,
              files are buildings, and imports light up the sky between them.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/explore/demo" className={primaryCta}>
                Enter the demo city
              </Link>
              <a
                href="#map"
                className="text-sm text-muted transition-colors hover:text-text"
              >
                How the map works
              </a>
            </div>
          </div>
          <p className="absolute right-4 bottom-4 z-10 font-mono text-[11px] text-faint sm:right-8">
            Rendered from sample data, not a real repository
          </p>
        </section>

        <section id="map" className="scroll-mt-8 border-t border-line">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Every part of a repo has a place on the map.
              </h2>
              <p className="mt-4 leading-relaxed text-muted">
                File trees hide how software really fits together. In a city, shape carries meaning,
                so you can see the structure before reading a line.
              </p>
            </div>
            <dl className="divide-y divide-line border-y border-line">
              {MAPPING.map((row) => (
                <div
                  key={row.code}
                  className="grid gap-x-6 gap-y-1 py-5 sm:grid-cols-[1fr_1.6fr_5.5rem] sm:items-baseline"
                >
                  <dt className="font-medium">
                    {row.code} <span className="text-faint">→</span>{" "}
                    <span className="text-cyan">{row.city}</span>
                  </dt>
                  <dd className="text-sm leading-relaxed text-muted">{row.rule}</dd>
                  <dd>
                    <StatusTag status={row.status} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="pipeline" className="scroll-mt-8 border-t border-line bg-ink">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              From repository to skyline in five stages.
            </h2>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
              {PIPELINE.map((stage, index) => (
                <li key={stage.step} className="flex flex-col bg-ink p-5">
                  <span className="font-mono text-xs text-faint">0{index + 1}</span>
                  <h3 className="mt-6 text-lg font-medium">{stage.step}</h3>
                  <p className="mt-2 mb-6 text-sm leading-relaxed text-muted">{stage.detail}</p>
                  <div className="mt-auto">
                    <StatusTag status={stage.status} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="safety" className="scroll-mt-8 border-t border-line">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                It reads your code.
                <br />
                <span className="text-faint">It never runs it.</span>
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-muted">
                These are the rules the analysis pipeline is being built around. Input validation is
                in place today; the rest arrive with the pipeline.
              </p>
            </div>
            <ul className="space-y-4">
              {SAFEGUARDS.map((item) => (
                <li key={item} className="flex gap-3 leading-relaxed text-muted">
                  <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-cyan" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-line bg-ink">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-16 sm:flex-row sm:items-center sm:px-8">
            <p className="text-2xl font-semibold tracking-tight">See it for yourself.</p>
            <Link href="/explore/demo" className={primaryCta}>
              Enter the demo city
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-6 text-sm text-faint sm:px-8">
          <Logo />
          <span>Explore Code Like a Universe.</span>
        </div>
      </footer>
    </div>
  );
}
