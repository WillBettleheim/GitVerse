"use client";

import type { ReactNode } from "react";
import { AnalysisOverview, cycleSummary } from "@/features/analysis/AnalysisOverview";
import { countFormat, fileName, useExplorerData } from "../explorer-data";
import { useExplorerStore } from "../store";
import { RankedList } from "./RankedList";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-faint">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={`mt-0.5 font-mono text-lg tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

/** The overview when nothing is selected. Every value is counted from the graph. */
export function InsightsDashboard() {
  const { graph, insights, cycles } = useExplorerData();
  const select = useExplorerStore((s) => s.select);
  const showFolder = useExplorerStore((s) => s.showFolder);
  const analysis = graph.analysis;

  // The backend knows which cycles involve only type imports. Sample data doesn't say.
  const typeOnly = new Set(
    (analysis?.cycles ?? []).filter((c) => c.typeOnly).map((c) => c.files.join("|")),
  );
  const runtimeCycles = cycles.groups.filter((g) => !typeOnly.has(g.join("|"))).length;

  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">Insights</h2>
        <p className="font-mono text-[11px] text-faint">
          {analysis
            ? `Measured at ${analysis.repository.commitSha.slice(0, 7)}`
            : "From sample data"}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="Files analyzed" value={countFormat.format(insights.files)} />
        <Stat label="Dependency edges" value={countFormat.format(insights.edges)} />
        <Stat
          label="Dependency cycles"
          value={countFormat.format(insights.cycles)}
          tone={insights.cycles > 0 ? "text-amber" : undefined}
        />
        <Stat label="Lines of code" value={countFormat.format(insights.totalLoc)} />
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        {insights.filesInCycles > 0 &&
          `${countFormat.format(insights.filesInCycles)} files are in cycles. `}
        {countFormat.format(insights.isolated)} files neither import nor are imported by another.
      </p>

      {analysis && (
        <div className="mt-5">
          <AnalysisOverview analysis={analysis} part="repository" />
        </div>
      )}

      <Section title="Dependency cycles" hint="Files that import each other in a loop.">
        {cycles.groups.length === 0 ? (
          <p className="text-sm text-faint">No files depend on each other in a loop.</p>
        ) : (
          <>
            {analysis && (
              <p className="mb-2 text-xs leading-relaxed text-faint">
                {cycleSummary(runtimeCycles, cycles.groups.length - runtimeCycles)}
              </p>
            )}
            <ul className="space-y-3">
              {cycles.groups.slice(0, 5).map((group) => {
                const onlyTypes = typeOnly.has(group.join("|"));
                return (
                  <li key={group.join("|")}>
                    <p className={`text-[11px] ${onlyTypes ? "text-faint" : "text-amber"}`}>
                      {group.length} files{onlyTypes ? ", type imports only" : ""}
                    </p>
                    <div className="mt-0.5 flex flex-wrap gap-x-2">
                      {group.slice(0, 6).map((id) => (
                        <button
                          key={id}
                          type="button"
                          title={id}
                          onClick={() => select(id)}
                          className="font-mono text-xs text-muted hover:text-amber"
                        >
                          {fileName(id)}
                        </button>
                      ))}
                      {group.length > 6 && (
                        <span className="text-[11px] text-faint">+{group.length - 6} more</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {cycles.groups.length > 5 && (
              <p className="mt-2 text-[11px] text-faint">
                and {cycles.groups.length - 5} more cycles
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Most depended upon" hint="Files imported by the most other files.">
        {insights.mostDependedUpon.length === 0 ? (
          <p className="text-sm text-faint">No file is imported by another.</p>
        ) : (
          <RankedList items={insights.mostDependedUpon} unit="importers" barClass="bg-violet" />
        )}
      </Section>

      <Section title="Largest modules" hint="By lines of code, excluding blanks and comments.">
        <RankedList items={insights.largest} unit="lines" barClass="bg-electric" />
      </Section>

      <Section title="Complexity hotspots" hint="By file-level cyclomatic complexity.">
        {insights.hotspots.length === 0 ? (
          <p className="text-sm text-faint">No complexity data to rank.</p>
        ) : (
          <RankedList items={insights.hotspots} unit="paths" barClass="bg-amber" />
        )}
      </Section>

      <Section
        title="Distribution across folders"
        hint="Share of lines of code per area. Select one to filter the city."
      >
        <ul className="space-y-2">
          {insights.folders.slice(0, 12).map((folder) => (
            <li key={folder.folder}>
              <button
                type="button"
                onClick={() => showFolder(folder.folder === "(root)" ? "" : folder.folder)}
                className="group block w-full text-left"
              >
                <span className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate font-mono text-xs text-text group-hover:text-cyan">
                    {folder.folder}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                    {(folder.share * 100).toFixed(1)}%
                  </span>
                </span>
                <span className="mt-1 block h-1 rounded bg-line" aria-hidden="true">
                  <span
                    className="block h-full rounded bg-cyan/70"
                    style={{ width: `${Math.max(1, folder.share * 100)}%` }}
                  />
                </span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {countFormat.format(folder.files)} files · {countFormat.format(folder.loc)} lines
                  · {countFormat.format(folder.outgoing)} imports to other areas
                </span>
              </button>
            </li>
          ))}
        </ul>
        {insights.folders.length > 12 && (
          <p className="mt-2 text-[11px] text-faint">
            and {insights.folders.length - 12} smaller areas
          </p>
        )}
      </Section>

      {analysis && <AnalysisOverview analysis={analysis} part="details" />}
    </div>
  );
}
