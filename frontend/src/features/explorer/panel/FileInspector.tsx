"use client";

import { sourceUrl } from "@/lib/analysis/source-link";
import type { FileNode } from "@/lib/graph/schema";
import { countFormat, fileName, useExplorerData } from "../explorer-data";
import { useExplorerStore } from "../store";
import { useSelectionReach } from "../use-explorer-data";
import { Breadcrumbs } from "./Breadcrumbs";
import { DependencyExplorer } from "./DependencyExplorer";

const LANGUAGE_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  tsx: "TypeScript (TSX)",
  javascript: "JavaScript",
  jsx: "JavaScript (JSX)",
  json: "JSON",
};

interface Metric {
  label: string;
  value: number | null;
  hint?: string;
}

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
      {metrics.map((metric) => (
        <div key={metric.label} title={metric.hint}>
          <dt className="text-[11px] text-faint">{metric.label}</dt>
          <dd className="mt-0.5 font-mono text-base tabular-nums">
            {metric.value === null ? (
              <span className="text-faint" aria-label="Not measured">
                —
              </span>
            ) : (
              countFormat.format(metric.value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FileInspector({ file }: { file: FileNode }) {
  const { graph, city, adjacency, cycles } = useExplorerData();
  const select = useExplorerStore((s) => s.select);
  const { reach, cycle } = useSelectionReach(adjacency, cycles, file.id);

  const building = city.buildings.find((b) => b.id === file.id);
  const link = sourceUrl(graph, file.id);
  const metrics = file.metrics;
  const unresolved = graph.analysis?.unresolvedImports.filter((u) => u.source === file.id) ?? [];
  const outgoing = adjacency.imports.get(file.id)?.length ?? 0;
  const incoming = adjacency.importedBy.get(file.id)?.length ?? 0;

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <Breadcrumbs repository={graph.provenance.repository} path={file.path} />
        <button
          type="button"
          onClick={() => select(null)}
          className="shrink-0 font-mono text-xs text-faint transition-colors hover:text-text"
        >
          Close
        </button>
      </div>

      <h2 className="mt-3 text-lg font-medium break-words">{fileName(file.path)}</h2>
      <p className="mt-0.5 font-mono text-xs break-all text-faint">{file.path}</p>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded border border-line px-1.5 py-0.5 text-muted">
          {LANGUAGE_NAMES[file.language] ?? file.language}
        </span>
        {building && (
          <span className="rounded border border-line px-1.5 py-0.5 text-muted">
            {building.category}
          </span>
        )}
        {building?.landmark && (
          <span className="rounded border border-cyan/40 px-1.5 py-0.5 text-cyan">Key module</span>
        )}
        {cycle && (
          <span className="rounded border border-amber/40 px-1.5 py-0.5 text-amber">
            In a cycle
          </span>
        )}
      </div>

      <p className="mt-3 text-sm">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="text-cyan hover:text-text"
          >
            View source on GitHub at {graph.analysis!.repository.commitSha.slice(0, 7)} ↗
          </a>
        ) : (
          <span className="text-faint">No source link: this is sample data, not a repository.</span>
        )}
      </p>

      {metrics?.parseError && (
        <p className="mt-3 text-xs leading-relaxed text-amber">
          This file has a syntax error. The parser recovered, but some imports or counts may be
          missing.
        </p>
      )}
      {!building && (
        <p className="mt-3 text-xs text-amber">Not drawn in the city, because of the size limit.</p>
      )}

      <div className="mt-5">
        <MetricGrid
          metrics={[
            { label: "Lines of code", value: file.loc, hint: "Excluding blank and comment lines" },
            {
              label: "Complexity",
              value: file.complexity,
              hint: "File-level cyclomatic complexity",
            },
            { label: "Total lines", value: metrics?.totalLines ?? null },
            { label: "Functions", value: metrics?.functions ?? null },
            { label: "Classes", value: metrics?.classes ?? null },
            { label: "Exports", value: metrics?.exports ?? null },
            { label: "Imports", value: outgoing, hint: "Files in this repository it imports" },
            {
              label: "Imported by",
              value: incoming,
              hint: "Files in this repository importing it",
            },
            {
              label: "Packages",
              value: metrics?.externalImports ?? null,
              hint: "External imports",
            },
          ]}
        />
        {!metrics && (
          <p className="mt-3 text-[11px] text-faint">
            — means not measured. Sample data has no source to measure.
          </p>
        )}
      </div>

      {cycle && (
        <div className="mt-5 rounded-md border border-amber/30 bg-amber/5 p-3">
          <p className="text-sm text-amber">
            In an import cycle with {cycle.size - 1} other {cycle.size === 2 ? "file" : "files"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            Each of these reaches the others through imports, so none can be loaded or changed in
            isolation.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
            {[...cycle]
              .filter((id) => id !== file.id)
              .sort()
              .slice(0, 12)
              .map((id) => (
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
            {cycle.size - 1 > 12 && (
              <span className="text-[11px] text-faint">+{cycle.size - 1 - 12} more</span>
            )}
          </div>
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium">Unresolved imports</h3>
          <ul className="mt-1 space-y-1">
            {unresolved.map((item) => (
              <li key={`${item.line}:${item.specifier}`} className="text-[11px] text-faint">
                <span className="font-mono text-amber">{item.specifier}</span> (line {item.line}):{" "}
                {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reach && <DependencyExplorer reach={reach} cycle={cycle} />}
    </div>
  );
}
