"use client";

import type { ReactNode } from "react";
import { useExplorerStore } from "@/features/explorer/store";
import type { SnapshotDiff } from "@/lib/timetravel/api";
import { formatDate, shortSha } from "./format";
import { shownSha, useTimeTravelStore } from "./store";

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const LIST_LIMIT = 40;

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-faint">0</span>;
  const sign = value > 0 ? "+" : "−";
  return (
    <span className={value > 0 ? "text-emerald-300" : "text-rose-300"}>
      {sign}
      {countFormat.format(Math.abs(value))}
    </span>
  );
}

function CommitLine({ label, commit }: { label: string; commit: SnapshotDiff["base"] }) {
  return (
    <div className="text-xs leading-relaxed">
      <span className="font-mono text-violet">{label}</span>{" "}
      <span className="font-mono text-cyan">{shortSha(commit.sha)}</span>
      <span className="text-faint"> · {formatDate(commit.committedAt)}</span>
      {commit.author && <span className="text-faint"> · {commit.author}</span>}
      {commit.message && (
        <p className="truncate text-muted" title={commit.message}>
          “{commit.message}”
        </p>
      )}
    </div>
  );
}

function FileList({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: string;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer list-none text-sm select-none">
        <span className={`font-mono ${tone}`}>{countFormat.format(count)}</span>{" "}
        <span className="text-text">{title}</span>{" "}
        <span aria-hidden="true" className="text-faint group-open:hidden">
          ▸
        </span>
        <span aria-hidden="true" className="hidden text-faint group-open:inline">
          ▾
        </span>
      </summary>
      <ul className="mt-1 space-y-0.5 pl-2">{children}</ul>
      {count > LIST_LIMIT && (
        <p className="pl-2 text-[11px] text-faint">
          and {countFormat.format(count - LIST_LIMIT)} more
        </p>
      )}
    </details>
  );
}

function FileButton({ path }: { path: string }) {
  const select = useExplorerStore((s) => s.select);
  return (
    <li>
      <button
        type="button"
        title={path}
        onClick={() => select(path)}
        className="block w-full truncate text-left font-mono text-[11px] text-muted hover:text-cyan"
      >
        {path}
      </button>
    </li>
  );
}

/** What changed in the step on screen. Commit messages are shown as written, never interpreted. */
export function SnapshotPanel() {
  const repository = useTimeTravelStore((s) => s.repository);
  const viewing = useTimeTravelStore((s) => s.viewing);
  const latestSha = useTimeTravelStore((s) => s.latestSha);
  const diff = useTimeTravelStore((s) => s.diff);
  const compare = useTimeTravelStore((s) => s.compare);
  const commits = useTimeTravelStore((s) => s.commits);
  if (!repository) return null;

  const current = shownSha({ viewing, latestSha });
  const commit = commits.find((c) => c.sha === current);
  const relevant = diff && diff.head === current ? diff : null;
  const data = relevant?.status === "ready" ? relevant.data : undefined;

  return (
    <section aria-label="Snapshot" className="border-b border-line p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">
          {viewing === null ? "Latest commit" : "Historical snapshot"}
        </h2>
        {current && <span className="font-mono text-[11px] text-cyan">{shortSha(current)}</span>}
      </div>
      {commit && (
        <p className="mt-1 text-xs leading-relaxed text-muted">
          <span className="text-faint">Commit message: </span>“{commit.summary}”
          <span className="text-faint">
            {" "}
            · {commit.author ?? "unknown author"} · {formatDate(commit.committedAt)}
          </span>
        </p>
      )}

      {relevant?.status === "loading" && (
        <p className="mt-3 text-xs text-faint">Comparing with the previous snapshot…</p>
      )}
      {relevant?.status === "failed" && (
        <p className="mt-3 text-xs leading-relaxed text-amber">
          Couldn&apos;t compare: {relevant.error}. The city still shows this commit, matching files
          by path only.
        </p>
      )}

      {data && (
        <div className="mt-4">
          <h3 className="text-sm font-medium">
            {compare?.head === current ? "Comparison" : "Changes from the previous view"}
          </h3>
          <div className="mt-2 space-y-1">
            <CommitLine label="A" commit={data.base} />
            <CommitLine label="B" commit={data.head} />
          </div>

          <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
            {(
              [
                ["Added", data.files.addedCount, "text-emerald-300"],
                ["Removed", data.files.removedCount, "text-rose-300"],
                ["Modified", data.files.modifiedCount, "text-amber"],
                ["Renamed", data.files.renamedCount, "text-sky-300"],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label} className="rounded border border-line py-1.5">
                <dd className={`font-mono text-base tabular-nums ${tone}`}>{value}</dd>
                <dt className="text-[10px] text-faint">{label}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">
            Dependencies: <Delta value={data.edges.addedCount} /> added,{" "}
            <Delta value={-data.edges.removedCount} /> removed, {data.edges.unchanged} unchanged.{" "}
            {countFormat.format(data.files.unchanged)} files are byte-for-byte unchanged.
          </p>

          <table className="mt-3 w-full text-xs">
            <caption className="sr-only">Architecture metrics, A to B</caption>
            <thead>
              <tr className="text-left text-[10px] text-faint">
                <th className="font-normal">Metric</th>
                <th className="text-right font-normal">A</th>
                <th className="text-right font-normal">B</th>
                <th className="text-right font-normal">Change</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((metric) => (
                <tr key={metric.name} className="border-t border-line/60">
                  <td className="py-1 text-muted">{metric.label}</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {countFormat.format(metric.before)}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {countFormat.format(metric.after)}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    <Delta value={metric.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <FileList title="added files" count={data.files.addedCount} tone="text-emerald-300">
            {data.files.added.slice(0, LIST_LIMIT).map((path) => (
              <FileButton key={path} path={path} />
            ))}
          </FileList>
          <FileList title="removed files" count={data.files.removedCount} tone="text-rose-300">
            {data.files.removed.slice(0, LIST_LIMIT).map((path) => (
              <li key={path} className="truncate font-mono text-[11px] text-faint line-through">
                {path}
              </li>
            ))}
          </FileList>
          <FileList title="modified files" count={data.files.modifiedCount} tone="text-amber">
            {data.files.modified.slice(0, LIST_LIMIT).map((file) => (
              <li key={file.path} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1">
                  <FileButtonInline path={file.path} />
                </span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {file.before.loc}→{file.after.loc} lines
                </span>
              </li>
            ))}
          </FileList>
          <FileList title="renamed files" count={data.files.renamedCount} tone="text-sky-300">
            {data.files.renamed.slice(0, LIST_LIMIT).map((rename) => (
              <li key={rename.from} className="font-mono text-[11px] text-muted">
                <span className="text-faint">{rename.from}</span> →{" "}
                <FileButtonInline path={rename.to} />
                {rename.contentChanged ? <span className="text-faint"> (edited)</span> : null}
              </li>
            ))}
          </FileList>
          <FileList title="new dependencies" count={data.edges.addedCount} tone="text-emerald-300">
            {data.edges.added.slice(0, LIST_LIMIT).map((edge) => (
              <li
                key={`${edge.source}>${edge.target}`}
                className="truncate font-mono text-[11px] text-muted"
              >
                {edge.source} → {edge.target}
              </li>
            ))}
          </FileList>
          <FileList
            title="dropped dependencies"
            count={data.edges.removedCount}
            tone="text-rose-300"
          >
            {data.edges.removed.slice(0, LIST_LIMIT).map((edge) => (
              <li
                key={`${edge.source}>${edge.target}`}
                className="truncate font-mono text-[11px] text-faint"
              >
                {edge.source} → {edge.target}
              </li>
            ))}
          </FileList>

          <p className="mt-3 text-[11px] leading-relaxed text-faint">{data.renameDetection.note}</p>
        </div>
      )}
    </section>
  );
}

function FileButtonInline({ path }: { path: string }) {
  const select = useExplorerStore((s) => s.select);
  return (
    <button
      type="button"
      title={path}
      onClick={() => select(path)}
      className="max-w-full truncate text-left font-mono text-[11px] text-muted hover:text-cyan"
    >
      {path}
    </button>
  );
}
