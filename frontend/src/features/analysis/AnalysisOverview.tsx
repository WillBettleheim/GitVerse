"use client";

import type { ReactNode } from "react";
import type { AnalysisSummary } from "@/lib/graph/schema";
import { RepositoryCard } from "./AnalysisStatus";

const countFormat = new Intl.NumberFormat("en-US");
const SKIP_REASONS: Record<string, string> = {
  vendored_or_generated: "dependencies or build output",
  declaration_file: "type declarations (.d.ts)",
  minified: "minified bundles",
  too_large: "over the size limit",
};
const LIST_LIMIT = 8;

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
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

export function cycleSummary(runtime: number, typeOnly: number): string {
  const parts = [];
  if (runtime > 0) parts.push(`${runtime} can affect load order at runtime`);
  if (typeOnly > 0) parts.push(`${typeOnly} only involve type imports`);
  return `${parts.join(", and ")}.`;
}

/**
 * What the analysis found beyond the graph. "repository" is the repository card; "details" is
 * packages, unresolved imports and coverage. Cycles and rankings live in the insights dashboard.
 */
export function AnalysisOverview({
  analysis,
  part,
}: {
  analysis: AnalysisSummary;
  part: "repository" | "details";
}) {
  if (part === "repository") return <RepositoryCard repository={analysis.repository} />;

  const packages = analysis.externalDependencies.filter((d) => d.kind === "package");
  const builtins = analysis.externalDependencies.filter((d) => d.kind === "builtin");
  const skipped = Object.entries(analysis.skippedFiles).filter(([, n]) => n > 0);

  return (
    <div>
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
