import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { CodeGraph } from "@/lib/graph/schema";
import { RepoInputForm } from "@/features/analysis/RepoInputForm";
import { HeroCity } from "./HeroCity";

type Status = "live" | "planned";

const MAPPING: { code: string; city: string; rule: string; status: Status }[] = [
  {
    code: "Folders & packages",
    city: "Districts",
    rule: "Each directory is a raised plot, nested inside its parent's.",
    status: "live",
  },
  {
    code: "Files & modules",
    city: "Buildings",
    rule: "More lines of code means a wider footprint, and each file type has its own look.",
    status: "live",
  },
  {
    code: "Complexity",
    city: "Skyline",
    rule: "The most tangled files tower over the rest, so hotspots stand out.",
    status: "live",
  },
  {
    code: "Key modules",
    city: "Beacons",
    rule: "The files everything else depends on carry a light you can spot from anywhere.",
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
    city: "Time travel",
    rule: "Step through real commits: new files rise, removed ones sink, changed ones resize.",
    status: "live",
  },
  {
    code: "Your questions",
    city: "AI Architect",
    rule: "Ask about the architecture. Answers cite the analysis, mark what is inferred, and light up the files they name.",
    status: "live",
  },
];

/** Real public repositories. Each link starts a real analysis; nothing here is precomputed. */
const FEATURED: { repo: string; blurb: string }[] = [
  { repo: "pmndrs/zustand", blurb: "Small state management" },
  { repo: "sindresorhus/ky", blurb: "HTTP client" },
  { repo: "honojs/hono", blurb: "Web framework" },
];

const PIPELINE: { step: string; detail: string; status: Status }[] = [
  { step: "Fetch", detail: "One commit's archive, read in memory and never executed", status: "live" },
  { step: "Parse", detail: "Real syntax trees from Tree-sitter, never regex guesses", status: "live" },
  { step: "Connect", detail: "A NetworkX graph of resolved imports, cycles and hubs", status: "live" },
  { step: "Lay out", detail: "Deterministic: the same graph builds the same city", status: "live" },
  { step: "Explore", detail: "Fly through it, select a file and trace its links", status: "live" },
];

const SAFEGUARDS = [
  "Repository code is parsed as text. Nothing gets installed, built or run.",
  "Only plain GitHub owner/repo references are accepted. Everything else is rejected.",
  "Hard limits on download size, file count, source size, concurrent analyses and time.",
  "Only github.com is ever contacted, redirects are refused, and requests are rate limited.",
  "Every graph records where it came from. Sample data is always labelled as sample data.",
];

function StatusTag({ status }: { status: Status }) {
  return status === "live" ? (
    <span className="font-mono text-[11px] tracking-wide text-cyan">Live</span>
  ) : (
    <span className="font-mono text-[11px] tracking-wide text-faint">Planned</span>
  );
}

const primaryCta =
  "cta inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-semibold";

export function LandingPage({ graph }: { graph: CodeGraph }) {
  return (
    <div className="bg-void">
      <header className="fixed inset-x-0 top-4 z-30 px-4">
        <nav
          aria-label="Main"
          className="glass mx-auto flex h-14 max-w-5xl items-center justify-between rounded-full py-2 pr-2 pl-5 shadow-[0_10px_40px_-12px_rgb(0_0_0/0.6)]"
        >
          <Logo />
          <div className="flex items-center gap-1 text-sm text-muted sm:gap-2">
            <a href="#map" className="hidden rounded-full px-3 py-2 transition-colors hover:text-text sm:block">
              The map
            </a>
            <a href="#pipeline" className="hidden rounded-full px-3 py-2 transition-colors hover:text-text sm:block">
              Pipeline
            </a>
            <a href="#safety" className="hidden rounded-full px-3 py-2 transition-colors hover:text-text md:block">
              Safety
            </a>
            <Link href="/explore/demo" className="cta rounded-full px-4 py-2 text-sm font-semibold">
              Open demo
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative isolate flex min-h-svh items-end overflow-hidden lg:items-center">
          {/* Light: a crimson floor glow and a gold key light that drift slowly. Decorative. */}
          <div aria-hidden="true" className="absolute inset-0 -z-20 bg-void">
            <div className="animate-glow-drift absolute -bottom-1/3 -left-1/4 h-[80vh] w-[80vw] rounded-full bg-[radial-gradient(closest-side,rgb(204_37_32/0.45),rgb(142_17_21/0.25)_45%,transparent)] blur-2xl" />
            <div className="animate-glow-drift absolute -top-1/4 right-[-10%] h-[70vh] w-[55vw] rounded-full bg-[radial-gradient(closest-side,rgb(245_215_110/0.22),rgb(204_37_32/0.12)_50%,transparent)] blur-2xl [animation-delay:-11s]" />
          </div>
          <div aria-hidden="true" className="absolute inset-y-0 right-0 -z-10 w-full lg:w-[62%]">
            <HeroCity graph={graph} />
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-void via-void/70 to-void/10 lg:bg-gradient-to-r lg:from-void lg:via-void/75 lg:to-transparent"
          />
          <div aria-hidden="true" className="scanlines animate-scan-drift pointer-events-none absolute inset-0 -z-10" />
          <div aria-hidden="true" className="grain pointer-events-none absolute inset-0 -z-10" />

          <div className="animate-rise-in relative mx-auto w-full max-w-7xl px-4 pt-28 pb-20 sm:px-8 lg:pb-10">
            <p className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[11px] tracking-wide text-muted">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_var(--color-cyan)]" />
              Real analysis of public JavaScript and TypeScript repositories
            </p>
            <h1 className="mt-7 max-w-4xl text-[3.4rem] leading-[0.95] font-medium tracking-[-0.035em] text-balance text-text sm:text-8xl lg:text-[7.25rem]">
              Your Code.
              <br />
              <span className="text-text/90">An Entire Universe.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
              GitVerse rebuilds a repository as a living 3D city. Folders become districts, files
              become buildings shaped by their complexity, imports light the sky between them, and
              an AI architect answers questions with the evidence to back them.
            </p>
            <div className="mt-9">
              <RepoInputForm />
            </div>
            <div className="mt-7">
              <p className="font-mono text-[11px] tracking-wide text-faint uppercase">
                Try a real repository
              </p>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {FEATURED.map(({ repo, blurb }) => (
                  <li key={repo}>
                    <Link
                      href={`/explore/gh/${repo}`}
                      className="glass group inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors hover:border-cyan/60"
                    >
                      <span className="font-mono text-text group-hover:text-cyan">{repo}</span>
                      <span className="text-xs text-faint">{blurb}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <Link href="/explore/demo" className="text-text transition-colors hover:text-cyan">
                Or explore the demo city →
              </Link>
              <a href="#map" className="text-muted transition-colors hover:text-text">
                How the map works
              </a>
            </div>
          </div>
          <p className="absolute right-4 bottom-4 font-mono text-[11px] text-faint sm:right-8">
            Rendered from sample data, not a real repository
          </p>
        </section>

        <section id="map" className="scroll-mt-24 border-t border-line">
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

        <section id="pipeline" className="relative scroll-mt-24 border-t border-line bg-ink">
          <div aria-hidden="true" className="scanlines pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-8">
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

        <section id="safety" className="scroll-mt-24 border-t border-line">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                It reads your code.
                <br />
                <span className="text-faint">It never runs it.</span>
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-muted">
                These rules are enforced by the analyzer today. Running it in an isolated
                container is the next step.
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
