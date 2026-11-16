"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import type { AnalysisJob, Stage } from "@/lib/analysis/client";
import type { RepositoryInfo } from "@/lib/graph/schema";
import { RepoInputForm } from "./RepoInputForm";

const STEPS: { stage: Stage; label: string }[] = [
  { stage: "queued", label: "Waiting for a free analyzer" },
  { stage: "fetching_metadata", label: "Reading repository details" },
  { stage: "downloading", label: "Downloading the source archive" },
  { stage: "reading_archive", label: "Selecting JavaScript and TypeScript files" },
  { stage: "parsing", label: "Parsing syntax trees" },
  { stage: "building_graph", label: "Resolving imports and building the graph" },
];

const countFormat = new Intl.NumberFormat("en-US");

export function RepositoryCard({
  repository,
  tone = "panel",
}: {
  repository: RepositoryInfo;
  /** "glass" for the analysis screen, over bright light. */
  tone?: "panel" | "glass";
}) {
  return (
    <div
      className={
        tone === "glass"
          ? "glass-ember rounded-2xl p-5"
          : "rounded-lg border border-line bg-panel p-4"
      }
    >
      <a
        href={repository.url}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-text hover:text-cyan"
      >
        {repository.fullName}
      </a>
      {repository.description && (
        <p
          className={`mt-1 text-sm leading-relaxed ${tone === "glass" ? "text-text/85" : "text-muted"}`}
        >
          {repository.description}
        </p>
      )}
      <dl
        className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs ${tone === "glass" ? "text-text/70" : "text-faint"}`}
      >
        <div>
          <dt className="sr-only">Stars</dt>
          <dd>★ {countFormat.format(repository.stars)}</dd>
        </div>
        {repository.primaryLanguage && (
          <div>
            <dt className="sr-only">Language</dt>
            <dd>{repository.primaryLanguage}</dd>
          </div>
        )}
        {repository.license && (
          <div>
            <dt className="sr-only">License</dt>
            <dd>{repository.license}</dd>
          </div>
        )}
        <div>
          <dt className="sr-only">Commit</dt>
          <dd>
            {repository.defaultBranch} @ {repository.commitSha.slice(0, 7)}
          </dd>
        </div>
        {repository.archived && <dd className="text-amber">Archived</dd>}
      </dl>
    </div>
  );
}

/**
 * The analysis screen: warm light seen through ribbed glass, a large headline, and glass cards
 * with the live numbers. Shared by progress and failure, so a failure doesn't jolt the page.
 */
export function AnalysisScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-svh overflow-hidden bg-deep text-text">
      <Backdrop />
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 pt-5 sm:px-8">
        <Logo />
        <nav
          aria-label="Main"
          className="glass-ember hidden items-center gap-1 rounded-full p-1 text-sm md:flex"
        >
          <Link
            href="/"
            className="rounded-full px-4 py-1.5 text-text/85 hover:bg-white/10 hover:text-text"
          >
            Home
          </Link>
          <Link
            href="/explore/demo"
            className="rounded-full px-4 py-1.5 text-text/85 hover:bg-white/10 hover:text-text"
          >
            Demo city
          </Link>
          <Link
            href="/#map"
            className="rounded-full px-4 py-1.5 text-text/85 hover:bg-white/10 hover:text-text"
          >
            How it works
          </Link>
        </nav>
        <Link
          href="/"
          aria-label="Back to the home page"
          className="glass-ember grid h-11 w-11 place-items-center rounded-full text-text hover:bg-white/15"
        >
          <Icon name="close" />
        </Link>
      </header>
      <main className="animate-fade-in relative z-10 mx-auto flex min-h-svh max-w-7xl flex-col px-4 pt-24 pb-6 sm:px-8">
        {children}
      </main>
    </div>
  );
}

/** Light through fluted glass. Decorative, and still under reduced motion. */
// No CSS blur: the radial gradients are already soft, and blurring layers this large is costly to
// redraw every frame on devices without GPU compositing.
function Backdrop() {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(110%_90%_at_60%_35%,#e0281f_0%,#b0161a_38%,#5c0909_72%,#230505_100%)]" />
      <div className="animate-glow-drift absolute top-[-6%] left-[22%] h-[90vh] w-[58vw] rounded-full bg-[radial-gradient(closest-side,rgb(255_110_40/0.95),rgb(255_110_40/0))]" />
      <div className="animate-glow-drift absolute top-[12%] left-[33%] h-[62vh] w-[34vw] rounded-full bg-[radial-gradient(closest-side,rgb(255_222_110/1),rgb(245_215_110/0.55)_45%,rgb(245_215_110/0))] [animation-delay:-8s]" />
      <div className="animate-glow-drift absolute top-[0%] left-[54%] h-[88vh] w-[15vw] rounded-full bg-[radial-gradient(closest-side,rgb(40_6_6/0.78),rgb(40_6_6/0))] [animation-delay:-15s]" />
      <div className="fluted absolute inset-0 opacity-90" />
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-[#1c0404]/85 via-[#1c0404]/35 to-transparent" />
      <div className="absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-[#1c0404]/45 to-transparent" />
      <div className="grain absolute inset-0" />
    </div>
  );
}

const STEP_ICONS: Record<string, IconName> = {
  queued: "clock",
  fetching_metadata: "repo",
  downloading: "download",
  reading_archive: "files",
  parsing: "code",
  building_graph: "graph",
};

export function AnalysisProgress({ repository, job }: { repository: string; job?: AnalysisJob }) {
  const stage = job?.progress.stage ?? "queued";
  const current = Math.max(
    0,
    STEPS.findIndex((step) => step.stage === stage),
  );
  const { filesParsed, filesTotal } = job?.progress ?? { filesParsed: 0, filesTotal: 0 };
  const [owner, name] = repository.split("/");

  return (
    <AnalysisScreen>
      <div className="grid flex-1 items-end gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="pb-2 lg:order-1">
          <p className="inline-flex items-center gap-2 font-mono text-xs tracking-wide text-text/80 uppercase">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
            Analyzing
          </p>
          <h1 className="mt-4 text-[3.25rem] leading-[0.95] font-light tracking-[-0.03em] break-words sm:text-7xl lg:text-[6.5rem]">
            Mapping
            <br />
            <span className="font-normal">{name ?? repository}</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-text/85">
            <span className="font-mono text-text">
              {owner}/{name}
            </span>
            . {STAGE_NOTES[STEPS[current].stage]}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
            <Link
              href="/explore/demo"
              className="inline-flex items-center gap-2 rounded-full bg-text px-5 py-2.5 font-semibold text-deep hover:bg-cyan"
            >
              Explore the demo meanwhile <span aria-hidden="true">→</span>
            </Link>
            <Link href="/" className="text-text/85 hover:text-text">
              Analyze another ↗
            </Link>
          </div>
        </div>

        <aside
          aria-label="Analysis status"
          className="flex flex-col gap-3 lg:order-2 lg:mb-2 lg:self-start lg:pt-6"
        >
          {job?.repository && <RepositoryCard repository={job.repository} tone="glass" />}
          <div className="glass-ember rounded-2xl p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-text/90">
                <Icon name={STEP_ICONS[STEPS[current].stage]} />
                {STEPS[current].label}
              </span>
              <span className="font-mono text-[11px] text-text/70">
                Step {current + 1} of {STEPS.length}
              </span>
            </div>
            {filesTotal > 0 ? (
              <>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-3xl font-light tabular-nums">
                    {countFormat.format(filesParsed)}
                  </span>
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-mono text-[10px] tracking-wide">
                    OF
                  </span>
                  <span className="text-3xl font-light tabular-nums">
                    {countFormat.format(filesTotal)}
                  </span>
                </div>
                <p className="mt-1 text-right font-mono text-[11px] text-text/70">files parsed</p>
                <div
                  role="progressbar"
                  aria-label="Files parsed"
                  aria-valuemin={0}
                  aria-valuemax={filesTotal}
                  aria-valuenow={filesParsed}
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15"
                >
                  <div
                    className="h-full rounded-full bg-cyan transition-[width] duration-300"
                    style={{ width: `${Math.round((filesParsed / filesTotal) * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="mt-4 text-3xl font-light">
                {current === 0 ? "In the queue" : "Working…"}
              </p>
            )}
          </div>
        </aside>
      </div>

      <ol
        aria-label="Analysis progress"
        className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/15 pt-5 sm:grid-cols-3 lg:grid-cols-6"
      >
        {STEPS.map((step, index) => {
          const state = index < current ? "done" : index === current ? "active" : "waiting";
          return (
            <li
              key={step.stage}
              aria-current={state === "active" ? "step" : undefined}
              className={`text-sm leading-snug transition-opacity ${state === "waiting" ? "opacity-55" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`mb-2 grid h-7 w-7 place-items-center rounded-full ${
                  state === "done"
                    ? "bg-cyan text-deep"
                    : state === "active"
                      ? "animate-pulse bg-white/20 text-text"
                      : "bg-white/10 text-text/80"
                }`}
              >
                <Icon name={state === "done" ? "check" : STEP_ICONS[step.stage]} />
              </span>
              <span className="text-text">{step.label}</span>
              <span className="sr-only">
                {state === "done" ? ", done" : state === "active" ? ", in progress" : ", waiting"}
              </span>
              {step.stage === "parsing" && filesTotal > 0 && state !== "waiting" && (
                <span className="mt-0.5 block font-mono text-xs text-text/75 tabular-nums">
                  {countFormat.format(filesParsed)} / {countFormat.format(filesTotal)} files
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </AnalysisScreen>
  );
}

/** What each stage is doing, in a sentence. */
const STAGE_NOTES: Record<Stage, string> = {
  queued: "Waiting for a free analyzer; it starts as soon as one is ready.",
  fetching_metadata: "Asking GitHub for the repository and its latest commit.",
  downloading: "Downloading that commit's archive. The code is read, never run.",
  reading_archive: "Picking out the JavaScript and TypeScript files.",
  parsing: "Parsing each file into a syntax tree to find its imports and declarations.",
  building_graph: "Resolving imports into a dependency graph and laying out the city.",
  complete: "Done.",
  failed: "The analysis stopped.",
};

export function AnalysisFailure({
  repository,
  message,
  job,
  retryAfterSeconds,
  onRetry,
}: {
  repository: string;
  message: string;
  job?: AnalysisJob;
  retryAfterSeconds?: number;
  onRetry: () => void;
}) {
  const name = repository.split("/")[1] ?? repository;
  return (
    <AnalysisScreen>
      <div className="grid flex-1 items-end gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="pb-2">
          <p className="font-mono text-xs tracking-wide text-amber uppercase">Analysis failed</p>
          <h1 className="mt-4 text-[3.25rem] leading-[0.95] font-light tracking-[-0.03em] break-words sm:text-7xl lg:text-[6.5rem]">
            Couldn’t map
            <br />
            <span className="font-normal">{name}</span>
          </h1>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-full bg-text px-5 py-2.5 font-semibold text-deep hover:bg-cyan"
            >
              Try again
            </button>
            <Link href="/explore/demo" className="text-text/85 hover:text-text">
              Open the demo city instead ↗
            </Link>
          </div>
        </div>
        <aside aria-label="What happened" className="flex flex-col gap-3 lg:self-start lg:pt-6">
          <div className="glass-ember rounded-2xl p-5">
            <p className="flex items-center gap-2 text-sm text-text/90">
              <Icon name="alert" /> {repository}
            </p>
            <p role="alert" className="mt-3 leading-relaxed text-text">
              {message}
            </p>
            {retryAfterSeconds !== undefined && (
              <p className="mt-2 text-sm text-text/75">
                You can try again in {retryAfterSeconds} seconds.
              </p>
            )}
          </div>
          {job?.repository && <RepositoryCard repository={job.repository} tone="glass" />}
          <div className="glass-ember rounded-2xl p-5">
            <p className="mb-2 text-sm text-text/85">Or analyze a different repository:</p>
            <RepoInputForm compact />
          </div>
        </aside>
      </div>
    </AnalysisScreen>
  );
}

type IconName =
  "clock" | "repo" | "download" | "files" | "code" | "graph" | "check" | "close" | "alert";

const ICON_PATHS: Record<IconName, string> = {
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  repo: "M5 4h11l3 3v13H5zM9 4v6l2-1.5L13 10V4",
  download: "M12 4v11m0 0-4-4m4 4 4-4M5 19h14",
  files: "M7 3h7l4 4v11H7zM14 3v4h4M4 7v14h11",
  code: "m9 8-4 4 4 4m6-8 4 4-4 4",
  graph: "M6 6h.01M18 6h.01M12 18h.01M6 6l6 12 6-12M6 6h12",
  check: "m5 12 4.5 4.5L19 7",
  close: "M6 6l12 12M18 6 6 18",
  alert:
    "M12 8v5m0 3h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
