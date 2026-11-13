"use client";

import { Logo } from "@/components/Logo";
import { ExplorerShell } from "@/features/explorer/ExplorerShell";
import { AnalysisFailure, AnalysisProgress } from "./AnalysisStatus";
import { useAnalysis } from "./use-analysis";

export function AnalysisExplorer({ owner, name }: { owner: string; name: string }) {
  const repository = `${owner}/${name}`;
  const { state, retry } = useAnalysis(repository);

  if (state.phase === "complete") {
    const info = state.graph.analysis?.repository;
    return (
      <ExplorerShell
        key={state.job.id}
        graph={state.graph}
        headerSlot={
          info && (
            <a
              href={`${info.url}/tree/${info.commitSha}`}
              target="_blank"
              rel="noreferrer noopener"
              className="hidden shrink-0 font-mono text-[11px] text-faint hover:text-text md:inline"
              title="The exact commit that was analyzed"
            >
              @{info.commitSha.slice(0, 7)}
              {state.job.cached && " · cached"}
            </a>
          )
        }
      />
    );
  }

  return (
    <div className="min-h-svh bg-void">
      <header className="flex h-14 items-center border-b border-line bg-ink px-4">
        <Logo />
      </header>
      {state.phase === "error" ? (
        <AnalysisFailure
          repository={repository}
          message={state.message}
          job={state.job}
          retryAfterSeconds={state.retryAfterSeconds}
          onRetry={retry}
        />
      ) : (
        <AnalysisProgress
          repository={repository}
          job={state.phase === "running" ? state.job : undefined}
        />
      )}
    </div>
  );
}
