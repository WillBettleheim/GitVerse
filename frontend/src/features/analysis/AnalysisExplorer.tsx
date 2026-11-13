"use client";

import { useEffect } from "react";
import { Logo } from "@/components/Logo";
import { ArchitectPanel } from "@/features/architect/ArchitectPanel";
import { useArchitectStore } from "@/features/architect/store";
import { ExplorerShell } from "@/features/explorer/ExplorerShell";
import { useTimeTravelStore } from "@/features/timetravel/store";
import { TimelineBar } from "@/features/timetravel/TimelineBar";
import { useTimeTravel } from "@/features/timetravel/use-time-travel";
import type { CodeGraph } from "@/lib/graph/schema";
import { AnalysisFailure, AnalysisProgress } from "./AnalysisStatus";
import { useAnalysis } from "./use-analysis";

export function AnalysisExplorer({ owner, name }: { owner: string; name: string }) {
  const repository = `${owner}/${name}`;
  const { state, retry } = useAnalysis(repository);

  if (state.phase === "complete") {
    return <TimeTravelExplorer key={state.job.id} latest={state.graph} cached={state.job.cached} />;
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

/** The explorer for a real analysis, with time travel through its history. */
function TimeTravelExplorer({ latest, cached }: { latest: CodeGraph; cached: boolean }) {
  const controls = useTimeTravel(latest);
  const historical = useTimeTravelStore((s) =>
    s.viewing ? (s.snapshots[s.viewing]?.graph ?? null) : null,
  );
  const graph = historical ?? latest;
  const info = graph.analysis?.repository;
  const resetArchitect = useArchitectStore((s) => s.reset);
  useEffect(() => resetArchitect, [resetArchitect]);
  return (
    <ExplorerShell
      graph={graph}
      timeline={<TimelineBar controls={controls} />}
      architect={<ArchitectPanel />}
      headerSlot={
        info && (
          <a
            href={`${info.url}/tree/${info.commitSha}`}
            target="_blank"
            rel="noreferrer noopener"
            className="hidden shrink-0 font-mono text-[11px] text-faint hover:text-text md:inline"
            title="The exact commit on screen"
          >
            @{info.commitSha.slice(0, 7)}
            {historical ? " · historical" : cached ? " · cached" : ""}
          </a>
        )
      }
    />
  );
}
