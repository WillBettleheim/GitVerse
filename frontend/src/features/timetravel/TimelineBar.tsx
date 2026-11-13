"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Commit } from "@/lib/timetravel/api";
import { stepCommit } from "@/lib/timetravel/snapshots";
import { formatDate, monthLabel, shortSha } from "./format";
import { shownSha, useTimeTravelStore, type Snapshot, type Speed } from "./store";
import type { TimeTravelControls } from "./use-time-travel";

const SPEEDS: Speed[] = [0.5, 1, 2];
const control =
  "h-7 rounded border border-line bg-panel px-2 font-mono text-[11px] text-muted transition-colors hover:border-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:border-cyan/50 aria-pressed:text-cyan";

function dotClass(snapshot: Snapshot | undefined, isShown: boolean, isPending: boolean): string {
  const base = "block rounded-full transition-all";
  if (isShown) return `${base} h-3.5 w-3.5 bg-white ring-2 ring-cyan/60`;
  if (isPending) return `${base} h-3 w-3 animate-pulse border-2 border-cyan`;
  switch (snapshot?.status) {
    case "ready":
      return `${base} h-2.5 w-2.5 bg-cyan`;
    case "queued":
    case "running":
      return `${base} h-2.5 w-2.5 animate-pulse border border-cyan/70`;
    case "failed":
      return `${base} h-2.5 w-2.5 border border-amber`;
    default:
      return `${base} h-1.5 w-1.5 bg-faint/60`;
  }
}

function statusText(snapshot: Snapshot | undefined): string {
  switch (snapshot?.status) {
    case "ready":
      return "analyzed";
    case "queued":
      return "queued for analysis";
    case "running":
      return snapshot.filesTotal
        ? `analyzing, ${snapshot.filesParsed ?? 0} of ${snapshot.filesTotal} files`
        : "analyzing";
    case "failed":
      return `analysis failed: ${snapshot.error ?? "unknown error"}`;
    default:
      return "not analyzed yet";
  }
}

/** The horizontal history: oldest left, newest right, one stop per commit. */
export function TimelineBar({ controls }: { controls: TimeTravelControls }) {
  const commits = useTimeTravelStore((s) => s.commits);
  const snapshots = useTimeTravelStore((s) => s.snapshots);
  const latestSha = useTimeTravelStore((s) => s.latestSha);
  const viewing = useTimeTravelStore((s) => s.viewing);
  const pending = useTimeTravelStore((s) => s.pending);
  const hasMore = useTimeTravelStore((s) => s.hasMore);
  const historyStatus = useTimeTravelStore((s) => s.historyStatus);
  const historyError = useTimeTravelStore((s) => s.historyError);
  const playing = useTimeTravelStore((s) => s.playing);
  const speed = useTimeTravelStore((s) => s.speed);
  const compare = useTimeTravelStore((s) => s.compare);
  const setPlaying = useTimeTravelStore((s) => s.setPlaying);
  const setSpeed = useTimeTravelStore((s) => s.setSpeed);
  const setCompare = useTimeTravelStore((s) => s.setCompare);
  const [hovered, setHovered] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);

  const current = shownSha({ viewing, latestSha });
  const newestFirst = useMemo(() => commits.map((c) => c.sha), [commits]);
  const oldestFirst = useMemo(() => [...commits].reverse(), [commits]);
  const byId = useMemo(() => new Map(commits.map((c) => [c.sha, c])), [commits]);
  const readyCount = Object.values(snapshots).filter((s) => s.status === "ready").length;

  const focusCommit = (sha: string) =>
    track.current?.querySelector<HTMLButtonElement>(`[data-sha="${sha}"]`)?.focus();

  const choose = (sha: string) => {
    setPlaying(false);
    if (compare) {
      if (!compare.base || compare.head) {
        setCompare({ base: sha, head: null });
        if (snapshots[sha]?.status === "ready") void controls.show(sha, { animate: false });
        else controls.select(sha);
        return;
      }
      setCompare({ base: compare.base, head: sha });
    }
    controls.select(sha);
  };

  const step = (direction: "older" | "newer") => {
    const target = stepCommit(newestFirst, current, direction);
    if (target) choose(target);
    return target;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const direction =
      event.key === "ArrowLeft" ? "older" : event.key === "ArrowRight" ? "newer" : null;
    if (!direction) return;
    event.preventDefault();
    const target = step(direction);
    if (target) focusCommit(target);
  };

  const described: Commit | undefined = byId.get(hovered ?? pending ?? current ?? "");
  const describedSnapshot = described ? snapshots[described.sha] : undefined;

  let hint = "Plays the analyzed commits in order. Select any other commit to analyze it.";
  if (compare && !compare.base) hint = "Compare: select the first commit (A).";
  else if (compare && !compare.head) hint = "Compare: now select the second commit (B).";
  else if (compare) hint = "Comparing A with B. Select a commit to start a new comparison.";

  return (
    <section
      aria-label="Time travel"
      className="absolute inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
        <button
          type="button"
          className={control}
          disabled={viewing === null}
          onClick={() => {
            setPlaying(false);
            setCompare(null);
            if (latestSha) void controls.show(latestSha);
          }}
        >
          Latest
        </button>
        <button
          type="button"
          className={control}
          aria-label="Older commit"
          onClick={() => step("older")}
        >
          ◀
        </button>
        <button
          type="button"
          className={control}
          aria-pressed={playing}
          disabled={!playing && readyCount < 2}
          title={readyCount < 2 ? "Needs at least two analyzed commits." : undefined}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className={control}
          aria-label="Newer commit"
          onClick={() => step("newer")}
        >
          ▶
        </button>
        <div role="group" aria-label="Playback speed" className="flex">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={speed === value}
              onClick={() => setSpeed(value)}
              className={`${control} rounded-none first:rounded-l last:rounded-r`}
            >
              {value}×
            </button>
          ))}
        </div>
        <button
          type="button"
          className={control}
          aria-pressed={compare !== null}
          onClick={() => {
            setPlaying(false);
            setCompare(compare ? null : { base: null, head: null });
          }}
        >
          Compare
        </button>
        <p className="ml-1 min-w-0 flex-1 truncate font-mono text-[11px] text-faint">
          {readyCount} of {commits.length} commits analyzed · {hint}
        </p>
      </div>

      <p aria-live="polite" className="min-h-5 truncate px-3 pt-1 text-xs">
        {described ? (
          <>
            <span className="font-mono text-cyan">{shortSha(described.sha)}</span>
            <span className="text-faint"> · {formatDate(described.committedAt)}</span>
            {described.author && <span className="text-faint"> · {described.author}</span>}
            <span className="text-text"> · “{described.summary}”</span>
            <span className="text-faint">
              {" "}
              · {described.sha === latestSha ? "latest, " : ""}
              {statusText(describedSnapshot)}
            </span>
          </>
        ) : historyStatus === "loading" ? (
          <span className="text-faint">Loading commit history…</span>
        ) : historyStatus === "failed" ? (
          <span className="text-amber">{historyError}</span>
        ) : null}
      </p>

      <div
        ref={track}
        role="listbox"
        aria-label="Commits, oldest to newest"
        onKeyDown={onKeyDown}
        className="flex items-end gap-0 overflow-x-auto px-3 pt-1 pb-2"
      >
        {hasMore && (
          <button
            type="button"
            onClick={() => void controls.loadMore()}
            disabled={historyStatus === "loading"}
            className={`${control} mr-2 mb-1 shrink-0`}
          >
            {historyStatus === "loading" ? "Loading…" : "Load older"}
          </button>
        )}
        {oldestFirst.map((commit, index) => {
          const previous = oldestFirst[index - 1];
          const month = monthLabel(commit.committedAt);
          const newMonth = month !== null && month !== monthLabel(previous?.committedAt);
          const isShown = commit.sha === current;
          const marker =
            compare?.base === commit.sha ? "A" : compare?.head === commit.sha ? "B" : null;
          return (
            <div key={commit.sha} className="relative flex w-6 shrink-0 flex-col items-center">
              <span className="h-3.5 font-mono text-[9px] text-violet">{marker}</span>
              <button
                type="button"
                role="option"
                data-sha={commit.sha}
                aria-selected={isShown}
                tabIndex={isShown ? 0 : -1}
                aria-label={`${shortSha(commit.sha)}, ${formatDate(commit.committedAt)}: ${commit.summary}. ${statusText(snapshots[commit.sha])}.`}
                onClick={() => choose(commit.sha)}
                onPointerEnter={() => setHovered(commit.sha)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(commit.sha)}
                onBlur={() => setHovered(null)}
                className="grid h-6 w-6 place-items-center rounded focus-visible:outline-2"
              >
                <span
                  aria-hidden="true"
                  className={dotClass(snapshots[commit.sha], isShown, pending === commit.sha)}
                />
              </button>
              <span
                aria-hidden="true"
                className={`mt-0.5 h-3 font-mono text-[9px] whitespace-nowrap ${newMonth ? "text-faint" : "text-transparent"}`}
              >
                {newMonth ? month : "·"}
              </span>
              <span
                aria-hidden="true"
                className={`absolute top-[1.55rem] left-0 h-px w-full ${index === 0 ? "left-1/2 w-1/2" : ""} ${index === oldestFirst.length - 1 ? "w-1/2" : ""} -z-10 bg-line`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
