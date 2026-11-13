"use client";

import type { ReactNode } from "react";
import { useExplorerStore } from "@/features/explorer/store";
import type { AnalysisSummary, FileNode } from "@/lib/graph/schema";
import { RepositoryCard } from "./AnalysisStatus";

const countFormat = new Intl.NumberFormat("en-US");
const SKIP_REASONS: Record<string, string> = {
  vendored_or_generated: "dependencies or build output",
  declaration_file: "type declarations (.d.ts)",
  minified: "minified bundles",
  too_large: "over the size limit",
};
const LIST_LIMIT = 8;

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="flex items-baseline gap-2 text-sm font-medium">
        {title}
        {count !== undefined && <span className="font-mono text-xs text-faint">{count}</span>}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function FileButton({ id }: { id: string }) {
  const select = useExplorerStore((s) => s.select);
  return (
    <button
      type="button"
      onClick={() => select(id)}
      title={id}
      className="w-full truncate text-left font-mono text-xs text-muted transition-colors hover:text-cyan"
    >
      {id}
    </button>
  );
}

export function cycleSummary(runtime: number, typeOnly: number): string {
  const parts = [];
  if (runtime > 0) parts.push(`${runtime} can affect load order at runtime`);
  if (typeOnly > 0) parts.push(`${typeOnly} only involve type imports`);
  return `${parts.join(", and ")}.`;
}

/** What the analysis found, beyond the city itself. */
export function AnalysisOverview({ analysis }: { analysis: AnalysisSummary }) {
  const runtimeCycles = analysis.cycles.filter((c) => !c.typeOnly);
  const packages = analysis.externalDependencies.filter((d) => d.kind === "package");
  const builtins = analysis.externalDependencies.filter((d) => d.kind === "builtin");
  const skipped = Object.entries(analysis.skippedFiles).filter(([, n]) => n > 0);

  return (
    <div>
      <div className="mt-4">
        <RepositoryCard repository={analysis.repository} />
      </div>

      <Section title="Most connected modules">
        <ul className="space-y-1">
          {analysis.hubs.slice(0, LIST_LIMIT).map((hub) => (
            <li key={hub.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <FileButton id={hub.id} />
              </span>
              <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
                <span className="text-violet">{hub.incoming}</span> in ·{" "}
                <span className="text-cyan">{hub.outgoing}</span> out
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Dependency cycles" count={analysis.cycleCount}>
        {analysis.cycleCount === 0 ? (
          <p className="text-sm text-faint">No files depend on each other in a loop.</p>
        ) : (
          <>
            <p className="mb-2 text-xs leading-relaxed text-faint">
              {cycleSummary(runtimeCycles.length, analysis.cycles.length - runtimeCycles.length)}
            </p>
            <ul className="space-y-3">
              {analysis.cycles.slice(0, 5).map((cycle) => (
                <li key={cycle.files.join("|")}>
                  <p className={`text-[11px] ${cycle.typeOnly ? "text-faint" : "text-amber"}`}>
                    {cycle.files.length} files{cycle.typeOnly ? ", type imports only" : ""}
                  </p>
                  {cycle.files.slice(0, 4).map((id) => (
                    <FileButton key={id} id={id} />
                  ))}
                  {cycle.files.length > 4 && (
                    <p className="text-[11px] text-faint">and {cycle.files.length - 4} more</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="External packages" count={packages.length}>
        {packages.length === 0 ? (
          <p className="text-sm text-faint">None imported.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {packages.slice(0, 24).map((dependency) => (
              <li
                key={dependency.name}
                title={`Imported by ${dependency.importers} files`}
                className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted"
              >
                {dependency.name}
              </li>
            ))}
            {packages.length > 24 && (
              <li className="px-1 font-mono text-[11px] text-faint">+{packages.length - 24}</li>
            )}
          </ul>
        )}
        {builtins.length > 0 && (
          <p className="mt-2 text-xs text-faint">
            Node built-ins: {builtins.map((b) => b.name).join(", ")}
          </p>
        )}
      </Section>

      <Section title="Unresolved imports" count={analysis.unresolvedImportCount}>
        {analysis.unresolvedImportCount === 0 ? (
          <p className="text-sm text-faint">Every import was resolved or classified.</p>
        ) : (
          <ul className="space-y-2">
            {analysis.unresolvedImports.slice(0, LIST_LIMIT).map((item) => (
              <li key={`${item.source}:${item.line}:${item.specifier}`}>
                <p className="truncate font-mono text-xs text-amber" title={item.specifier}>
                  {item.specifier}
                </p>
                <p className="truncate text-[11px] text-faint" title={item.reason}>
                  {item.source}:{item.line} · {item.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Coverage">
        <ul className="space-y-1 text-xs leading-relaxed text-muted">
          <li>
            {Object.entries(analysis.languages)
              .map(([language, n]) => `${countFormat.format(n)} ${language}`)
              .join(" · ")}
          </li>
          {skipped.map(([reason, n]) => (
            <li key={reason} className="text-faint">
              Skipped {countFormat.format(n)} {SKIP_REASONS[reason] ?? reason}
            </li>
          ))}
          {analysis.filesWithParseErrors > 0 && (
            <li className="text-amber">
              {analysis.filesWithParseErrors} files had syntax errors and may be incomplete
            </li>
          )}
          <li className="text-faint">
            Analyzed {new Date(analysis.analyzedAt).toLocaleString("en-US")}
          </li>
        </ul>
      </Section>
    </div>
  );
}

/** Per-file measurements, shown only when the file came from real analysis. */
export function FileMetricsPanel({
  file,
  analysis,
}: {
  file: FileNode;
  analysis: AnalysisSummary | undefined;
}) {
  const metrics = file.metrics;
  if (!metrics) return null;
  const unresolved = analysis?.unresolvedImports.filter((u) => u.source === file.id) ?? [];
  const items: [string, number][] = [
    ["Total lines", metrics.totalLines],
    ["Functions", metrics.functions],
    ["Classes", metrics.classes],
    ["Exports", metrics.exports],
    ["Package imports", metrics.externalImports],
    ["Unresolved", metrics.unresolvedImports],
  ];
  return (
    <div className="mt-4">
      {metrics.parseError && (
        <p className="mb-3 text-xs leading-relaxed text-amber">
          This file has a syntax error. The parser recovered, but some imports or counts may be
          missing.
        </p>
      )}
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-faint">{label}</dt>
            <dd className="font-mono text-sm tabular-nums">{countFormat.format(value)}</dd>
          </div>
        ))}
      </dl>
      {unresolved.length > 0 && (
        <ul className="mt-3 space-y-1">
          {unresolved.map((item) => (
            <li key={`${item.line}:${item.specifier}`} className="text-[11px] text-faint">
              <span className="font-mono text-amber">{item.specifier}</span> (line {item.line}):{" "}
              {item.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
