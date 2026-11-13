"use client";

import Link from "next/link";
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

export function RepositoryCard({ repository }: { repository: RepositoryInfo }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <a
        href={repository.url}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-text hover:text-cyan"
      >
        {repository.fullName}
      </a>
      {repository.description && (
        <p className="mt-1 text-sm leading-relaxed text-muted">{repository.description}</p>
      )}
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-faint">
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

export function AnalysisProgress({ repository, job }: { repository: string; job?: AnalysisJob }) {
  const stage = job?.progress.stage ?? "queued";
  const current = Math.max(
    0,
    STEPS.findIndex((step) => step.stage === stage),
  );
  const { filesParsed, filesTotal } = job?.progress ?? { filesParsed: 0, filesTotal: 0 };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16">
      <p className="font-mono text-xs text-cyan">Analyzing</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight break-all">{repository}</h1>
      {job?.repository && (
        <div className="mt-6">
          <RepositoryCard repository={job.repository} />
        </div>
      )}
      <ol className="mt-8 space-y-3" aria-label="Analysis progress">
        {STEPS.map((step, index) => {
          const state = index < current ? "done" : index === current ? "active" : "waiting";
          return (
            <li
              key={step.stage}
              aria-current={state === "active" ? "step" : undefined}
              className="flex items-center gap-3 text-sm"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  state === "done"
                    ? "bg-cyan"
                    : state === "active"
                      ? "animate-pulse bg-cyan"
                      : "bg-line"
                }`}
              />
              <span className={state === "waiting" ? "text-faint" : "text-text"}>{step.label}</span>
              {step.stage === "parsing" && filesTotal > 0 && state !== "waiting" && (
                <span className="ml-auto font-mono text-xs text-muted tabular-nums">
                  {countFormat.format(filesParsed)} / {countFormat.format(filesTotal)} files
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {filesTotal > 0 && (
        <div
          role="progressbar"
          aria-label="Files parsed"
          aria-valuemin={0}
          aria-valuemax={filesTotal}
          aria-valuenow={filesParsed}
          className="mt-6 h-1 overflow-hidden rounded bg-line"
        >
          <div
            className="h-full bg-cyan transition-[width] duration-300"
            style={{ width: `${Math.round((filesParsed / filesTotal) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

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
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16">
      <p className="font-mono text-xs text-amber">Analysis failed</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight break-all">{repository}</h1>
      <p role="alert" className="mt-4 leading-relaxed text-muted">
        {message}
      </p>
      {retryAfterSeconds !== undefined && (
        <p className="mt-2 text-sm text-faint">You can try again in {retryAfterSeconds} seconds.</p>
      )}
      {job?.repository && (
        <div className="mt-6">
          <RepositoryCard repository={job.repository} />
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onRetry}
          className="h-10 rounded-md border border-line px-4 text-sm transition-colors hover:border-faint"
        >
          Try again
        </button>
        <Link href="/explore/demo" className="text-sm text-muted hover:text-text">
          Open the demo city instead
        </Link>
      </div>
      <div className="mt-10">
        <p className="mb-2 text-sm text-muted">Or analyze a different repository:</p>
        <RepoInputForm compact />
      </div>
    </div>
  );
}
